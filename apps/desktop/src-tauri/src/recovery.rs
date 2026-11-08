//! Recovery phrase and encrypted backups.
//!
//! A 12-word BIP39 phrase is the root of this Mac's NEAR key and of the backup key:
//! - the app key is SLIP-10 ed25519 at `APP_KEY_PATH`, so the same phrase always gives
//!   the same key and a new Mac can sign for the contract again;
//! - the backup key is HKDF-SHA256 over the BIP39 seed, used with XChaCha20-Poly1305.
//!
//! The phrase is never stored or logged. Only the two derived keys go to the Keychain.
//!
//! Separately, `new_wallet` makes a phrase for a brand-new NEAR account (Set up payments,
//! "Create one"): its key is at `WALLET_KEY_PATH`, where wallet apps such as Meteor look
//! when the phrase is imported. That phrase and its private key are never stored: only the
//! words (to show once) and the public key go back to the interface.

use std::collections::BTreeMap;
use std::path::Path;

use bip39::{Language, Mnemonic};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hmac::{Hmac, Mac};
use near_tx::KeyPair;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha512;
use zeroize::Zeroizing;

use crate::near;

/// NEAR's coin type (397) with an app-only branch. A NEAR wallet's own phrase derives its
/// full-access key at m/44'/397'/0', so entering one here never yields that key.
pub const APP_KEY_PATH: [u32; 4] = [44, 397, 0, 1];
/// Where NEAR wallets derive an account's full-access key from its phrase (Meteor, MyNearWallet
/// and near-cli-rs's seed-phrase default). Used only for an account Aftercall helps create.
pub const WALLET_KEY_PATH: [u32; 3] = [44, 397, 0];
const HARDENED: u32 = 0x8000_0000;

const KEYCHAIN_SERVICE: &str = "dev.aftercall.app";
const BACKUP_KEY_ACCOUNT: &str = "backup-key";

/// First bytes of a backup file; also bound into the encryption as associated data.
const MAGIC: &[u8] = b"AFTERCALL-BACKUP-1\n";
const NONCE_LEN: usize = 24;

// ---------- Phrase and keys ----------

/// A new random 12-word phrase. Nothing is stored until the user confirms it.
pub fn new_phrase() -> Result<String, String> {
    let mut entropy = Zeroizing::new([0u8; 16]);
    getrandom::getrandom(entropy.as_mut()).map_err(|e| e.to_string())?;
    let mnemonic = Mnemonic::from_entropy_in(Language::English, entropy.as_ref()).map_err(|e| e.to_string())?;
    Ok(mnemonic.to_string())
}

/// Parses a phrase typed by a person: any case, any spacing, 12 or 24 words.
pub fn parse_phrase(phrase: &str) -> Result<Mnemonic, String> {
    let words: Vec<String> = phrase.split_whitespace().map(|w| w.to_lowercase()).collect();
    if words.len() != 12 && words.len() != 24 {
        return Err(format!("A recovery phrase has 12 or 24 words; this has {}", words.len()));
    }
    if let Some(bad) = words.iter().position(|w| Language::English.find_word(w).is_none()) {
        return Err(format!("Word {} isn't a recovery phrase word. Check the spelling.", bad + 1));
    }
    Mnemonic::parse_in_normalized(Language::English, &words.join(" "))
        .map_err(|_| "These words don't form a valid recovery phrase. Check the order and spelling.".to_string())
}

fn seed(mnemonic: &Mnemonic) -> Zeroizing<[u8; 64]> {
    Zeroizing::new(mnemonic.to_seed_normalized(""))
}

/// SLIP-10 private key derivation for ed25519 (hardened indices only).
pub fn slip10_ed25519(seed: &[u8], path: &[u32]) -> Zeroizing<[u8; 32]> {
    let hmac = |key: &[u8], data: &[u8]| -> Zeroizing<[u8; 64]> {
        let mut mac = <Hmac<Sha512> as Mac>::new_from_slice(key).expect("HMAC takes any key length");
        mac.update(data);
        Zeroizing::new(mac.finalize().into_bytes().into())
    };
    let mut i = hmac(b"ed25519 seed", seed);
    for index in path {
        let mut data = Zeroizing::new(Vec::with_capacity(37));
        data.push(0);
        data.extend_from_slice(&i[..32]);
        data.extend_from_slice(&(index | HARDENED).to_be_bytes());
        i = hmac(&i[32..], &data);
    }
    let mut key = Zeroizing::new([0u8; 32]);
    key.copy_from_slice(&i[..32]);
    key
}

