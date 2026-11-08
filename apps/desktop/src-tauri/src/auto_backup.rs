//! Automatic backups to iCloud Drive, off until you turn them on in Backups.
//!
//! Each run writes the same encrypted file as Export backup (`recovery::seal`: the same
//! backup key from the recovery phrase, the same format) to
//! `~/Library/Mobile Documents/com~apple~CloudDocs/Aftercall/`:
//! - one file per UTC day, "Aftercall auto-backup YYYY-MM-DD.aftercall", which later runs
//!   that day replace; it is written to a temp file and renamed, so iCloud never syncs half a file;
//! - the 7 newest automatic files are kept and older ones deleted. Nothing else in the folder
//!   is touched, such as a backup you exported there yourself.
//!
//! iCloud Drive's own folder is never created: when it isn't there (iCloud Drive is off),
//! the run says so. Only the `Aftercall` folder inside it is.
//!
//! The switch and the last run are kept in plain `auto-backup.json` in the app's folder, like
//! shortcut.json: they hold no secret. They aren't in backups, so restoring one on another
//! Mac never starts uploads to iCloud there, nor shows this Mac's last run.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};

/// iCloud Drive, from the home folder.
pub const ICLOUD_DRIVE: &str = "Library/Mobile Documents/com~apple~CloudDocs";
pub const FOLDER: &str = "Aftercall";
const PREFIX: &str = "Aftercall auto-backup ";
const SUFFIX: &str = ".aftercall";
/// Automatic files kept; older ones are deleted.
pub const KEEP: usize = 7;
/// At launch, a backup runs when the newest automatic one is older than this.
const DAY: u64 = 86_400;

pub const ICLOUD_OFF: &str = "iCloud Drive is off on this Mac. Turn on iCloud Drive in System Settings.";

/// One run at a time: notes saved during a launch-time run wait for it.
static RUNNING: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub enabled: bool,
    /// Unix seconds of the last automatic backup this Mac wrote, and its file name.
    pub last_at: Option<u64>,
    pub last_file: Option<String>,
    /// Why the last run failed, until one works.
    pub error: Option<String>,
    pub error_at: Option<u64>,
}

/// What Backups shows.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    #[serde(flatten)]
    pub settings: Settings,
    /// iCloud Drive's folder is there.
    pub icloud_on: bool,
    /// Where automatic backups go.
    pub folder: String,
}

fn settings_path(data_dir: &Path) -> PathBuf {
    data_dir.join("auto-backup.json")
}

pub fn load(data_dir: &Path) -> Settings {
    std::fs::read_to_string(settings_path(data_dir)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save(data_dir: &Path, settings: &Settings) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(data_dir), serde_json::to_string(settings).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

pub fn status(data_dir: &Path, home: &Path) -> Status {
    let root = home.join(ICLOUD_DRIVE);
    Status { settings: load(data_dir), icloud_on: root.is_dir(), folder: root.join(FOLDER).display().to_string() }
}

/// The `Aftercall` folder in iCloud Drive, made if needed. Refuses when iCloud Drive's
/// own folder isn't there, and never makes that one.
pub fn folder(home: &Path) -> Result<PathBuf, String> {
    let root = home.join(ICLOUD_DRIVE);
    if !root.is_dir() {
        return Err(ICLOUD_OFF.into());
    }
    let dir = root.join(FOLDER);
    match std::fs::create_dir(&dir) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(format!("Couldn't make the Aftercall folder in iCloud Drive: {e}")),
    }
    if !dir.is_dir() {
        return Err("Aftercall in iCloud Drive is a file, not a folder. Rename it, then turn this on again.".into());
    }
    Ok(dir)
}

/// "Aftercall auto-backup 2026-11-08.aftercall", by the UTC date.
pub fn file_name(now: u64) -> String {
    let (y, m, d) = crate::recovery::civil_date(now);
    format!("{PREFIX}{y:04}-{m:02}-{d:02}{SUFFIX}")
}

/// Only names `file_name` makes: anything else in the folder is never replaced or deleted.
pub fn is_auto_file(name: &str) -> bool {
    let Some(date) = name.strip_prefix(PREFIX).and_then(|rest| rest.strip_suffix(SUFFIX)) else { return false };
    let b = date.as_bytes();
    b.len() == 10 && b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
}

/// The automatic files in `dir`, newest date first.
fn auto_files(dir: &Path) -> Result<Vec<String>, String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| is_auto_file(n))
        .collect();
    names.sort_by(|a, b| b.cmp(a));
    Ok(names)
}

