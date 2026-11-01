//! "Your notes": what you type during a call, kept next to the recording as
//! `your-notes.json`, sealed with the data key like everything else (at_rest).
//!
//! They can change until the notes are made. Once `notes.json` exists they are
//! read-only: the meeting's notes were made from this version, so changing it
//! afterwards would make the page disagree with what was processed. The check
//! and the write happen under notes.json's lock, so a save can't slip in while
//! the notes are being written.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{at_rest, notes_file};

pub const FILE: &str = "your-notes.json";
/// About 25 pages of typing. More is almost certainly a paste by mistake.
pub const MAX_CHARS: usize = 50_000;
pub const LOCKED: &str = "These notes are read-only now: the meeting's notes were made from them";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    text: String,
    /// Unix seconds of the last save.
    updated_at: u64,
}

pub fn path(dir: &Path) -> PathBuf {
    dir.join(FILE)
}

/// The text saved for a recording, or None when there is none (or only blank space).
pub fn read(dir: &Path) -> Option<String> {
    let stored: Stored = serde_json::from_str(&at_rest::read_string(&path(dir)).ok()?).ok()?;
    if stored.text.trim().is_empty() { None } else { Some(stored.text) }
}

/// Saves your notes for the recording in `dir`. Refused once its notes.json exists,
/// for a folder that isn't there, and past `MAX_CHARS`.
pub fn save(dir: &Path, text: &str, now: u64) -> Result<(), String> {
    if text.chars().count() > MAX_CHARS {
        return Err(format!("Your notes can be up to {MAX_CHARS} characters"));
    }
    if !dir.is_dir() {
        return Err("No such recording".into());
    }
    let notes = dir.join("notes.json");
    notes_file::with_lock(&notes, || {
        if notes.exists() {
            return Err(LOCKED.into());
        }
        let json = serde_json::to_string_pretty(&Stored { text: text.to_string(), updated_at: now }).map_err(|e| e.to_string())?;
        at_rest::write_string(&path(dir), &json)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aftercall-your-notes-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn saves_sealed_and_reads_back() {
        let dir = temp("roundtrip");
        save(&dir, "Deposit 40 today, rest on sign-off.", 1_700_000_000).unwrap();
        let raw = std::fs::read(path(&dir)).unwrap();
        assert!(at_rest::is_sealed(&raw), "your-notes.json is written sealed");
        assert!(!raw.windows(7).any(|w| w == b"Deposit"), "no plaintext on disk");
        assert_eq!(read(&dir).as_deref(), Some("Deposit 40 today, rest on sign-off."));
        // A later save replaces the text.
        save(&dir, "Deposit 40 today.", 1_700_000_060).unwrap();
        assert_eq!(read(&dir).as_deref(), Some("Deposit 40 today."));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn read_only_once_notes_exist() {
        let dir = temp("locked");
        save(&dir, "Before the notes", 1).unwrap();
        std::fs::write(dir.join("notes.json"), "{}").unwrap();
        assert_eq!(save(&dir, "After the notes", 2).unwrap_err(), LOCKED);
        assert_eq!(read(&dir).as_deref(), Some("Before the notes"), "the saved text is untouched");
        assert!(!dir.join("notes.json.lock").exists(), "the lock is released after a refusal");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn refuses_a_missing_recording_and_oversized_text() {
        let dir = temp("refuse");
        let missing = dir.join("1700000000");
        assert_eq!(save(&missing, "Hello", 1).unwrap_err(), "No such recording");
        assert!(!missing.exists(), "no folder is made for an unknown recording");
        assert!(save(&dir, &"a".repeat(MAX_CHARS + 1), 1).is_err());
        assert!(save(&dir, &"é".repeat(MAX_CHARS), 1).is_ok(), "the limit counts characters, not bytes");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn blank_notes_read_as_none() {
        let dir = temp("blank");
        assert_eq!(read(&dir), None, "nothing saved yet");
        save(&dir, "  \n ", 1).unwrap();
        assert_eq!(read(&dir), None);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
