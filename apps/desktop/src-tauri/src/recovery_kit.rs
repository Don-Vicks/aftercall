//! A recovery kit: the one page of words you can save from a phrase screen
//! (RecoveryPhrase.tsx), for a new NEAR account's phrase or Aftercall's own.
//!
//! The interface writes the text and the native Save dialog picks the path; this puts the
//! file there and nowhere else. No temp file, no copy in the app's folders. It refuses
//! Aftercall's own folders (data, config, cache, logs), so a phrase never sits beside the
//! app's files or ends up in a backup. The file is readable by you alone (0600), and the
//! text is never logged or put in an error message.

use std::fs::{OpenOptions, Permissions};
use std::io::Write;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Component, Path, PathBuf};

/// A kit is one page, well under a kilobyte. Anything far bigger isn't one.
const MAX_KIT_BYTES: usize = 8 * 1024;

/// Lowercased components, for comparing paths on macOS's case-insensitive disks.
fn folded(path: &Path) -> Vec<String> {
    path.components()
        .filter(|c| !matches!(c, Component::CurDir))
        .map(|c| c.as_os_str().to_string_lossy().to_lowercase())
        .collect()
}

/// `path` is `dir` or inside it, ignoring case.
fn inside(path: &Path, dir: &Path) -> bool {
    let (p, d) = (folded(path), folded(dir));
    p.len() >= d.len() && p[..d.len()] == d[..]
}

/// Writes `text` to `path` (from the Save dialog) with 0600 permissions. Refuses a path in
/// any of `app_dirs`, a relative path, a folder that doesn't exist, and an existing file that
/// is a link or a directory. Replacing a plain file you picked is allowed: the dialog has
/// already asked whether to.
pub fn save(path: &Path, text: &str, app_dirs: &[PathBuf]) -> Result<PathBuf, String> {
    if text.trim().is_empty() || text.len() > MAX_KIT_BYTES {
        return Err("That isn't a recovery kit.".into());
    }
    if app_dirs.is_empty() {
        return Err("Couldn't find Aftercall's own folders, so the kit wasn't saved.".into());
    }
    if !path.is_absolute() {
        return Err("Pick a folder for the kit in the Save dialog.".into());
    }
    let name = path.file_name().ok_or("Pick a file name for the kit.")?;
    let folder = path
        .parent()
        .ok_or("Pick a folder for the kit.")?
        .canonicalize()
        .map_err(|_| "That folder doesn't exist any more. Pick another.".to_string())?;
    let target = folder.join(name);

    let refused = "Save the kit outside Aftercall's own folders: on a USB drive, or print it.";
    for dir in app_dirs {
        // A folder that doesn't exist yet can't be resolved; compare it as given.
        let real = dir.canonicalize().unwrap_or_else(|_| dir.clone());
        if inside(&target, &real) || inside(&target, dir) {
            return Err(refused.into());
        }
    }

    if let Ok(meta) = std::fs::symlink_metadata(&target) {
        // A link (soft or hard) could point anywhere, including Aftercall's folders.
        if meta.file_type().is_symlink() || !meta.is_file() || meta.nlink() > 1 {
            return Err("Pick a new file name: that one isn't a plain file.".into());
        }
    }

    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&target)
        .map_err(|e| format!("Couldn't save the kit: {}", e.kind()))?;
    // An existing file keeps its old mode on open; tighten it before any words go in.
    file.set_permissions(Permissions::from_mode(0o600)).map_err(|e| format!("Couldn't save the kit: {}", e.kind()))?;
    file.write_all(text.as_bytes()).map_err(|e| format!("Couldn't save the kit: {}", e.kind()))?;
    file.sync_all().map_err(|e| format!("Couldn't save the kit: {}", e.kind()))?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A sample kit: the BIP39 test words, never a real phrase.
    const KIT: &str = "Aftercall recovery kit\n01  abandon\n02  abandon\n12  about\n";

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aftercall-kit-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    fn mode(path: &Path) -> u32 {
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn writes_the_kit_readable_by_you_alone() {
        let root = scratch("write");
        let app = root.join("Application Support/xyz.aftercall.app");
        std::fs::create_dir_all(&app).unwrap();
        let path = root.join("ada.testnet recovery kit.txt");

        let saved = save(&path, KIT, &[app.clone()]).unwrap();
        assert_eq!(saved, path);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), KIT);
        assert_eq!(mode(&path), 0o600);

        // Replacing a file that was readable by everyone tightens it too.
        std::fs::write(&path, "old").unwrap();
        std::fs::set_permissions(&path, Permissions::from_mode(0o644)).unwrap();
        save(&path, KIT, &[app]).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), KIT);
        assert_eq!(mode(&path), 0o600);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn refuses_the_apps_own_folders() {
        let root = scratch("refuse");
        let data = root.join("Application Support/xyz.aftercall.app");
        let cache = root.join("Caches/xyz.aftercall.app");
        std::fs::create_dir_all(data.join("recordings")).unwrap();
        let dirs = [data.clone(), cache.clone()];

        for path in [
            data.join("kit.txt"),
            data.join("recordings/kit.txt"),
            // The same folder reached through `..`, and in other letter case.
            data.join("recordings/../kit.txt"),
            PathBuf::from(data.to_string_lossy().to_uppercase()).join("kit.txt"),
        ] {
            let err = save(&path, KIT, &dirs).unwrap_err();
            assert!(err.contains("outside Aftercall's own folders"), "{path:?}: {err}");
            assert!(!err.contains("abandon"), "the words never go in an error");
        }
        // A folder of the app's that doesn't exist yet is refused as given.
        std::fs::create_dir_all(&cache).unwrap();
        assert!(save(&cache.join("kit.txt"), KIT, &dirs).is_err());
        assert!(!data.join("kit.txt").exists() && !cache.join("kit.txt").exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn refuses_links_relative_paths_and_non_kits() {
        let root = scratch("links");
        let app = root.join("app");
        std::fs::create_dir_all(&app).unwrap();
        let dirs = [app.clone()];

        // A link next to you that points into the app's folder.
        let link = root.join("kit.txt");
        std::os::unix::fs::symlink(app.join("inside.txt"), &link).unwrap();
        assert!(save(&link, KIT, &dirs).unwrap_err().contains("isn't a plain file"));
        assert!(!app.join("inside.txt").exists());

        // A hard link to a file inside the app's folder.
        std::fs::write(app.join("notes.json"), "{}").unwrap();
        let hard = root.join("hard.txt");
        std::fs::hard_link(app.join("notes.json"), &hard).unwrap();
        assert!(save(&hard, KIT, &dirs).is_err());
        assert_eq!(std::fs::read_to_string(app.join("notes.json")).unwrap(), "{}");

        // A folder whose name was picked as the file.
        assert!(save(&app, KIT, &[root.join("elsewhere")]).is_err());
        assert!(save(Path::new("kit.txt"), KIT, &dirs).is_err());
        assert!(save(&root.join("missing/kit.txt"), KIT, &dirs).is_err());
        assert!(save(&root.join("empty.txt"), "  ", &dirs).is_err());
        assert!(save(&root.join("big.txt"), &"a".repeat(MAX_KIT_BYTES + 1), &dirs).is_err());
        assert!(save(&root.join("nodirs.txt"), KIT, &[]).is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
