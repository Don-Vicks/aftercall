//! The paired phone (docs/design/phone-protocol.md §5).
//!
//! The secrets, the Mac's relay secret key, its bearer token on the relay and the
//! session key, live in one Keychain item (`phone-relay`), never on disk. The web view
//! reads them while the app runs, because the relay's cryptography is the shared
//! TypeScript in packages/core/src/relay. Beside the app data, sealed like the other
//! settings (at_rest.rs), is `phone.json`: the pairing id, the backend, the phone's
//! label and public key, when it was paired, the two counters, the last acknowledged
//! action and the latest results. A counter saved here never goes back.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::at_rest;

const KEYCHAIN_SERVICE: &str = "dev.aftercall.app";
const KEYCHAIN_ACCOUNT: &str = "phone-relay";

/// What the Keychain holds. Each is 32 bytes as base64url (43 characters).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PhoneSecrets {
    pub mac_secret_key: String,
    pub mac_token: String,
    pub session_key: String,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Accepted,
    Refused,
}

/// What the Mac did with one of the phone's actions, by the action's counter.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ActionResult {
    pub n: u64,
    pub outcome: Outcome,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// phone.json: nothing here can open or forge a box.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PhoneState {
    /// The pairing id's base64url text, as in relay paths.
    pub pairing_id: String,
    /// The relay's origin.
    pub backend: String,
    /// "iPhone · Safari", from the phone's sealed hello.
    pub device: String,
    pub phone_public_key: String,
    /// When you pressed They match (ms since epoch).
    pub paired_at: u64,
    /// The last counter the Mac sealed a snapshot with.
    pub mac_n: u64,
    /// The highest action counter the Mac accepted from the phone.
    pub last_action_n: u64,
    /// The last relay `seq` acknowledged.
    pub acked_seq: u64,
    /// The latest results, newest first, for the next snapshot.
    #[serde(default)]
    pub results: Vec<ActionResult>,
}

/// Both halves, as the web view reads them at launch.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pairing {
    pub state: PhoneState,
    pub secrets: PhoneSecrets,
}

fn is_key_text(s: &str) -> bool {
    s.len() == 43 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// An https origin, or http on this machine for development (as `checkBackend` in core).
fn is_backend(s: &str) -> bool {
    let rest = match s.strip_prefix("https://") {
        Some(r) => r,
        None => match s.strip_prefix("http://") {
            Some(r) if ["localhost", "127.0.0.1", "[::1]"].iter().any(|h| r == *h || r.starts_with(&format!("{h}:"))) => r,
            _ => return false,
        },
    };
    !rest.is_empty() && !rest.contains(['/', '?', '#', '@', ' '])
}

pub fn check_secrets(s: &PhoneSecrets) -> Result<(), String> {
    if [&s.mac_secret_key, &s.mac_token, &s.session_key].iter().all(|k| is_key_text(k)) {
        Ok(())
    } else {
        Err("The phone's keys aren't in the expected form.".into())
    }
}

pub fn check_state(s: &PhoneState) -> Result<(), String> {
    if !is_key_text(&s.pairing_id) || !is_key_text(&s.phone_public_key) {
        return Err("The phone's pairing isn't in the expected form.".into());
    }
    if !is_backend(&s.backend) {
        return Err("The relay must be an https origin.".into());
    }
    if s.device.chars().count() > 40 || s.results.len() > 20 || s.results.iter().any(|r| r.reason.as_ref().is_some_and(|x| x.chars().count() > 200)) {
        return Err("The phone's details are too long.".into());
    }
    Ok(())
}

fn state_path(dir: &Path) -> PathBuf {
    dir.join("phone.json")
}

fn read_state(dir: &Path) -> Option<PhoneState> {
    at_rest::read_json(&state_path(dir)).and_then(|v| serde_json::from_value(v).ok())
}

fn write_state(dir: &Path, s: &PhoneState) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    at_rest::write_json(&state_path(dir), &serde_json::to_value(s).map_err(|e| e.to_string())?)
}