pub fn app_key_from(mnemonic: &Mnemonic) -> Result<KeyPair, String> {
    let private = slip10_ed25519(seed(mnemonic).as_ref(), &APP_KEY_PATH);
    let secret = Zeroizing::new(format!("ed25519:{}", bs58::encode(private.as_ref()).into_string()));
    KeyPair::from_secret(&secret)
}

/// The NEAR account key a wallet app derives from this phrase (`WALLET_KEY_PATH`).
pub fn wallet_key_from(mnemonic: &Mnemonic) -> Result<KeyPair, String> {
    let private = slip10_ed25519(seed(mnemonic).as_ref(), &WALLET_KEY_PATH);
    let secret = Zeroizing::new(format!("ed25519:{}", bs58::encode(private.as_ref()).into_string()));
    KeyPair::from_secret(&secret)
}

/// A phrase for a new NEAR account and the public key a wallet will derive from it. The
/// phrase is wiped from this side's memory when the value is dropped (after it's sent to
/// the interface); the private key never leaves `new_wallet`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewWallet {
    pub phrase: String,
    pub public_key: String,
}

impl Drop for NewWallet {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.phrase.zeroize();
    }
}

/// A new 12-word phrase for a NEAR account, with the public key at the wallet path. Nothing is
/// stored: not the phrase, not the key, not in the Keychain, not on disk.
pub fn new_wallet() -> Result<NewWallet, String> {
    let phrase = Zeroizing::new(new_phrase()?);
    let key = wallet_key_from(&parse_phrase(&phrase)?)?;
    Ok(NewWallet { phrase: phrase.to_string(), public_key: key.public_key() })
}

pub fn backup_key_from(mnemonic: &Mnemonic) -> Zeroizing<[u8; 32]> {
    let hk = hkdf::Hkdf::<sha2::Sha256>::new(Some(b"aftercall"), seed(mnemonic).as_ref());
    let mut key = Zeroizing::new([0u8; 32]);
    hk.expand(b"aftercall backup key v1", key.as_mut()).expect("32 bytes is a valid HKDF length");
    key
}

fn backup_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, BACKUP_KEY_ACCOUNT).map_err(|e| e.to_string())
}

/// Derives both keys from the phrase and stores them in the Keychain, replacing this
/// Mac's NEAR key. Returns the new public key.
pub fn use_phrase(phrase: &str) -> Result<String, String> {
    let mnemonic = parse_phrase(phrase)?;
    let key = app_key_from(&mnemonic)?;
    let backup = backup_key_from(&mnemonic);
    let encoded = Zeroizing::new(bs58::encode(backup.as_ref()).into_string());
    backup_entry()?.set_password(&encoded).map_err(|e| e.to_string())?;
    near::set_app_key(&key)?;
    Ok(key.public_key())
}

