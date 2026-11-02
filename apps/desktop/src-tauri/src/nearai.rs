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
    // A debug build pointed at another server (the local fake in tests) uses the
    // environment's key, never the real one from the Keychain.
    #[cfg(debug_assertions)]
    if std::env::var("NEARAI_BASE_URL").is_ok() {
        return std::env::var("NEARAI_API_KEY").map_err(|_| "NO_NEARAI_KEY".to_string());
    }
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

/// Ask's reply comes in one piece, once it's written.
const CHAT_TIMEOUT: Duration = Duration::from_secs(600);

/// The notes are streamed (`chat_stream`): no total limit, only these two. NEAR AI sends
/// the stream's headers with its first piece, after reading the whole transcript.
pub const STREAM_FIRST_BYTE: Duration = Duration::from_secs(300);
/// The longest silence between two pieces of the stream.
pub const STREAM_IDLE: Duration = Duration::from_secs(60);
/// A notes reply is tens of kilobytes; anything near this is not one.
const STREAM_MAX_BYTES: usize = 32 * 1024 * 1024;

fn client() -> Result<reqwest::Client, String> {
    // Whisper on a 5-minute chunk can take a while; the gateway itself stops at 120 s.
    // A gateway that can't be reached at all fails fast instead of after the full wait.
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())
}

/// A request that got no answer, in words: reqwest's own text ("error sending request
/// for url …") hides whether it timed out or couldn't connect.
fn send_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "NEAR AI took too long to answer, so Aftercall stopped waiting. Nothing was lost; try again.".into()
    } else if e.is_connect() {
        "Couldn't connect to NEAR AI. Check the connection, then try again.".into()
    } else {
        e.to_string()
    }
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
        .map_err(send_error)?;
    body_text(res).await
}

async fn tokio_read(path: &Path) -> Result<Vec<u8>, String> {
    let path = path.to_path_buf();
    // Chunks are encrypted at rest: decrypt in memory only, never to a file.
    tauri::async_runtime::spawn_blocking(move || crate::at_rest::read_audio(&path).map(|wav| wav.to_vec())).await.map_err(|e| e.to_string())?
}

/// The public keys for an end-to-end encrypted chat (NEAR AI E2EE v2): ours, made
/// fresh for the request, and the model TEE's attested Ed25519 key, which also pins
/// the gateway to that TEE.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct E2ee {
    pub client_pub_key: String,
    pub model_pub_key: String,
}

/// An Ed25519 public key: 32 bytes as 64 hex characters.
fn is_ed25519_hex(key: &str) -> bool {
    key.len() == 64 && key.bytes().all(|c| c.is_ascii_hexdigit())
}

/// The headers an E2EE request adds, after checking both keys are well formed.
pub fn e2ee_headers(e2ee: &E2ee) -> Result<Vec<(&'static str, String)>, String> {
    if !is_ed25519_hex(&e2ee.client_pub_key) || !is_ed25519_hex(&e2ee.model_pub_key) {
        return Err("E2EE keys must be 32-byte Ed25519 keys in hex".into());
    }
    Ok(vec![
        ("x-signing-algo", "ed25519".into()),
        ("x-client-pub-key", e2ee.client_pub_key.to_lowercase()),
        ("x-model-pub-key", e2ee.model_pub_key.to_lowercase()),
        ("x-encryption-version", "2".into()),
    ])
}

/// Always end-to-end encrypted: the keys are checked before anything is sent.
pub async fn chat(body: String, e2ee: E2ee) -> Result<String, String> {
    let headers = e2ee_headers(&e2ee)?;
    let mut req = client()?
        .post(format!("{}/chat/completions", base()))
        .bearer_auth(api_key()?)
        .header("content-type", "application/json")
        // The signature covers the exact response bytes, so no compression in between.
        .header("accept-encoding", "identity")
        .header("x-no-aliasing", "true");
    for (name, value) in headers {
        req = req.header(name, value);
    }
    let res = req.timeout(CHAT_TIMEOUT).body(body).send().await.map_err(send_error)?;
    body_text(res).await
}

/// How much of a streamed reply has arrived, for the "Writing the notes" step. Counts
/// only: the content is encrypted to the web view's key and stays in `body` untouched.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamProgress {
    pub bytes: u64,
    /// `data:` events so far (each is about one token), not counting `[DONE]`.
    pub events: u64,
    /// The output tokens the stream itself reports (its plaintext `usage`), when it does.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
}

/// Reads progress out of complete lines of an event stream, leaving the bytes alone.
#[derive(Default)]
struct ProgressCounter {
    /// Up to where `body` has been read for line starts.
    scanned: usize,
    progress: StreamProgress,
}

impl ProgressCounter {
    fn update(&mut self, body: &[u8]) -> StreamProgress {
        while let Some(nl) = body[self.scanned..].iter().position(|&b| b == b'\n') {
            let line = &body[self.scanned..self.scanned + nl];
            self.scanned += nl + 1;
            let Some(data) = line.strip_prefix(b"data:") else { continue };
            let data = data.trim_ascii();
            if data == b"[DONE]" {
                continue;
            }
            self.progress.events += 1;
            let tokens = serde_json::from_slice::<serde_json::Value>(data)
                .ok()
                .and_then(|v| v.get("usage")?.get("completion_tokens")?.as_u64());
            if tokens.is_some() {
                self.progress.output_tokens = tokens;
            }
        }
        self.progress.bytes = body.len() as u64;
        self.progress
    }
}

