//! NEAR AI Cloud transport for the notes pipeline (packages/core/src/notes/pipeline.ts).
//!
//! The API key lives in the macOS Keychain and never reaches the web view. The web
//! view can only ask for three things: transcribe an audio file inside Aftercall's
//! recordings folder, send a chat completion, and read an attestation report or a
//! response signature. Meeting content goes nowhere else.

use std::path::{Path, PathBuf};
use std::time::Duration;

const BASE: &str = "https://cloud-api.near.ai/v1";

/// The API root. Debug builds may point it at a local fake for tests; release builds can't.
fn base() -> String {
    #[cfg(debug_assertions)]
    if let Ok(url) = std::env::var("NEARAI_BASE_URL") {
        return url;
    }
    BASE.to_string()
}
const KEYCHAIN_SERVICE: &str = "dev.aftercall.app";
const KEYCHAIN_ACCOUNT: &str = "nearai-api-key";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())
}

/// The key from the Keychain, or `NEARAI_API_KEY` from the environment during development.
fn api_key() -> Result<String, String> {
    match entry()?.get_password() {
        Ok(k) => Ok(k),
        Err(keyring::Error::NoEntry) => std::env::var("NEARAI_API_KEY").map_err(|_| "NO_NEARAI_KEY".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

/// Cleans a pasted key: surrounding spaces, quotes, a "Bearer " prefix.
pub fn clean_key(key: &str) -> String {
    let k = key.trim().trim_matches(|c| c == '"' || c == '\'');
    k.strip_prefix("Bearer ").unwrap_or(k).trim().to_string()
}

pub fn set_key(key: &str) -> Result<(), String> {
    let key = clean_key(key);
    if key.len() < 16 || key.contains(char::is_whitespace) {
        return Err("That doesn't look like a NEAR AI API key. Copy it again from cloud.near.ai.".into());
    }
    entry()?
        .set_password(&key)
        .map_err(|e| format!("macOS Keychain didn't save the key ({e}). If macOS asked, choose Allow or Always Allow."))
}

pub fn has_key() -> bool {
    api_key().is_ok()
}

/// The last four characters of the saved key, to show which key is in use.
pub fn key_hint() -> Option<String> {
    let k = api_key().ok()?;
    let tail: String = k.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    Some(tail)
}

/// Asks NEAR AI whether a key works, without spending anything: an attestation
/// report needs a valid key. "valid", "invalid", or "unknown" when NEAR AI can't be reached.
pub async fn check_key(key: &str) -> String {
    let key = clean_key(key);
    let nonce: String = (0..32).map(|i| format!("{:02x}", (i * 37 + 11) % 256)).collect();
    let url = format!("{}/attestation/report?model=openai%2Fwhisper-large-v3&signing_algo=ecdsa&nonce={nonce}", base());
    let res = match client() {
        Ok(c) => c.get(url).bearer_auth(&key).header("accept", "application/json").send().await,
        Err(_) => return "unknown".into(),
    };
    match res {
        Ok(r) if r.status().is_success() => "valid".into(),
        Ok(r) if r.status() == reqwest::StatusCode::UNAUTHORIZED || r.status() == reqwest::StatusCode::FORBIDDEN => "invalid".into(),
        _ => "unknown".into(),
    }
}

pub fn clear_key() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn client() -> Result<reqwest::Client, String> {
    // Whisper on a 5-minute chunk can take a while; the gateway itself stops at 120 s.
    reqwest::Client::builder().timeout(Duration::from_secs(180)).build().map_err(|e| e.to_string())
}

async fn body_text(res: reqwest::Response) -> Result<String, String> {
    let status = res.status();
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    // Exact bytes matter: the response signature covers them.
    let text = String::from_utf8(bytes.to_vec()).map_err(|_| "NEAR AI returned a body that isn't UTF-8".to_string())?;
    if !status.is_success() {
        return Err(format!("NEAR AI {status}: {}", text.chars().take(300).collect::<String>()));
    }
    Ok(text)
}

/// Only files inside the app's own recordings folder may be uploaded.
pub fn check_audio_path(path: &Path, recordings: &Path) -> Result<PathBuf, String> {
    let file = path.canonicalize().map_err(|_| "Audio file not found".to_string())?;
    let root = recordings.canonicalize().map_err(|_| "No recordings yet".to_string())?;
    if !file.starts_with(&root) || file.extension().and_then(|e| e.to_str()) != Some("wav") {
        return Err("Only Aftercall recordings can be transcribed".into());
    }
    Ok(file)
}

pub async fn transcribe(file: PathBuf, model: String, prompt: String) -> Result<String, String> {
    let bytes = tokio_read(&file).await?;
    let name = file.file_name().and_then(|n| n.to_str()).unwrap_or("audio.wav").to_string();
    let part = reqwest::multipart::Part::bytes(bytes).file_name(name).mime_str("audio/wav").map_err(|e| e.to_string())?;
    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", model)
        .text("response_format", "verbose_json");
    if !prompt.is_empty() {
        form = form.text("prompt", prompt);
    }
    let res = client()?
        .post(format!("{}/audio/transcriptions", base()))
        .bearer_auth(api_key()?)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    body_text(res).await
}

async fn tokio_read(path: &Path) -> Result<Vec<u8>, String> {
    let path = path.to_path_buf();
    // Chunks are encrypted at rest: decrypt in memory only, never to a file.
    tauri::async_runtime::spawn_blocking(move || crate::at_rest::read_audio(&path).map(|wav| wav.to_vec())).await.map_err(|e| e.to_string())?
}

pub async fn chat(body: String) -> Result<String, String> {
    let res = client()?
        .post(format!("{}/chat/completions", base()))
        .bearer_auth(api_key()?)
        .header("content-type", "application/json")
        // The signature covers the exact response bytes, so no compression in between.
        .header("accept-encoding", "identity")
        .header("x-no-aliasing", "true")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    body_text(res).await
}

/// GET for the two read-only verification endpoints.
pub fn check_get_path(path: &str) -> Result<(), String> {
    let allowed = (path.starts_with("attestation/report?") || path.starts_with("signature/"))
        && !path.contains("..")
        && !path.contains("://");
    if allowed { Ok(()) } else { Err("Not an allowed NEAR AI path".into()) }
}

pub async fn get(path: String) -> Result<String, String> {
    check_get_path(&path)?;
    let res = client()?
        .get(format!("{}/{path}", base()))
        .bearer_auth(api_key()?)
        .header("accept", "application/json")
        .header("x-no-aliasing", "true")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    body_text(res).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pasted_keys_are_cleaned() {
        assert_eq!(clean_key("  sk-abc123  "), "sk-abc123");
        assert_eq!(clean_key("\"sk-abc123\""), "sk-abc123");
        assert_eq!(clean_key("Bearer sk-abc123"), "sk-abc123");
    }

    #[test]
    fn only_verification_paths_can_be_read() {
        assert!(check_get_path("attestation/report?model=Qwen%2FQwen3.8-27B&nonce=ab").is_ok());
        assert!(check_get_path("signature/chatcmpl-42?model=x").is_ok());
        assert!(check_get_path("models").is_err());
        assert!(check_get_path("signature/../workspaces").is_err());
        assert!(check_get_path("signature/x?u=https://evil").is_err());
    }

    #[test]
    fn only_recordings_can_be_uploaded() {
        let root = std::env::temp_dir().join(format!("aftercall-test-{}", std::process::id()));
        let rec = root.join("recordings").join("1");
        std::fs::create_dir_all(&rec).unwrap();
        std::fs::write(rec.join("mic-000.wav"), b"RIFF").unwrap();
        std::fs::write(root.join("secret.wav"), b"RIFF").unwrap();
        std::fs::write(rec.join("notes.json"), b"{}").unwrap();

        let recordings = root.join("recordings");
        assert!(check_audio_path(&rec.join("mic-000.wav"), &recordings).is_ok());
        assert!(check_audio_path(&root.join("secret.wav"), &recordings).is_err());
        assert!(check_audio_path(&rec.join("../../secret.wav"), &recordings).is_err());
        assert!(check_audio_path(&rec.join("notes.json"), &recordings).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