/// The paired phone, or None. A phone.json without its Keychain item (a new Mac, a wiped
/// Keychain) is no pairing: it is removed.
pub fn load(dir: &Path) -> Result<Option<Pairing>, String> {
    let Some(state) = read_state(dir) else { return Ok(None) };
    let secrets = match keychain::get()? {
        Some(text) => serde_json::from_str::<PhoneSecrets>(&text).ok().filter(|s| check_secrets(s).is_ok()),
        None => None,
    };
    match secrets {
        Some(secrets) if check_state(&state).is_ok() => Ok(Some(Pairing { state, secrets })),
        _ => {
            forget(dir)?;
            Ok(None)
        }
    }
}

/// Keeps a new pairing, replacing any old one: the secrets in the Keychain first, then phone.json.
pub fn pair(dir: &Path, state: &PhoneState, secrets: &PhoneSecrets) -> Result<(), String> {
    check_state(state)?;
    check_secrets(secrets)?;
    keychain::set(&serde_json::to_string(secrets).map_err(|e| e.to_string())?)?;
    write_state(dir, state)
}

/// Saves counters and results for the paired phone. Refused for another pairing, and
/// when a counter would go back: a box must never be sealed or accepted twice.
pub fn save(dir: &Path, state: &PhoneState) -> Result<(), String> {
    check_state(state)?;
    let Some(old) = read_state(dir) else { return Err("No phone is paired.".into()) };
    if old.pairing_id != state.pairing_id || old.phone_public_key != state.phone_public_key || old.backend != state.backend {
        return Err("That isn't the paired phone.".into());
    }
    if state.mac_n < old.mac_n || state.last_action_n < old.last_action_n || state.acked_seq < old.acked_seq {
        return Err("A counter can't go back.".into());
    }
    write_state(dir, state)
}

