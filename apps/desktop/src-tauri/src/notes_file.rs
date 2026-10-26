//! notes.json is written by the app and by the local MCP server (apps/mcp), which
//! lets agents claim and complete action items. Both follow the same rules: hold
//! `notes.json.lock`, re-read the file, change it, write a temp file and rename it
//! over the old one. A lock older than 10 s is left over from a crash and is taken over.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::Value;

const LOCK_STALE: Duration = Duration::from_secs(10);
const LOCK_WAIT: Duration = Duration::from_secs(5);

/// Action-item fields owned by the item's own commands (the checkbox and agents), not by whole-file saves.
const ITEM_STATE: [&str; 3] = ["done", "claimed", "completed"];

fn lock_path(file: &Path) -> PathBuf {
    let mut p = file.as_os_str().to_owned();
    p.push(".lock");
    PathBuf::from(p)
}

pub fn with_lock<T>(file: &Path, f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let lock = lock_path(file);
    let deadline = Instant::now() + LOCK_WAIT;
    loop {
        match OpenOptions::new().write(true).create_new(true).open(&lock) {
            Ok(mut h) => {
                let _ = write!(h, "app {}", std::process::id());
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                let age = std::fs::metadata(&lock).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).unwrap_or_default();
                if age > LOCK_STALE {
                    let _ = std::fs::remove_file(&lock);
                } else if Instant::now() > deadline {
                    return Err("The notes file is busy; try again in a moment".into());
                } else {
                    std::thread::sleep(Duration::from_millis(20));
                }
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    let out = f();
    let _ = std::fs::remove_file(&lock);
    out
}

/// Writes a temp file next to `file`, then renames it over `file`.
pub fn write_atomic(file: &Path, contents: &str) -> Result<(), String> {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    let mut tmp = file.as_os_str().to_owned();
    tmp.push(format!(".tmp-{}-{nanos:x}", std::process::id()));
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

/// Copies done/claimed/completed for each action item from the notes on disk into
/// the notes being saved, so a save from the app's memory never undoes an agent's
/// claim or a tick made since the app last read the file.
pub fn keep_item_state(incoming: &mut Value, disk: &Value) {
    let Some(on_disk) = disk["meeting"]["actionItems"].as_array() else { return };
    let Some(items) = incoming["meeting"]["actionItems"].as_array_mut() else { return };
    for item in items {
        let Some(saved) = on_disk.iter().find(|d| d["id"] == item["id"] && !item["id"].is_null()) else { continue };
        let Some(obj) = item.as_object_mut() else { continue };
        for key in ITEM_STATE {
            match saved.get(key) {
                Some(v) => obj.insert(key.into(), v.clone()),
                None => obj.remove(key),
            };
        }
    }
}

/// Saves notes.json from the app, keeping action-item state already on disk.
pub fn save(file: &Path, notes: &str) -> Result<(), String> {
    let mut incoming: Value = serde_json::from_str(notes).map_err(|e| e.to_string())?;
    with_lock(file, || {
        if let Some(disk) = std::fs::read_to_string(file).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) {
            keep_item_state(&mut incoming, &disk);
        }
        write_atomic(file, &serde_json::to_string_pretty(&incoming).map_err(|e| e.to_string())?)
    })
}

/// Ticks or unticks one action item. Unticking clears an agent's completion (not its claim).
/// Returns the saved notes.
pub fn set_item_done(file: &Path, item_id: &str, done: bool) -> Result<String, String> {
    with_lock(file, || {
        let mut notes: Value = serde_json::from_str(&std::fs::read_to_string(file).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        let item = notes["meeting"]["actionItems"]
            .as_array_mut()
            .and_then(|items| items.iter_mut().find(|i| i["id"] == item_id))
            .and_then(Value::as_object_mut)
            .ok_or("No such action item")?;
        item.insert("done".into(), done.into());
        if !done {
            item.remove("completed");
        }
        let json = serde_json::to_string_pretty(&notes).map_err(|e| e.to_string())?;
        write_atomic(file, &json)?;
        Ok(json)
    })
}

/// Rewrites a JSON file under its lock (used when re-filing meetings under another project).
pub fn update(file: &Path, change: impl FnOnce(&mut Value)) -> Result<(), String> {
    with_lock(file, || {
        let mut v: Value = serde_json::from_str(&std::fs::read_to_string(file).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        change(&mut v);
        write_atomic(file, &serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_notes(v: &Value) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aftercall-notes-{}-{:?}", std::process::id(), std::thread::current().id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("notes.json");
        std::fs::write(&file, v.to_string()).unwrap();
        file
    }

    fn notes(items: Value) -> Value {
        json!({ "meeting": { "title": "Sync", "actionItems": items }, "proof": { "notesHash": "x" } })
    }

    #[test]
    fn save_keeps_agent_claims_made_since_the_app_read_the_file() {
        let claim = json!({ "agent": "Codex", "at": "2026-10-26T12:00:00Z" });
        let file = temp_notes(&notes(json!([{ "id": "a1", "text": "Send plan", "done": false, "claimed": claim }, { "id": "a2", "done": true }])));
        // The app's copy is older: no claim, and a stale tick on a2.
        let mut stale = notes(json!([{ "id": "a1", "text": "Send plan", "done": false }, { "id": "a2", "done": false }]));
        stale["meeting"]["title"] = "Renamed".into();
        save(&file, &stale.to_string()).unwrap();
        let saved: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(saved["meeting"]["title"], "Renamed");
        assert_eq!(saved["meeting"]["actionItems"][0]["claimed"], claim);
        assert_eq!(saved["meeting"]["actionItems"][1]["done"], true);
        assert!(!lock_path(&file).exists());
    }

    #[test]
    fn untick_clears_completion_but_keeps_claim() {
        let file = temp_notes(&notes(json!([{ "id": "a1", "done": true, "claimed": { "agent": "Codex" }, "completed": { "agent": "Codex" } }])));
        let json = set_item_done(&file, "a1", false).unwrap();
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["meeting"]["actionItems"][0]["done"], false);
        assert!(v["meeting"]["actionItems"][0].get("completed").is_none());
        assert_eq!(v["meeting"]["actionItems"][0]["claimed"]["agent"], "Codex");
        assert!(set_item_done(&file, "zz", true).is_err());
    }

    #[test]
    fn stale_lock_is_taken_over() {
        let file = temp_notes(&notes(json!([{ "id": "a1", "done": false }])));
        let lock = lock_path(&file);
        std::fs::write(&lock, "mcp 1").unwrap();
        let old = SystemTime::now() - Duration::from_secs(60);
        std::fs::File::options().write(true).open(&lock).unwrap().set_modified(old).unwrap();
        set_item_done(&file, "a1", true).unwrap();
        assert!(!lock.exists());
    }
}
