//! notes.json is written by the interface and, through the app, by connected agents
//! (agents.rs), which claim and complete action items. Ticks, edits, claims and
//! completions each change only their own fields of one item. Every write follows the same
//! rules: hold `notes.json.lock`, re-read the file, change it, write a temp file and
//! rename it over the old one. A lock older than 10 s is left over from a crash and is
//! taken over. The file is encrypted at rest (at_rest.rs); the lock file holds no content.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::at_rest;

use serde_json::Value;

const LOCK_STALE: Duration = Duration::from_secs(10);
const LOCK_WAIT: Duration = Duration::from_secs(5);

/// Action-item fields owned by the item's own commands (the checkbox and agents), not by whole-file saves.
const ITEM_STATE: [&str; 3] = ["done", "claimed", "completed"];

/// Action-item fields owned by `edit_item` (your edits after signing), not by whole-file saves.
const ITEM_EDIT: [&str; 4] = ["text", "owner", "due", "edited"];

/// The most an edited item may hold, in characters (as `cleanItemFields` in core).
const TEXT_MAX: usize = 300;
const OWNER_MAX: usize = 80;
const DUE_MAX: usize = 60;

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

/// Encrypts `contents`, writes a temp file next to `file`, then renames it over `file`.
pub fn write_atomic(file: &Path, contents: &str) -> Result<(), String> {
    at_rest::write_string(file, contents)
}

/// The notes on disk (encrypted, or plaintext from an earlier version).
pub fn read(file: &Path) -> Result<Value, String> {
    serde_json::from_str(&at_rest::read_string(file)?).map_err(|e| e.to_string())
}

/// Copies done/claimed/completed for each action item from the notes on disk into
/// the notes being saved, so a save from the app's memory never undoes an agent's
/// claim or a tick made since the app last read the file. Your edits (text, owner,
/// due, edited) are copied too while both hold the same signed notes; new notes for
/// the meeting start from what the model signed.
pub fn keep_item_state(incoming: &mut Value, disk: &Value) {
    let same_notes = !disk["proof"]["notesHash"].is_null() && disk["proof"]["notesHash"] == incoming["proof"]["notesHash"];
    let Some(on_disk) = disk["meeting"]["actionItems"].as_array() else { return };
    let Some(items) = incoming["meeting"]["actionItems"].as_array_mut() else { return };
    for item in items {
        let Some(saved) = on_disk.iter().find(|d| d["id"] == item["id"] && !item["id"].is_null()) else { continue };
        let Some(obj) = item.as_object_mut() else { continue };
        let edits: &[&str] = if same_notes { &ITEM_EDIT } else { &[] };
        for key in ITEM_STATE.iter().chain(edits) {
            match saved.get(*key) {
                Some(v) => obj.insert((*key).into(), v.clone()),
                None => obj.remove(*key),
            };
        }
    }
}

/// Saves notes.json from the app, keeping action-item state already on disk.
pub fn save(file: &Path, notes: &str) -> Result<(), String> {
    let mut incoming: Value = serde_json::from_str(notes).map_err(|e| e.to_string())?;
    with_lock(file, || {
        if let Ok(disk) = read(file) {
            keep_item_state(&mut incoming, &disk);
        }
        write_atomic(file, &serde_json::to_string_pretty(&incoming).map_err(|e| e.to_string())?)
    })
}