/// Writes a temp file beside `path`, then renames it over `path`.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write as _;
    let name = path.file_name().and_then(|n| n.to_str()).ok_or("No file name")?;
    let temp = path.with_file_name(format!(".{name}.tmp"));
    let result = (|| {
        let mut f = std::fs::File::create(&temp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        std::fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result.map_err(|e| e.to_string())
}

/// Deletes automatic files beyond the `KEEP` newest; returns how many went.
pub fn rotate(dir: &Path) -> Result<usize, String> {
    let mut names = auto_files(dir)?;
    let old = names.split_off(KEEP.min(names.len()));
    for name in &old {
        std::fs::remove_file(dir.join(name)).map_err(|e| format!("Couldn't remove {name}: {e}"))?;
    }
    Ok(old.len())
}

/// True when no automatic file in `dir` was written in the last day.
pub fn due(dir: &Path, now: u64) -> bool {
    let newest = auto_files(dir)
        .unwrap_or_default()
        .iter()
        .filter_map(|n| std::fs::metadata(dir.join(n)).and_then(|m| m.modified()).ok())
        .max();
    let now = SystemTime::UNIX_EPOCH + Duration::from_secs(now);
    newest.is_none_or(|t| now.duration_since(t).is_ok_and(|age| age.as_secs() > DAY))
}

/// A file written by `write`, and whether older ones could be rotated out.
struct Written {
    name: String,
    rotated: Result<usize, String>,
}

/// Writes today's file into the iCloud folder and rotates. None at launch when it isn't due.
fn write(home: &Path, now: u64, launch: bool, seal: impl FnOnce(u64) -> Result<Vec<u8>, String>) -> Result<Option<Written>, String> {
    let dir = folder(home)?;
    if launch && !due(&dir, now) {
        return Ok(None);
    }
    let bytes = seal(now)?;
    let name = file_name(now);
    write_atomic(&dir.join(&name), &bytes)?;
    Ok(Some(Written { name, rotated: rotate(&dir) }))
}

/// Saves the switch. Turning it on needs iCloud Drive and makes the Aftercall folder.
pub fn set_enabled(data_dir: &Path, home: &Path, on: bool) -> Result<Settings, String> {
    let _held = RUNNING.lock().unwrap_or_else(|e| e.into_inner());
    if on {
        folder(home)?;
    }
    let mut settings = load(data_dir);
    settings.enabled = on;
    settings.error = None;
    settings.error_at = None;
    save(data_dir, &settings)?;
    Ok(settings)
}

/// One automatic backup, if the switch is on. `launch`: only when the newest automatic file
/// is over a day old. `seal` makes the encrypted file (`recovery::seal`, or a test key).
/// Never fails: a problem is logged and kept for Backups to show; the notes are never touched.
pub fn run(data_dir: &Path, home: &Path, now: u64, launch: bool, seal: impl FnOnce(u64) -> Result<Vec<u8>, String>) -> Settings {
    let _held = RUNNING.lock().unwrap_or_else(|e| e.into_inner());
    let mut settings = load(data_dir);
    if !settings.enabled {
        return settings;
    }
    let failed = match write(home, now, launch, seal) {
        Ok(None) => return settings,
        Ok(Some(Written { name, rotated })) => {
            settings.last_at = Some(now);
            settings.last_file = Some(name);
            rotated.err().map(|e| format!("Backed up, but an older automatic backup couldn't be removed. {e}"))
        }
        Err(e) => Some(e),
    };
    if let Some(e) = &failed {
        eprintln!("auto backup: {e}");
    }
    settings.error_at = failed.as_ref().map(|_| now);
    settings.error = failed;
    if let Err(e) = save(data_dir, &settings) {
        eprintln!("auto backup: couldn't save its status: {e}");
    }
    settings
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recovery;
    use std::collections::BTreeMap;

    /// 8 Nov 2026, 12:00 UTC.
    const NOW: u64 = 1_794_139_200;

    /// A home folder with iCloud Drive on (or off) and an app data folder, in a temp dir.
    fn mac(name: &str, icloud: bool) -> (PathBuf, PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("aftercall-auto-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (home, data) = (root.join("home"), root.join("data"));
        std::fs::create_dir_all(&data).unwrap();
        std::fs::create_dir_all(if icloud { home.join(ICLOUD_DRIVE) } else { home.join("Library") }).unwrap();
        (root, home, data)
    }

    fn turned_on(data: &Path) {
        save(data, &Settings { enabled: true, ..Default::default() }).unwrap();
    }

    fn sealed(bytes: &'static [u8]) -> impl FnOnce(u64) -> Result<Vec<u8>, String> {
        move |_| Ok(bytes.to_vec())
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut n: Vec<String> = std::fs::read_dir(dir).unwrap().flatten().map(|e| e.file_name().into_string().unwrap()).collect();
        n.sort();
        n
    }

    #[test]
    fn names_are_one_per_utc_day_and_only_those_count_as_automatic() {
        assert_eq!(file_name(NOW), "Aftercall auto-backup 2026-11-08.aftercall");
        // 23:59:59 UTC is still the same day; a second later is the next.
        assert_eq!(file_name(1_794_182_399), "Aftercall auto-backup 2026-11-08.aftercall");
        assert_eq!(file_name(1_794_182_400), "Aftercall auto-backup 2026-11-09.aftercall");
        assert!(is_auto_file("Aftercall auto-backup 2026-11-08.aftercall"));
        for other in [
            "Aftercall backup 2026-11-08.aftercall",
            "Aftercall backup 2026-11-08 (2).aftercall",
            "Aftercall auto-backup 2026-11-08 (2).aftercall",
            "Aftercall auto-backup 2026-11-8.aftercall",
            "Aftercall auto-backup 2026-11-08.aftercall.tmp",
            ".Aftercall auto-backup 2026-11-08.aftercall.tmp",
            "Aftercall auto-backup 2026_11_08.aftercall",
            "aftercall auto-backup 2026-11-08.aftercall",
            "notes.txt",
        ] {
            assert!(!is_auto_file(other), "{other}");
        }
    }

    #[test]
    fn the_folder_is_made_inside_icloud_drive_only() {
        let (root, home, _) = mac("folder", true);
        let dir = folder(&home).unwrap();
        assert_eq!(dir, home.join("Library/Mobile Documents/com~apple~CloudDocs/Aftercall"));
        assert!(dir.is_dir());
        // Again: already there is fine.
        assert_eq!(folder(&home).unwrap(), dir);
        // A file named Aftercall is left alone and refused.
        std::fs::remove_dir(&dir).unwrap();
        std::fs::write(&dir, b"mine").unwrap();
        assert!(folder(&home).unwrap_err().contains("not a folder"));
        assert_eq!(std::fs::read(&dir).unwrap(), b"mine");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn with_icloud_drive_off_nothing_is_created_and_it_says_so() {
        let (root, home, data) = mac("off", false);
        assert!(folder(&home).unwrap_err().contains("Turn on iCloud Drive in System Settings"));
        assert!(set_enabled(&data, &home, true).unwrap_err().contains("Turn on iCloud Drive"));
        assert!(!load(&data).enabled, "the switch stays off");

        // On from before, then iCloud Drive turned off: the run says why and writes nothing.
        turned_on(&data);
        let s = run(&data, &home, NOW, false, sealed(b"x"));
        assert!(s.error.as_deref().unwrap().contains("Turn on iCloud Drive"));
        assert_eq!((s.error_at, s.last_at), (Some(NOW), None));
        assert!(!home.join("Library/Mobile Documents").exists(), "iCloud Drive's folder is never made");
        assert_eq!(load(&data), s, "the error is kept for Backups");
        assert!(!status(&data, &home).icloud_on);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn nothing_runs_while_the_switch_is_off() {
        let (root, home, data) = mac("switch", true);
        let s = run(&data, &home, NOW, false, |_| panic!("sealed with the switch off"));
        assert_eq!(s, Settings::default());
        assert!(!home.join(ICLOUD_DRIVE).join(FOLDER).exists());
        assert!(!settings_path(&data).exists());

        let on = set_enabled(&data, &home, true).unwrap();
        assert!(on.enabled && home.join(ICLOUD_DRIVE).join(FOLDER).is_dir());
        let off = set_enabled(&data, &home, false).unwrap();
        assert!(!off.enabled);
        assert!(run(&data, &home, NOW, false, |_| panic!("sealed after turning it off")).last_at.is_none());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_later_run_the_same_day_replaces_the_file_atomically() {
        let (root, home, data) = mac("same-day", true);
        turned_on(&data);
        let first = run(&data, &home, NOW, false, sealed(b"first"));
        assert_eq!(first.last_file.as_deref(), Some("Aftercall auto-backup 2026-11-08.aftercall"));
        assert_eq!((first.last_at, first.error), (Some(NOW), None));
        let dir = home.join(ICLOUD_DRIVE).join(FOLDER);
        let second = run(&data, &home, NOW + 3_600, false, sealed(b"second"));
        assert_eq!(second.last_at, Some(NOW + 3_600));
        // One file, the newer contents, and no temp file left behind.
        assert_eq!(names(&dir), ["Aftercall auto-backup 2026-11-08.aftercall"]);
        assert_eq!(std::fs::read(dir.join("Aftercall auto-backup 2026-11-08.aftercall")).unwrap(), b"second");
        // A failed seal leaves yesterday's good file and says why.
        let failed = run(&data, &home, NOW + 7_200, false, |_| Err("Create or restore a recovery phrase first".into()));
        assert_eq!(failed.error.as_deref(), Some("Create or restore a recovery phrase first"));
        assert_eq!(failed.last_at, Some(NOW + 3_600), "the last good run is still shown");
        assert_eq!(std::fs::read(dir.join("Aftercall auto-backup 2026-11-08.aftercall")).unwrap(), b"second");
        // The next good run clears the error.
        assert_eq!(run(&data, &home, NOW + 9_000, false, sealed(b"third")).error, None);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_seven_newest_automatic_files_stay_and_nothing_else_is_touched() {
        let (root, home, data) = mac("rotate", true);
        turned_on(&data);
        let dir = folder(&home).unwrap();
        let others = [
            "Aftercall backup 2026-10-01.aftercall",
            "Aftercall auto-backup 2026-10-01 (2).aftercall",
            "Aftercall auto-backup old.aftercall",
            "notes.txt",
        ];
        for o in others {
            std::fs::write(dir.join(o), b"keep").unwrap();
        }
        std::fs::create_dir(dir.join("Aftercall auto-backup 2026-10-02.aftercall")).unwrap();
        // Ten days of runs, one a day.
        for day in 0..10 {
            run(&data, &home, NOW - (9 - day) * DAY, false, sealed(b"x"));
        }
        let mut want: Vec<String> = (2..=8).map(|d| format!("Aftercall auto-backup 2026-11-{d:02}.aftercall")).collect();
        want.extend(others.iter().map(|s| s.to_string()));
        want.push("Aftercall auto-backup 2026-10-02.aftercall".into());
        want.sort();
        assert_eq!(names(&dir), want);
        for o in others {
            assert_eq!(std::fs::read(dir.join(o)).unwrap(), b"keep", "{o}");
        }
        assert_eq!(rotate(&dir).unwrap(), 0);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn at_launch_it_runs_only_when_the_newest_automatic_backup_is_over_a_day_old() {
        let (root, home, data) = mac("launch", true);
        turned_on(&data);
        // None yet: it runs.
        assert_eq!(run(&data, &home, NOW, true, sealed(b"a")).last_at, Some(NOW));
        // Just made: it doesn't, even on the next UTC day.
        let dir = home.join(ICLOUD_DRIVE).join(FOLDER);
        let file = dir.join(file_name(NOW));
        let set_age = |secs: u64| std::fs::File::options().write(true).open(&file).unwrap().set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(NOW - secs)).unwrap();
        set_age(0);
        assert!(!due(&dir, NOW + 13 * 3_600));
        assert_eq!(run(&data, &home, NOW + 13 * 3_600, true, |_| panic!("ran again within a day")).last_at, Some(NOW));
        // A manual export there doesn't count as an automatic backup.
        set_age(DAY + 1);
        std::fs::write(dir.join(file_name(NOW).replace("auto-backup", "backup")), b"manual").unwrap();
        assert!(due(&dir, NOW));
        assert_eq!(run(&data, &home, NOW, true, sealed(b"b")).last_at, Some(NOW));
        // After notes are saved it runs whatever the age.
        assert_eq!(run(&data, &home, NOW + 60, false, sealed(b"c")).last_at, Some(NOW + 60));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn an_automatic_backup_is_the_same_file_export_writes_and_restores_with_the_phrase() {
        let (root, home, data) = mac("format", true);
        turned_on(&data);
        std::fs::write(data.join("projects.json"), r#"[{"id":"general","name":"General"},{"id":"fundraise-a1b","name":"Fundraise"}]"#).unwrap();
        let key = recovery::backup_key_from(&recovery::parse_phrase("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about").unwrap());
        let local = BTreeMap::from([("aftercall.autopilot".to_string(), "{}".to_string())]);
        let s = run(&data, &home, NOW, false, |now| recovery::seal_with(&key, &data, local, now));
        let file = std::fs::read(home.join(ICLOUD_DRIVE).join(FOLDER).join(s.last_file.unwrap())).unwrap();
        assert!(file.starts_with(b"AFTERCALL-BACKUP-1\n"));
        let backup: recovery::Backup = serde_json::from_slice(&recovery::decrypt(&key, &file).unwrap()).unwrap();
        assert_eq!((backup.version, backup.created_at), (1, NOW));
        assert_eq!(backup.projects.unwrap()[1]["name"], "Fundraise");
        assert_eq!(backup.local.keys().collect::<Vec<_>>(), ["aftercall.autopilot"]);
        std::fs::remove_dir_all(root).unwrap();
    }
}