/// Forgets the phone on this Mac: the Keychain item and phone.json.
pub fn forget(dir: &Path) -> Result<(), String> {
    keychain::delete()?;
    match std::fs::remove_file(state_path(dir)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[cfg(not(test))]
mod keychain {
    use super::{KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE};

    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())
    }

    pub fn get() -> Result<Option<String>, String> {
        match entry()?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("Aftercall couldn't read your phone's keys from the Keychain ({e}). If macOS asked, choose Allow.")),
        }
    }

    pub fn set(value: &str) -> Result<(), String> {
        entry()?
            .set_password(value)
            .map_err(|e| format!("macOS Keychain didn't save your phone's keys ({e}). If macOS asked, choose Allow or Always Allow."))
    }

    pub fn delete() -> Result<(), String> {
        match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// Tests never touch the Keychain: one item in memory instead.
#[cfg(test)]
mod keychain {
    use std::sync::Mutex;

    static ITEM: Mutex<Option<String>> = Mutex::new(None);

    pub fn get() -> Result<Option<String>, String> {
        let _ = (super::KEYCHAIN_SERVICE, super::KEYCHAIN_ACCOUNT);
        Ok(ITEM.lock().unwrap().clone())
    }

    pub fn set(value: &str) -> Result<(), String> {
        *ITEM.lock().unwrap() = Some(value.to_string());
        Ok(())
    }

    pub fn delete() -> Result<(), String> {
        *ITEM.lock().unwrap() = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// The fake Keychain item is shared, so these tests take turns.
    static TURN: Mutex<()> = Mutex::new(());

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aftercall-phone-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn key(c: char) -> String {
        std::iter::repeat_n(c, 43).collect()
    }

    fn secrets() -> PhoneSecrets {
        PhoneSecrets { mac_secret_key: key('a'), mac_token: key('b'), session_key: key('c') }
    }

    fn state() -> PhoneState {
        PhoneState {
            pairing_id: key('d'),
            backend: "https://api.getaftercall.dev".into(),
            device: "iPhone · Safari".into(),
            phone_public_key: key('e'),
            paired_at: 1_762_440_000_000,
            mac_n: 1,
            last_action_n: 0,
            acked_seq: 0,
            results: vec![],
        }
    }

    #[test]
    fn a_pairing_is_kept_in_the_keychain_and_phone_json_and_forgotten_from_both() {
        let _turn = TURN.lock().unwrap();
        let dir = scratch("roundtrip");
        assert_eq!(load(&dir), Ok(None));
        pair(&dir, &state(), &secrets()).unwrap();
        assert_eq!(load(&dir), Ok(Some(Pairing { state: state(), secrets: secrets() })));
        let on_disk = std::fs::read(dir.join("phone.json")).unwrap();
        assert!(at_rest::is_sealed(&on_disk), "phone.json is sealed at rest");
        assert!(!String::from_utf8_lossy(&on_disk).contains(&key('c')), "no secret on disk");
        forget(&dir).unwrap();
        assert_eq!(load(&dir), Ok(None));
        assert_eq!(keychain::get(), Ok(None));
        assert!(!dir.join("phone.json").exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn phone_json_without_its_keychain_item_is_no_pairing() {
        let _turn = TURN.lock().unwrap();
        let dir = scratch("orphan");
        pair(&dir, &state(), &secrets()).unwrap();
        keychain::delete().unwrap();
        assert_eq!(load(&dir), Ok(None));
        assert!(!dir.join("phone.json").exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn counters_only_go_up_and_only_for_the_paired_phone() {
        let _turn = TURN.lock().unwrap();
        let dir = scratch("counters");
        assert!(save(&dir, &state()).is_err(), "nothing paired yet");
        pair(&dir, &PhoneState { mac_n: 5, last_action_n: 3, acked_seq: 9, ..state() }, &secrets()).unwrap();
        let next = PhoneState { mac_n: 6, last_action_n: 4, acked_seq: 10, results: vec![ActionResult { n: 4, outcome: Outcome::Accepted, reason: None }], ..state() };
        save(&dir, &next).unwrap();
        assert_eq!(load(&dir).unwrap().unwrap().state, next);
        assert!(save(&dir, &PhoneState { mac_n: 5, ..next.clone() }).is_err());
        assert!(save(&dir, &PhoneState { last_action_n: 3, ..next.clone() }).is_err());
        assert!(save(&dir, &PhoneState { acked_seq: 1, ..next.clone() }).is_err());
        assert!(save(&dir, &PhoneState { pairing_id: key('f'), ..next.clone() }).is_err(), "another pairing");
        forget(&dir).unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn keys_and_origins_are_checked() {
        assert!(check_secrets(&secrets()).is_ok());
        assert!(check_secrets(&PhoneSecrets { session_key: "short".into(), ..secrets() }).is_err());
        assert!(check_secrets(&PhoneSecrets { mac_token: format!("{}=", &key('b')[..42]), ..secrets() }).is_err());
        assert!(serde_json::from_str::<PhoneSecrets>(&format!(r#"{{"macSecretKey":"{0}","macToken":"{0}","sessionKey":"{0}","extra":1}}"#, key('a'))).is_err());
        for ok in ["https://api.getaftercall.dev", "http://localhost:3001", "http://127.0.0.1:3001", "http://[::1]:3001"] {
            assert!(check_state(&PhoneState { backend: ok.into(), ..state() }).is_ok(), "{ok}");
        }
        for bad in ["http://api.getaftercall.dev", "https://api.getaftercall.dev/relay", "https://u@api.example", "http://localhost.evil.com", "ftp://x", "https://"] {
            assert!(check_state(&PhoneState { backend: bad.into(), ..state() }).is_err(), "{bad}");
        }
        assert!(check_state(&PhoneState { device: "x".repeat(41), ..state() }).is_err());
        assert!(check_state(&PhoneState { phone_public_key: "x".into(), ..state() }).is_err());
    }
}