/// Ticks or unticks one action item. Unticking clears an agent's completion (not its claim).
/// Returns the saved notes.
pub fn set_item_done(file: &Path, item_id: &str, done: bool) -> Result<String, String> {
    with_lock(file, || {
        let mut notes = read(file)?;
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

/// An action item as you typed it in the edit row.
pub struct ItemDraft {
    pub text: String,
    pub owner: String,
    pub due: Option<String>,
}

/// Text, owner and due date of an item.
#[derive(Debug, PartialEq)]
struct Fields {
    text: String,
    owner: String,
    due: Option<String>,
}

/// The model's signed item behind `item_id`: ids are `a{i+1}` for index i in
/// notes.action_items. Tidied the way `clean` tidies a draft (trimmed, a missing or empty
/// owner reads "Unassigned"), so saving the item unchanged is no edit.
fn signed_original(notes: &Value, item_id: &str) -> Option<Fields> {
    let n: usize = item_id.strip_prefix('a').filter(|d| !d.starts_with('0') && d.len() <= 4)?.parse().ok()?;
    let a = notes["notes"]["action_items"].get(n.checked_sub(1)?)?;
    Some(Fields {
        text: a["text"].as_str()?.trim().to_string(),
        owner: a["owner"].as_str().map(str::trim).filter(|o| !o.is_empty()).unwrap_or("Unassigned").to_string(),
        due: a["due"].as_str().map(str::trim).filter(|d| !d.is_empty()).map(str::to_string),
    })
}

/// Trimmed; an empty owner is "Unassigned" and an empty due date is none.
fn clean(draft: ItemDraft) -> Result<Fields, String> {
    let text = draft.text.trim().to_string();
    let owner = Some(draft.owner.trim()).filter(|o| !o.is_empty()).unwrap_or("Unassigned").to_string();
    let due = draft.due.as_deref().map(str::trim).filter(|d| !d.is_empty()).map(str::to_string);
    if text.is_empty() {
        return Err("Write what needs doing".into());
    }
    if text.chars().count() > TEXT_MAX {
        return Err(format!("Keep it under {TEXT_MAX} characters"));
    }
    if owner.chars().count() > OWNER_MAX {
        return Err(format!("Keep the owner under {OWNER_MAX} characters"));
    }
    if due.as_ref().is_some_and(|d| d.chars().count() > DUE_MAX) {
        return Err(format!("Keep the due date under {DUE_MAX} characters"));
    }
    Ok(Fields { text, owner, due })
}

/// Changes one action item's text, owner and due date, or with no draft puts back what
/// the model signed. Only the meeting's copy changes: notes.action_items, which the
/// proof's hash covers, stays as signed. `edited` records when and which fields now
/// differ from the signed item, and goes away when none do. Done, claims and
/// completions are left alone. Returns the saved notes.
pub fn edit_item(file: &Path, item_id: &str, draft: Option<ItemDraft>, at: &str) -> Result<String, String> {
    let wanted = draft.map(clean).transpose()?;
    with_lock(file, || {
        let mut notes = read(file)?;
        let original = signed_original(&notes, item_id).ok_or("This action item has no signed original, so it can't be edited")?;
        let item = notes["meeting"]["actionItems"]
            .as_array_mut()
            .and_then(|items| items.iter_mut().find(|i| i["id"] == item_id))
            .and_then(Value::as_object_mut)
            .ok_or("No such action item")?;
        let now = wanted.unwrap_or(Fields { text: original.text.clone(), owner: original.owner.clone(), due: original.due.clone() });
        let mut changed = Vec::new();
        if now.text != original.text {
            changed.push("text");
        }
        if now.owner != original.owner {
            changed.push("owner");
        }
        if now.due != original.due {
            changed.push("due");
        }
        item.insert("text".into(), now.text.into());
        item.insert("owner".into(), now.owner.into());
        match now.due {
            Some(d) => item.insert("due".into(), d.into()),
            None => item.remove("due"),
        };
        if changed.is_empty() {
            item.remove("edited");
        } else {
            item.insert("edited".into(), serde_json::json!({ "at": at, "fields": changed }));
        }
        let json = serde_json::to_string_pretty(&notes).map_err(|e| e.to_string())?;
        write_atomic(file, &json)?;
        Ok(json)
    })
}

/// Rewrites a JSON file under its lock (used when re-filing meetings under another project).
pub fn update(file: &Path, change: impl FnOnce(&mut Value)) -> Result<(), String> {
    try_update(file, |v| {
        change(v);
        Ok(())
    })
}

/// Like `update`, but `change` may refuse; then nothing is written.
pub fn try_update<T>(file: &Path, change: impl FnOnce(&mut Value) -> Result<T, String>) -> Result<T, String> {
    with_lock(file, || {
        let mut v = read(file)?;
        let out = change(&mut v)?;
        write_atomic(file, &serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?)?;
        Ok(out)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::SystemTime;

    fn temp_notes(v: &Value) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aftercall-notes-{}-{:?}", std::process::id(), std::thread::current().id()));
        let _ = std::fs::remove_dir_all(&dir);
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
        assert!(at_rest::is_sealed(&std::fs::read(&file).unwrap()), "saved encrypted");
        let saved = read(&file).unwrap();
        assert_eq!(saved["meeting"]["title"], "Renamed");
        assert_eq!(saved["meeting"]["actionItems"][0]["claimed"], claim);
        assert_eq!(saved["meeting"]["actionItems"][1]["done"], true);
        assert!(!lock_path(&file).exists());
    }

    #[test]
    fn follow_ups_are_saved_as_the_app_sent_them_and_ticks_keep_them() {
        let file = temp_notes(&notes(json!([{ "id": "a1", "done": false }])));
        let mut app = notes(json!([{ "id": "a1", "done": false }]));
        // Held at launch: the queued time is gone and the flag says why it waits.
        app["meeting"]["followUps"] = json!([{ "id": "f1", "status": "proposed", "autopilotHeld": true }]);
        save(&file, &app.to_string()).unwrap();
        set_item_done(&file, "a1", true).unwrap();
        let saved = read(&file).unwrap();
        assert_eq!(saved["meeting"]["followUps"][0]["autopilotHeld"], true);
        assert!(saved["meeting"]["followUps"][0].get("autopilotAt").is_none());
    }

    fn signed(items: Value, signed_items: Value) -> Value {
        let mut v = notes(items);
        v["notes"] = json!({ "action_items": signed_items });
        v
    }

    fn draft(text: &str, owner: &str, due: Option<&str>) -> Option<ItemDraft> {
        Some(ItemDraft { text: text.into(), owner: owner.into(), due: due.map(str::to_string) })
    }

    #[test]
    fn edit_changes_the_meeting_item_never_the_signed_notes_and_restore_puts_it_back() {
        let signed_items = json!([
            { "text": "Send Ada the recap", "owner": "You", "due": "today", "evidence": "send Ada the recap" },
            { "text": "Dropped for its quote", "owner": null, "due": null, "evidence": "nope" },
            { "text": "Look at pricing", "owner": null, "due": null, "evidence": "look at pricing" }
        ]);
        let file = temp_notes(&signed(
            json!([
                { "id": "a1", "text": "Send Ada the recap", "owner": "You", "due": "today", "done": false },
                { "id": "a3", "text": "Look at pricing", "owner": "Unassigned", "done": true, "claimed": { "agent": "Codex" } }
            ]),
            signed_items.clone(),
        ));
        let v: Value = serde_json::from_str(&edit_item(&file, "a1", draft("  Send Ada the recap and deck ", "You", Some(" ")), "2026-10-26T12:00:00.000Z").unwrap()).unwrap();
        let a1 = &v["meeting"]["actionItems"][0];
        assert_eq!(a1["text"], "Send Ada the recap and deck");
        assert!(a1.get("due").is_none());
        assert_eq!(a1["edited"], json!({ "at": "2026-10-26T12:00:00.000Z", "fields": ["text", "due"] }));
        assert_eq!(v["notes"]["action_items"], signed_items, "the signed notes never change");
        assert_eq!(v["proof"]["notesHash"], "x");
        assert!(at_rest::is_sealed(&std::fs::read(&file).unwrap()));

        // a3 is index 2 in the signed notes (a2 was dropped). Owner and date; tick and claim untouched.
        let v: Value = serde_json::from_str(&edit_item(&file, "a3", draft("Look at pricing", "", Some("Friday")), "t2").unwrap()).unwrap();
        let a3 = &v["meeting"]["actionItems"][1];
        assert_eq!((a3["owner"].as_str(), a3["due"].as_str(), a3["done"].as_bool()), (Some("Unassigned"), Some("Friday"), Some(true)));
        assert_eq!(a3["edited"]["fields"], json!(["due"]));
        assert_eq!(a3["claimed"]["agent"], "Codex");

        // Editing back to the signed words clears the mark; Restore original does the same.
        let v: Value = serde_json::from_str(&edit_item(&file, "a3", draft("Look at pricing", "Unassigned", None), "t3").unwrap()).unwrap();
        assert!(v["meeting"]["actionItems"][1].get("edited").is_none());
        let v: Value = serde_json::from_str(&edit_item(&file, "a1", None, "t4").unwrap()).unwrap();
        assert_eq!(v["meeting"]["actionItems"][0], json!({ "id": "a1", "text": "Send Ada the recap", "owner": "You", "due": "today", "done": false }));

        assert_eq!(edit_item(&file, "a1", draft("  ", "You", None), "t").unwrap_err(), "Write what needs doing");
        assert!(edit_item(&file, "a1", draft(&"x".repeat(301), "You", None), "t").unwrap_err().contains("300"));
        assert!(edit_item(&file, "a1", draft("ok", &"o".repeat(81), None), "t").unwrap_err().contains("owner"));
        assert!(edit_item(&file, "a2", draft("ok", "You", None), "t").unwrap_err().contains("No such action item"));
        assert!(edit_item(&file, "a9", draft("ok", "You", None), "t").unwrap_err().contains("no signed original"));
        assert!(edit_item(&file, "a01", draft("ok", "You", None), "t").unwrap_err().contains("no signed original"));
        assert!(!lock_path(&file).exists());
    }

    #[test]
    fn saving_unchanged_is_no_edit_when_the_model_gave_an_empty_owner_or_spaces() {
        let signed_items = json!([{ "text": " Send plan  ", "owner": "", "due": " Friday ", "evidence": "e" }]);
        let file = temp_notes(&signed(json!([{ "id": "a1", "text": " Send plan  ", "owner": "Unassigned", "due": " Friday ", "done": false }]), signed_items));
        let v: Value = serde_json::from_str(&edit_item(&file, "a1", draft(" Send plan  ", "", Some(" Friday ")), "t").unwrap()).unwrap();
        let item = &v["meeting"]["actionItems"][0];
        assert!(item.get("edited").is_none());
        assert_eq!((item["text"].as_str(), item["owner"].as_str(), item["due"].as_str()), (Some("Send plan"), Some("Unassigned"), Some("Friday")));
    }

    #[test]
    fn whole_file_saves_keep_edits_of_the_same_signed_notes_only() {
        let signed_items = json!([{ "text": "Send plan", "owner": "You", "due": null, "evidence": "e" }]);
        let file = temp_notes(&signed(json!([{ "id": "a1", "text": "Send plan", "owner": "You", "done": false }]), signed_items.clone()));
        edit_item(&file, "a1", draft("Send the pilot plan", "Ada", Some("Friday")), "t").unwrap();
        // The app's copy is older: the item as signed. Its save must not undo the edit.
        let stale = signed(json!([{ "id": "a1", "text": "Send plan", "owner": "You", "done": false }]), signed_items.clone());
        save(&file, &stale.to_string()).unwrap();
        let item = &read(&file).unwrap()["meeting"]["actionItems"][0];
        assert_eq!((item["text"].as_str(), item["owner"].as_str(), item["due"].as_str()), (Some("Send the pilot plan"), Some("Ada"), Some("Friday")));
        assert_eq!(item["edited"]["fields"], json!(["text", "owner", "due"]));

        // New notes for the meeting (another signed hash) start from what the model signed.
        let mut fresh = signed(json!([{ "id": "a1", "text": "Send the new plan", "owner": "You", "done": false }]), json!([{ "text": "Send the new plan", "owner": "You", "due": null, "evidence": "e" }]));
        fresh["proof"]["notesHash"] = "y".into();
        save(&file, &fresh.to_string()).unwrap();
        let item = &read(&file).unwrap()["meeting"]["actionItems"][0];
        assert_eq!(item["text"], "Send the new plan");
        assert!(item.get("edited").is_none() && item.get("due").is_none());
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

    #[test]
    fn notes_save_and_load_encrypted_and_plaintext_is_migrated_on_save() {
        let file = temp_notes(&notes(json!([{ "id": "a1", "text": "Send the board deck", "done": false }])));
        // Written by an earlier version: plaintext, still readable.
        assert!(!at_rest::is_sealed(&std::fs::read(&file).unwrap()));
        assert_eq!(read(&file).unwrap()["meeting"]["actionItems"][0]["text"], "Send the board deck");
        let json = set_item_done(&file, "a1", true).unwrap();
        let raw = std::fs::read(&file).unwrap();
        assert!(at_rest::is_sealed(&raw));
        assert!(!raw.windows(10).any(|w| w == b"board deck"));
        assert_eq!(read(&file).unwrap(), serde_json::from_str::<Value>(&json).unwrap());
        let leftovers: Vec<_> = std::fs::read_dir(file.parent().unwrap()).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(leftovers, ["notes.json"]);
    }
}