fn stored_backup_key() -> Result<Zeroizing<[u8; 32]>, String> {
    let encoded = match backup_entry()?.get_password() {
        Ok(v) => Zeroizing::new(v),
        Err(keyring::Error::NoEntry) => return Err("Create or restore a recovery phrase first".into()),
        Err(e) => return Err(e.to_string()),
    };
    let bytes = Zeroizing::new(bs58::decode(encoded.as_str()).into_vec().map_err(|e| e.to_string())?);
    let mut key = Zeroizing::new([0u8; 32]);
    if bytes.len() != 32 {
        return Err("The backup key in the Keychain is damaged".into());
    }
    key.copy_from_slice(&bytes);
    Ok(key)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryStatus {
    /// This Mac has a NEAR key at all.
    pub has_key: bool,
    /// The key (and the backup key) came from a recovery phrase.
    pub from_phrase: bool,
    pub public_key: Option<String>,
}

pub fn status() -> Result<RecoveryStatus, String> {
    let public_key = if near::has_app_key()? { Some(near::app_key()?.public_key()) } else { None };
    let from_phrase = match backup_entry()?.get_password() {
        Ok(_) => true,
        Err(keyring::Error::NoEntry) => false,
        Err(e) => return Err(e.to_string()),
    };
    Ok(RecoveryStatus { has_key: public_key.is_some(), from_phrase: from_phrase && public_key.is_some(), public_key })
}

// ---------- Encryption ----------

pub fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::getrandom(&mut nonce).map_err(|e| e.to_string())?;
    let cipher = XChaCha20Poly1305::new(key.into());
    let sealed = cipher
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: plaintext, aad: MAGIC })
        .map_err(|_| "Encryption failed".to_string())?;
    let mut out = Vec::with_capacity(MAGIC.len() + NONCE_LEN + sealed.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&sealed);
    Ok(out)
}

pub fn decrypt(key: &[u8; 32], file: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    let rest = file.strip_prefix(MAGIC).ok_or("This isn't an Aftercall backup file")?;
    if rest.len() < NONCE_LEN + 16 {
        return Err("This backup file is cut short".into());
    }
    let (nonce, sealed) = rest.split_at(NONCE_LEN);
    XChaCha20Poly1305::new(key.into())
        .decrypt(XNonce::from_slice(nonce), Payload { msg: sealed, aad: MAGIC })
        .map(Zeroizing::new)
        .map_err(|_| "This backup was made with a different recovery phrase, or the file is damaged".to_string())
}

// ---------- Backup contents ----------

/// What a backup holds: projects, the NEAR account settings, processed meetings
/// (meeting.json and notes.json, no audio), and the interface's saved settings.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub version: u32,
    pub created_at: u64,
    pub projects: Option<Value>,
    pub near: Option<Value>,
    pub meetings: Vec<BackupMeeting>,
    /// localStorage entries (autopilot rules and other settings), by key.
    pub local: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize)]
pub struct BackupMeeting {
    pub meta: Value,
    pub notes: Value,
}

/// Meeting files and projects.json are encrypted at rest with the data key: a backup
/// decrypts them here and seals the whole backup with the backup key instead.
fn read_json(path: &Path) -> Option<Value> {
    crate::at_rest::read_json(path)
}

fn valid_meeting_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 20 && id.chars().all(|c| c.is_ascii_digit())
}

/// Only localStorage keys the app owns, and never the onboarding flag: a new Mac
/// still needs its audio check and NEAR AI key.
fn keep_local(key: &str) -> bool {
    key.starts_with("aftercall.") && key != "aftercall.onboarded" && key.len() <= 100
}