/// The streamed notes request: always end-to-end encrypted (the keys are checked before
/// anything is sent), with the same headers as `chat`. Returns every byte of the event
/// stream exactly as received, once it has ended: the response signature covers them all.
/// Instead of a total timeout, it waits `first_byte` for the stream to start and `idle`
/// between pieces, reporting progress as pieces arrive.
pub async fn chat_stream_with(
    body: String,
    e2ee: E2ee,
    first_byte: Duration,
    idle: Duration,
    mut on_progress: impl FnMut(StreamProgress),
) -> Result<String, String> {
    let headers = e2ee_headers(&e2ee)?;
    // No total timeout on this client: the idle limit below decides.
    let client = reqwest::Client::builder().connect_timeout(Duration::from_secs(20)).build().map_err(|e| e.to_string())?;
    let mut req = client
        .post(format!("{}/chat/completions", base()))
        .bearer_auth(api_key()?)
        .header("content-type", "application/json")
        .header("accept", "text/event-stream")
        // The signature covers the exact response bytes, so no compression in between.
        .header("accept-encoding", "identity")
        .header("x-no-aliasing", "true");
    for (name, value) in headers {
        req = req.header(name, value);
    }
    let stopped = "NEAR AI stopped sending the notes, so Aftercall stopped waiting. Nothing was saved; try again.".to_string();
    let mut res = tokio::time::timeout(first_byte, req.body(body).send())
        .await
        .map_err(|_| stopped.clone())?
        .map_err(send_error)?;
    if !res.status().is_success() {
        return tokio::time::timeout(idle, body_text(res)).await.map_err(|_| stopped.clone())?;
    }
    let mut bytes: Vec<u8> = Vec::new();
    let mut counter = ProgressCounter::default();
    let mut last_report = std::time::Instant::now();
    loop {
        match tokio::time::timeout(idle, res.chunk()).await {
            Err(_) => return Err(stopped),
            Ok(Err(e)) => return Err(format!("The notes stream broke off: {e}")),
            Ok(Ok(None)) => break,
            Ok(Ok(Some(chunk))) => {
                bytes.extend_from_slice(&chunk);
                if bytes.len() > STREAM_MAX_BYTES {
                    return Err("NEAR AI's reply was far larger than notes can be, so Aftercall stopped reading it.".into());
                }
                let progress = counter.update(&bytes);
                // About four updates a second is plenty for the screen.
                if last_report.elapsed() >= Duration::from_millis(250) {
                    on_progress(progress);
                    last_report = std::time::Instant::now();
                }
            }
        }
    }
    on_progress(counter.update(&bytes));
    // Exact bytes matter: the response signature covers them.
    String::from_utf8(bytes).map_err(|_| "NEAR AI returned a body that isn't UTF-8".to_string())
}

/// `chat_stream_with` with the app's limits.
pub async fn chat_stream(body: String, e2ee: E2ee, on_progress: impl FnMut(StreamProgress)) -> Result<String, String> {
    chat_stream_with(body, e2ee, STREAM_FIRST_BYTE, STREAM_IDLE, on_progress).await
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
        .map_err(send_error)?;
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
    fn e2ee_keys_are_checked_before_sending() {
        let key = "ab".repeat(32);
        let ok = E2ee { client_pub_key: key.clone(), model_pub_key: "CD".repeat(32) };
        let headers = e2ee_headers(&ok).unwrap();
        assert!(headers.contains(&("x-encryption-version", "2".into())));
        assert!(headers.contains(&("x-signing-algo", "ed25519".into())));
        assert!(headers.contains(&("x-model-pub-key", "cd".repeat(32))));
        assert!(e2ee_headers(&E2ee { client_pub_key: key.clone(), model_pub_key: "ab".into() }).is_err());
        assert!(e2ee_headers(&E2ee { client_pub_key: format!("{key}\r\nx-evil: 1"), model_pub_key: key }).is_err());
    }

    #[test]
    fn progress_counts_events_and_reads_the_tokens_the_stream_reports() {
        let mut c = ProgressCounter::default();
        let first = b"data: {\"id\":\"c\",\"choices\":[]}\n\ndata: {\"id\":\"c\",\"usage\":{\"completion_tokens\":7}}\n\nda";
        assert_eq!(c.update(first), StreamProgress { bytes: first.len() as u64, events: 2, output_tokens: Some(7) });
        // The rest of a line split across pieces is counted once it's complete; [DONE] isn't an event.
        let mut all = first.to_vec();
        all.extend_from_slice(b"ta: {\"id\":\"c\",\"usage\":{\"completion_tokens\":9}}\r\n\r\n: comment\n\ndata: [DONE]\n\n");
        let p = c.update(&all);
        assert_eq!((p.events, p.output_tokens, p.bytes), (3, Some(9), all.len() as u64));
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
