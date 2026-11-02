//! "Delete everything on this Mac": the app's data folder (meetings, notes,
//! transcripts, audio, projects and their briefs, NEAR settings, the agents socket, settings and
//! activity list) and the Keychain items Aftercall keeps under the service
//! `dev.aftercall.app`.
//!
//! What it can't touch is said in the interface: proofs and payments on NEAR,
//! this Mac's key on the user's NEAR account, the agent wallet's balance, and
//! backup files the user exported.

use std::path::Path;

use serde::Serialize;

pub const KEYCHAIN_SERVICE: &str = "dev.aftercall.app";

/// Every Keychain account Aftercall uses (at_rest.rs, near.rs, nearai.rs, recovery.rs).
/// A test checks this list against the sources, so a new item can't be missed.
pub const KEYCHAIN_ITEMS: [&str; 4] = ["data-key", "near-app-key", "nearai-api-key", "backup-key"];

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Wiped {
    /// False when there was no data folder to remove.
    pub folder_removed: bool,
    pub keychain_removed: Vec<String>,
    /// Items the Keychain refused to delete, with its reason.
    pub keychain_failed: Vec<String>,
}

/// Removes the app's data folder and everything in it. Refuses any folder that isn't
/// Aftercall's own (its last part must be the app identifier) or that is itself a
/// symlink, so a wrong path can't take anything else with it. Links inside the folder
/// are removed, never followed. Ok(false) when there is nothing to remove.
pub fn remove_data_dir(dir: &Path, identifier: &str) -> Result<bool, String> {
    if identifier.is_empty() || dir.file_name().and_then(|n| n.to_str()) != Some(identifier) {
        return Err(format!("Not Aftercall's data folder: {}", dir.display()));
    }
    let meta = match std::fs::symlink_metadata(dir) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.to_string()),
    };
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err(format!("{} isn't a folder, so it was left alone", dir.display()));
    }
    std::fs::remove_dir_all(dir).map_err(|e| format!("Couldn't delete {}: {e}", dir.display()))?;
    Ok(true)
}

/// Deletes each Keychain item; one that isn't there counts as removed.
#[cfg(not(test))]
pub fn delete_keychain_items() -> (Vec<String>, Vec<String>) {
    let mut removed = vec![];
    let mut failed = vec![];
    for account in KEYCHAIN_ITEMS {
        let result = keyring::Entry::new(KEYCHAIN_SERVICE, account).and_then(|e| match e.delete_credential() {
            Err(keyring::Error::NoEntry) => Ok(()),
            other => other,
        });
        match result {
            Ok(()) => removed.push(account.to_string()),
            Err(e) => failed.push(format!("{account}: {e}")),
        }
    }
    (removed, failed)
}

/// Tests never touch the Keychain.
#[cfg(test)]
pub fn delete_keychain_items() -> (Vec<String>, Vec<String>) {
    (KEYCHAIN_ITEMS.iter().map(|s| s.to_string()).collect(), vec![])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const ID: &str = "dev.aftercall.app";

    fn scratch(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("aftercall-wipe-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn removes_the_whole_data_folder() {
        let root = scratch("all");
        let dir = root.join(ID);
        std::fs::create_dir_all(dir.join("recordings/1793006441/transcripts")).unwrap();
        std::fs::write(dir.join("recordings/1793006441/notes.json"), b"sealed").unwrap();
        std::fs::write(dir.join("recordings/1793006441/mic-000.wav"), b"sealed").unwrap();
        // Projects and their briefs, sealed in one file (projects.rs).
        crate::projects::save(&dir, vec![crate::projects::Project { id: "general".into(), name: "General".into(), brief: Some(crate::projects::Brief { about: "Seed round".into(), ..Default::default() }) }]).unwrap();
        std::fs::write(dir.join("near.json"), b"{}").unwrap();
        // Coding agents: settings, the activity list and the socket's folder.
        std::fs::write(dir.join("agents.json"), b"sealed").unwrap();
        std::fs::write(dir.join("agents-activity.json"), b"sealed").unwrap();
        std::fs::create_dir_all(dir.join("agents")).unwrap();
        // The ⌘⇧R choice from Settings.
        std::fs::write(dir.join("shortcut.json"), br#"{"everywhere":false}"#).unwrap();

        assert_eq!(remove_data_dir(&dir, ID), Ok(true));
        assert!(!dir.exists());
        assert!(root.exists(), "only the app's own folder goes");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn nothing_to_remove_is_fine() {
        let root = scratch("missing");
        assert_eq!(remove_data_dir(&root.join(ID), ID), Ok(false));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_a_folder_that_isnt_aftercalls() {
        let root = scratch("other");
        let dir = root.join("Documents");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("keep.txt"), b"mine").unwrap();
        assert!(remove_data_dir(&dir, ID).is_err());
        assert!(remove_data_dir(&root.join(ID), "").is_err());
        assert!(dir.join("keep.txt").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn links_are_removed_not_followed() {
        let root = scratch("links");
        let outside = root.join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("keep.txt"), b"mine").unwrap();
        let dir = root.join(ID);
        std::fs::create_dir_all(&dir).unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("link")).unwrap();

        assert_eq!(remove_data_dir(&dir, ID), Ok(true));
        assert!(outside.join("keep.txt").exists(), "the link's target survives");

        // A data folder that is itself a link is refused outright.
        let linked = root.join("linked").join(ID);
        std::fs::create_dir_all(linked.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&outside, &linked).unwrap();
        assert!(remove_data_dir(&linked, ID).is_err());
        assert!(outside.join("keep.txt").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn every_keychain_item_in_the_sources_is_deleted() {
        let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut found = vec![];
        for entry in std::fs::read_dir(&src).unwrap().flatten() {
            if entry.file_name() == "wipe.rs" {
                continue;
            }
            let text = std::fs::read_to_string(entry.path()).unwrap();
            for line in text.lines() {
                let line = line.trim();
                // `const KEYCHAIN_ACCOUNT: &str = "data-key";`, `const BACKUP_KEY_ACCOUNT: &str = "backup-key";`
                if line.starts_with("const ") && line.contains("ACCOUNT: &str = \"") {
                    found.push(line.split('"').nth(1).unwrap().to_string());
                }
                if line.starts_with("const KEYCHAIN_SERVICE") {
                    assert!(line.contains(&format!("\"{KEYCHAIN_SERVICE}\"")), "{}: {line}", entry.path().display());
                }
            }
        }
        found.sort();
        let mut expected: Vec<String> = KEYCHAIN_ITEMS.iter().map(|s| s.to_string()).collect();
        expected.sort();
        assert_eq!(found, expected);
        assert_eq!(delete_keychain_items(), (KEYCHAIN_ITEMS.iter().map(|s| s.to_string()).collect(), vec![]));
    }
}