/// Collects the backup from the app's data dir. Meetings without notes are left out:
/// their audio isn't backed up, so they couldn't be processed on another Mac.
pub fn collect(data_dir: &Path, local: BTreeMap<String, String>, now: u64) -> Backup {
    let mut meetings = vec![];
    if let Ok(entries) = std::fs::read_dir(data_dir.join("recordings")) {
        for entry in entries.flatten() {
            let (Some(meta), Some(notes)) = (read_json(&entry.path().join("meeting.json")), read_json(&entry.path().join("notes.json"))) else { continue };
            if meta["id"].as_str().is_some_and(valid_meeting_id) {
                meetings.push(BackupMeeting { meta, notes });
            }
        }
    }
    meetings.sort_by(|a, b| a.meta["id"].as_str().cmp(&b.meta["id"].as_str()));
    Backup {
        version: 1,
        created_at: now,
        projects: read_json(&data_dir.join("projects.json")),
        near: read_json(&near::config_path(data_dir)),
        meetings,
        local: local.into_iter().filter(|(k, _)| keep_local(k)).collect(),
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Restored {
    pub meetings: usize,
    /// Meetings already on this Mac, left as they are.
    pub skipped: usize,
    pub projects: usize,
    /// For the interface to put back in localStorage.
    pub local: BTreeMap<String, String>,
}

/// Writes a backup into the data dir without overwriting anything already there:
/// existing meetings and the NEAR settings stay, projects are merged by id.
pub fn apply(data_dir: &Path, backup: Backup) -> Result<Restored, String> {
    // Restored files are sealed with this Mac's data key.
    let write = |path: &Path, value: &Value| -> Result<(), String> {
        std::fs::create_dir_all(path.parent().ok_or("No parent folder")?).map_err(|e| e.to_string())?;
        crate::at_rest::write_json(path, value)
    };

    let mut projects = 0;
    if let Some(Value::Array(incoming)) = backup.projects {
        let path = data_dir.join("projects.json");
        let mut current = match read_json(&path) {
            Some(Value::Array(a)) => a,
            _ => vec![json!({ "id": "general", "name": "General" })],
        };
        for p in incoming {
            let (Some(id), Some(name)) = (p["id"].as_str(), p["name"].as_str()) else { continue };
            if id.is_empty() || id.len() > 64 || name.trim().is_empty() || name.chars().count() > 60 || current.len() >= 200 {
                continue;
            }
            let brief = crate::projects::restored_brief(&p["brief"]);
            if let Some(existing) = current.iter_mut().find(|c| c["id"] == id) {
                // The same project: its brief comes back only if this Mac has none for it.
                if existing.get("brief").is_none() {
                    if let Some(b) = brief {
                        existing["brief"] = b;
                    }
                }
                continue;
            }
            if !current.iter().any(|c| c["name"] == name) {
                let mut project = json!({ "id": id, "name": name });
                if let Some(b) = brief {
                    project["brief"] = b;
                }
                current.push(project);
                projects += 1;
            }
        }
        write(&path, &Value::Array(current))?;
    }

    if let Some(config) = backup.near {
        let path = near::config_path(data_dir);
        if !path.exists() {
            let config: near::NearConfig = serde_json::from_value(config).map_err(|e| format!("NEAR settings in the backup: {e}"))?;
            near::save_config(data_dir, &config)?;
        }
    }

    let (mut meetings, mut skipped) = (0, 0);
    for BackupMeeting { mut meta, notes } in backup.meetings {
        let Some(id) = meta["id"].as_str().filter(|id| valid_meeting_id(id)).map(String::from) else { continue };
        let dir = data_dir.join("recordings").join(&id);
        if dir.join("meeting.json").exists() {
            skipped += 1;
            continue;
        }
        meta["dir"] = dir.display().to_string().into();
        write(&dir.join("meeting.json"), &meta)?;
        write(&dir.join("notes.json"), &notes)?;
        meetings += 1;
    }

    let local = backup.local.into_iter().filter(|(k, _)| keep_local(k)).collect();
    Ok(Restored { meetings, skipped, projects, local })
}

/// A backup file's bytes: the backup collected at `now`, encrypted with `key`.
pub fn seal_with(key: &[u8; 32], data_dir: &Path, local: BTreeMap<String, String>, now: u64) -> Result<Vec<u8>, String> {
    let backup = collect(data_dir, local, now);
    let plaintext = Zeroizing::new(serde_json::to_vec(&backup).map_err(|e| e.to_string())?);
    encrypt(key, &plaintext)
}

/// A backup file's bytes, sealed with the Keychain's backup key: what Export backup
/// and automatic backups (`auto_backup.rs`) write.
pub fn seal(data_dir: &Path, local: BTreeMap<String, String>, now: u64) -> Result<Vec<u8>, String> {
    let key = stored_backup_key()?;
    seal_with(&key, data_dir, local, now)
}

pub fn now_secs() -> Result<u64, String> {
    Ok(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs())
}

/// Encrypts the backup with the Keychain's backup key and writes it to `folder`.
pub fn export(data_dir: &Path, folder: &Path, local: BTreeMap<String, String>) -> Result<String, String> {
    let now = now_secs()?;
    let file = seal(data_dir, local, now)?;
    let (y, m, d) = civil_date(now);
    let mut path = folder.join(format!("Aftercall backup {y:04}-{m:02}-{d:02}.aftercall"));
    for n in 2.. {
        if !path.exists() {
            break;
        }
        path = folder.join(format!("Aftercall backup {y:04}-{m:02}-{d:02} ({n}).aftercall"));
    }
    std::fs::write(&path, file).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

/// Decrypts a backup file with the Keychain's backup key and restores it.
pub fn import(data_dir: &Path, file: &[u8]) -> Result<Restored, String> {
    let key = stored_backup_key()?;
    let plaintext = decrypt(&key, file)?;
    let backup: Backup = serde_json::from_slice(&plaintext).map_err(|_| "This backup file can't be read")?;
    if backup.version != 1 {
        return Err("This backup comes from a newer Aftercall. Update the app first.".into());
    }
    apply(data_dir, backup)
}

/// UTC year, month, day from Unix seconds (for the file name).
pub(crate) fn civil_date(secs: u64) -> (i64, u32, u32) {
    let z = (secs / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn unhex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    const ABANDON: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    #[test]
    fn bip39_trezor_vector() {
        let m = parse_phrase(ABANDON).unwrap();
        assert_eq!(
            hex(&m.to_seed_normalized("TREZOR")),
            "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04"
        );
        assert_eq!(
            hex(seed(&m).as_ref()),
            "5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4"
        );
    }

    #[test]
    fn slip10_ed25519_vector_1() {
        let seed = unhex("000102030405060708090a0b0c0d0e0f");
        assert_eq!(hex(slip10_ed25519(&seed, &[]).as_ref()), "2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7");
        assert_eq!(hex(slip10_ed25519(&seed, &[0]).as_ref()), "68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3");
        assert_eq!(hex(slip10_ed25519(&seed, &[0, 1]).as_ref()), "b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2");
        assert_eq!(hex(slip10_ed25519(&seed, &[0, 1, 2]).as_ref()), "92a5b23c0b8a99e37d07df3fb9966917f5d06e02ddbd909c7e184371463e9fc9");
    }

    #[test]
    fn same_phrase_same_key_and_typing_is_forgiven() {
        let a = app_key_from(&parse_phrase(ABANDON).unwrap()).unwrap();
        let b = app_key_from(&parse_phrase(&format!("  {}  ", ABANDON.to_uppercase().replace(' ', "\n"))).unwrap()).unwrap();
        assert_eq!(a.public_key(), b.public_key());
        let other = app_key_from(&parse_phrase(&new_phrase().unwrap()).unwrap()).unwrap();
        assert_ne!(a.public_key(), other.public_key());
        // Not the key a NEAR wallet derives from the same phrase (m/44'/397'/0').
        let wallet = slip10_ed25519(seed(&parse_phrase(ABANDON).unwrap()).as_ref(), &[44, 397, 0]);
        assert_ne!(slip10_ed25519(seed(&parse_phrase(ABANDON).unwrap()).as_ref(), &APP_KEY_PATH), wallet);
    }

    #[test]
    fn wallet_key_is_the_one_near_wallets_derive() {
        // near-cli-rs 0.30.1, offline: `near account create-account fund-later use-seed-phrase
        // '<ABANDON>' --seed-phrase-hd-path "m/44'/397'/0'"` gives this public key.
        let key = wallet_key_from(&parse_phrase(ABANDON).unwrap()).unwrap();
        assert_eq!(key.public_key(), "ed25519:6j4b6zUaty6fD1awqcGCCU9JYGCWYUgdJhQrzfZhqE25");
        // Aftercall's own key (m/44'/397'/0'/1') from the same words is a different key.
        let app = app_key_from(&parse_phrase(ABANDON).unwrap()).unwrap();
        assert_ne!(app.public_key(), key.public_key());
        assert_eq!(WALLET_KEY_PATH, APP_KEY_PATH[..3]);
        assert_ne!(WALLET_KEY_PATH.len(), APP_KEY_PATH.len());
    }

    #[test]
    fn a_new_wallet_is_12_words_and_its_own_public_key() {
        let w = new_wallet().unwrap();
        assert_eq!(w.phrase.split(' ').count(), 12);
        let m = parse_phrase(&w.phrase).unwrap();
        assert_eq!(wallet_key_from(&m).unwrap().public_key(), w.public_key);
        assert_ne!(app_key_from(&m).unwrap().public_key(), w.public_key);
        // Only the phrase and the public key go to the interface.
        let sent = serde_json::to_value(&w).unwrap();
        assert_eq!(sent.as_object().unwrap().keys().collect::<Vec<_>>(), ["phrase", "publicKey"]);
        assert_ne!(new_wallet().unwrap().phrase, w.phrase);
    }

    #[test]
    fn new_phrases_are_12_valid_words() {
        let p = new_phrase().unwrap();
        assert_eq!(p.split(' ').count(), 12);
        assert!(parse_phrase(&p).is_ok());
        assert_ne!(p, new_phrase().unwrap());
    }

    #[test]
    fn bad_phrases_are_refused_with_a_reason() {
        assert!(parse_phrase("abandon abandon").unwrap_err().contains("12 or 24"));
        assert!(parse_phrase(&ABANDON.replace("about", "abuot")).unwrap_err().contains("Word 12"));
        // Real words, wrong checksum.
        assert!(parse_phrase(&ABANDON.replace("about", "abandon")).unwrap_err().contains("valid"));
    }

    #[test]
    fn backup_round_trips_and_a_wrong_phrase_fails() {
        let key = backup_key_from(&parse_phrase(ABANDON).unwrap());
        let file = encrypt(&key, b"{\"hello\":1}").unwrap();
        assert!(file.starts_with(MAGIC));
        assert_eq!(decrypt(&key, &file).unwrap().as_slice(), b"{\"hello\":1}");

        let wrong = backup_key_from(&parse_phrase(&new_phrase().unwrap()).unwrap());
        assert!(decrypt(&wrong, &file).unwrap_err().contains("different recovery phrase"));

        let mut tampered = file.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(decrypt(&key, &tampered).is_err());
        assert!(decrypt(&key, b"not a backup").unwrap_err().contains("isn't an Aftercall backup"));
    }

    #[test]
    fn collect_then_apply_restores_notes_projects_and_settings_but_not_audio() {
        let root = std::env::temp_dir().join(format!("aftercall-recovery-{}", std::process::id()));
        let (from, to) = (root.join("old-mac"), root.join("new-mac"));
        let _ = std::fs::remove_dir_all(&root);

        let done = from.join("recordings/1700000000");
        std::fs::create_dir_all(&done).unwrap();
        std::fs::write(done.join("meeting.json"), r#"{"id":"1700000000","project":"Fundraise","startedAt":1700000000,"seconds":60,"chunks":1,"dir":"/old"}"#).unwrap();
        std::fs::write(done.join("notes.json"), r#"{"title":"Sync"}"#).unwrap();
        std::fs::write(done.join("mic-000.wav"), b"audio").unwrap();
        let waiting = from.join("recordings/1700000500");
        std::fs::create_dir_all(&waiting).unwrap();
        std::fs::write(waiting.join("meeting.json"), r#"{"id":"1700000500","project":"General","dir":"/old"}"#).unwrap();
        std::fs::write(from.join("projects.json"), r#"[{"id":"general","name":"General"},{"id":"fundraise-a1b","name":"Fundraise"}]"#).unwrap();
        near::save_config(&from, &near::NearConfig { network: "testnet".into(), account: "ada.testnet".into(), contract: "w.testnet".into() }).unwrap();

        let local = BTreeMap::from([
            ("aftercall.autopilot".to_string(), r#"{"enabled":true}"#.to_string()),
            ("aftercall.onboarded".to_string(), "1".to_string()),
            ("other.app".to_string(), "x".to_string()),
        ]);
        // One file already sealed on the old Mac, the rest plaintext from an earlier version: both are read.
        crate::at_rest::migrate_file(&done.join("notes.json")).unwrap();
        let backup = collect(&from, local, 1_700_000_000);
        assert_eq!(backup.meetings.len(), 1, "meetings waiting for notes are left out");
        assert_eq!(backup.local.keys().collect::<Vec<_>>(), ["aftercall.autopilot"]);
        let text = serde_json::to_string(&backup).unwrap();
        assert!(!text.contains("audio"));

        let key = backup_key_from(&parse_phrase(ABANDON).unwrap());
        let file = encrypt(&key, text.as_bytes()).unwrap();
        let restored: Backup = serde_json::from_slice(&decrypt(&key, &file).unwrap()).unwrap();

        let r = apply(&to, restored).unwrap();
        assert_eq!((r.meetings, r.skipped, r.projects), (1, 0, 1));
        assert_eq!(r.local["aftercall.autopilot"], r#"{"enabled":true}"#);
        for f in ["projects.json", "recordings/1700000000/meeting.json", "recordings/1700000000/notes.json"] {
            assert!(crate::at_rest::is_sealed(&std::fs::read(to.join(f)).unwrap()), "{f} restored as plaintext");
        }
        let meta = read_json(&to.join("recordings/1700000000/meeting.json")).unwrap();
        assert_eq!(meta["dir"], to.join("recordings/1700000000").display().to_string());
        assert_eq!(read_json(&to.join("recordings/1700000000/notes.json")).unwrap()["title"], "Sync");
        assert!(!to.join("recordings/1700000000/mic-000.wav").exists());
        assert_eq!(near::load_config(&to).unwrap().account, "ada.testnet");

        // Importing again changes nothing.
        let again: Backup = serde_json::from_str(&text).unwrap();
        let r = apply(&to, again).unwrap();
        assert_eq!((r.meetings, r.skipped, r.projects), (0, 1, 0));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_backup_carries_project_briefs_and_restores_them_sealed() {
        let root = std::env::temp_dir().join(format!("aftercall-recovery-brief-{}", std::process::id()));
        let (from, to) = (root.join("old-mac"), root.join("new-mac"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&from).unwrap();
        let brief = json!({ "about": "Seed round, close by March", "people": [{ "name": "Ada", "role": "lead investor" }], "words": ["Northwind"], "watchFor": "valuation" });
        crate::at_rest::write_json(
            &from.join("projects.json"),
            &json!([{ "id": "general", "name": "General", "brief": { "about": "Everything else" } }, { "id": "fundraise-a1b", "name": "Fundraise", "brief": brief }, { "id": "bad-c2d", "name": "Bad", "brief": { "about": "x >>> y" } }]),
        )
        .unwrap();
        let backup = collect(&from, BTreeMap::new(), 1_700_000_000);
        assert_eq!(backup.projects.as_ref().unwrap()[1]["brief"], brief, "the backup holds the brief (the backup file itself is encrypted)");

        // The new Mac already has "General" without a brief.
        std::fs::create_dir_all(&to).unwrap();
        crate::at_rest::write_json(&to.join("projects.json"), &json!([{ "id": "general", "name": "General" }])).unwrap();
        let r = apply(&to, serde_json::from_str(&serde_json::to_string(&backup).unwrap()).unwrap()).unwrap();
        assert_eq!(r.projects, 2);
        let raw = std::fs::read(to.join("projects.json")).unwrap();
        assert!(crate::at_rest::is_sealed(&raw) && !raw.windows(9).any(|w| w == b"Northwind"));
        let restored = crate::projects::load(&to).unwrap();
        assert_eq!(restored[0].brief.as_ref().unwrap().about, "Everything else", "a project here with no brief gets the backup's");
        assert_eq!(restored[1].brief.as_ref().unwrap().words, ["Northwind"]);
        assert_eq!(restored[2].brief, None, "a brief that fails the checks is left out");

        // A brief already on this Mac is never overwritten.
        crate::projects::save(&to, vec![crate::projects::Project { id: "general".into(), name: "General".into(), brief: Some(crate::projects::Brief { about: "Mine".into(), ..Default::default() }) }]).unwrap();
        apply(&to, serde_json::from_str(&serde_json::to_string(&backup).unwrap()).unwrap()).unwrap();
        assert_eq!(crate::projects::load(&to).unwrap()[0].brief.as_ref().unwrap().about, "Mine");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn file_names_use_the_utc_date() {
        assert_eq!(civil_date(0), (1970, 1, 1));
        assert_eq!(civil_date(1_793_318_400), (2026, 10, 30));
        assert_eq!(civil_date(951_782_400), (2000, 2, 29));
    }
}
