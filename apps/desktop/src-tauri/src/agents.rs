//! Connected agents: the local channel the MCP server (apps/mcp) uses to reach meetings.
//!
//! Meetings are encrypted at rest, so the MCP server can't read files. Instead, while
//! the user has "Connected agents" turned on, the app listens on a Unix domain socket,
//! `<data dir>/agents/aftercall.sock` (folder 0700, socket 0600), and answers one JSON
//! request per line:
//!
//! ```text
//! → {"token":"…","op":"meetings"|"projects"|"notes"|"access"|"claim"|"complete", ...args}
//! ← {"ok":true,"result":…}  or  {"ok":false,"error":"…"}
//! ```
//!
//! Every request must carry the token shown on the Connected agents screen. The token
//! is made when the user turns agents on and dropped when they turn them off, so
//! turning them back on needs the new setup command. With agents off there is no socket.
//!
//! What a request can do is fixed here: read processed meetings and projects, and,
//! only while the user has turned on "Let agents claim and complete action items",
//! claim or complete one action item. That switch is off by default and goes back off
//! when agents are turned off. Nothing else in notes.json can be changed. Your notes
//! (what you typed during the call) and their salt are never sent.
//!
//! Each request is added to a short activity list, `agents-activity.json` (sealed like
//! every other file): when, which agent by its own name, which request, the meeting and
//! item ids, and whether it was allowed. Never meeting content. The newest 200 are kept.
//!
//! Limits: the token sits in the agent's own config (e.g. ~/.claude.json), which other
//! software running as the user could read. This keeps meetings away from apps that
//! only read files; it is not a wall against malware running as the user.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{at_rest, notes_file};

const MAX_REQUEST: u64 = 64 * 1024;
const NOTE_MAX: usize = 500;

/// What an agent is told when it tries to claim or complete while agents may only read.
pub const WRITES_OFF: &str =
    "Aftercall lets agents read only. To let them claim and complete action items, turn that on in Settings → Connected agents.";

pub fn socket_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("agents")
}

pub fn socket_path(data_dir: &Path) -> PathBuf {
    socket_dir(data_dir).join("aftercall.sock")
}

// ---------- settings ----------

/// Saved (encrypted) as `agents.json`: whether agents are on, the current token, and
/// whether they may claim and complete action items.
#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Settings {
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    /// None in an agents.json from before this switch existed, when agents could always
    /// claim and complete. It reads as off, and the screen says so until the user chooses.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_writes: Option<bool>,
}

impl Settings {
    pub fn writes_allowed(&self) -> bool {
        self.allow_writes == Some(true)
    }
}

fn settings_path(data_dir: &Path) -> PathBuf {
    data_dir.join("agents.json")
}

pub fn load_settings(data_dir: &Path) -> Settings {
    at_rest::read_json(&settings_path(data_dir)).and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

pub fn save_settings(data_dir: &Path, s: &Settings) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    at_rest::write_json(&settings_path(data_dir), &serde_json::to_value(s).map_err(|e| e.to_string())?)
}

/// 32 random bytes as hex.
pub fn new_token() -> Result<String, String> {
    let mut b = [0u8; 32];
    getrandom::getrandom(&mut b).map_err(|e| e.to_string())?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

fn same_token(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

// ---------- the server ----------

pub struct Server {
    stop: Arc<AtomicBool>,
    /// "Let agents claim and complete action items", read on every request.
    writes: Arc<AtomicBool>,
    path: PathBuf,
    thread: Option<JoinHandle<()>>,
}

impl Server {
    /// Opens the socket and answers requests on a background thread until stopped.
    pub fn start(data_dir: &Path, token: String, allow_writes: bool) -> Result<Self, String> {
        let dir = socket_dir(data_dir);
        std::fs::DirBuilder::new().recursive(true).mode(0o700).create(&dir).map_err(|e| e.to_string())?;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
        let path = socket_path(data_dir);
        let _ = std::fs::remove_file(&path); // left over from a crash or a quit
        let listener = UnixListener::bind(&path).map_err(|e| format!("Couldn't open the agents socket: {e}"))?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;

        let stop = Arc::new(AtomicBool::new(false));
        let writes = Arc::new(AtomicBool::new(allow_writes));
        let (flag, root, can_write) = (stop.clone(), data_dir.to_path_buf(), writes.clone());
        let thread = std::thread::Builder::new()
            .name("agents".into())
            .spawn(move || {
                while !flag.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            let (root, token, can_write) = (root.clone(), token.clone(), can_write.clone());
                            let _ = std::thread::Builder::new().name("agents-conn".into()).spawn(move || serve(stream, &root, &token, &can_write));
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(50)),
                        Err(_) => std::thread::sleep(Duration::from_millis(200)),
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self { stop, writes, path, thread: Some(thread) })
    }

    /// Applies the user's switch to the next request, without a new token or socket.
    pub fn set_allow_writes(&self, on: bool) {
        self.writes.store(on, Ordering::Relaxed);
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Answers each request line on one connection.
fn serve(stream: UnixStream, data_dir: &Path, token: &str, writes: &AtomicBool) {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
    let Ok(mut out) = stream.try_clone() else { return };
    let mut reader = BufReader::new(std::io::Read::take(stream, MAX_REQUEST));
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        let reply = match answer(data_dir, token, writes.load(Ordering::Relaxed), &line, &now_iso) {
            Ok(result) => json!({ "ok": true, "result": result }),
            Err(error) => json!({ "ok": false, "error": error }),
        };
        if writeln!(out, "{reply}").is_err() {
            return;
        }
        // Each connection gets the request budget once; agents open one per call.
        if reader.get_ref().limit() == 0 {
            return;
        }
    }
}

/// Checks the token, runs the request and adds it to the activity list.
fn answer(data_dir: &Path, token: &str, writes: bool, line: &str, now: &dyn Fn() -> String) -> Result<Value, String> {
    let req: Value = serde_json::from_str(line).map_err(|_| "Bad request".to_string())?;
    let result = if req["token"].as_str().is_some_and(|t| same_token(t, token)) {
        dispatch(data_dir, &req, writes, now)
    } else {
        Err(TOKEN_REFUSED.into())
    };
    if let Some(entry) = Activity::of(&req, &result, now) {
        // The list is a record for the user; a failed write never fails the request.
        if let Err(e) = record(data_dir, entry) {
            eprintln!("agents: couldn't add to the activity list: {e}");
        }
    }
    result
}

const TOKEN_REFUSED: &str = "Aftercall refused the token. Copy the current setup from Settings → Connected agents in Aftercall.";

// ---------- what agents can do ----------

/// Runs one request. `writes` is the user's "Let agents claim and complete action items"
/// switch; `now` gives the time stamped on claims and completions.
pub fn dispatch(data_dir: &Path, req: &Value, writes: bool, now: &dyn Fn() -> String) -> Result<Value, String> {
    let str_arg = |k: &str| req[k].as_str().unwrap_or_default().to_string();
    let op = req["op"].as_str().unwrap_or_default();
    if matches!(op, "claim" | "complete") && !writes {
        return Err(WRITES_OFF.into());
    }
    match op {
        "projects" => Ok(projects(data_dir)),
        "meetings" => Ok(Value::Array(meetings(data_dir))),
        "notes" => notes(data_dir, &str_arg("id")),
        "access" => Ok(json!({ "allowWrites": writes })),
        "claim" => claim(data_dir, &str_arg("meetingId"), &str_arg("itemId"), &str_arg("agent"), now),
        "complete" => complete(data_dir, &str_arg("meetingId"), &str_arg("itemId"), &str_arg("agent"), req["note"].as_str(), now),
        _ => Err("Unknown request".into()),
    }
}

fn projects(data_dir: &Path) -> Value {
    match at_rest::read_json(&data_dir.join("projects.json")) {
        Some(v @ Value::Array(_)) => v,
        _ => json!([{ "id": "general", "name": "General" }]),
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 20 && id.chars().all(|c| c.is_ascii_digit())
}

fn notes_path(data_dir: &Path, id: &str) -> Result<PathBuf, String> {
    let missing = || format!("No processed meeting with id \"{id}\". Use list_meetings to see ids.");
    if !valid_id(id) {
        return Err(missing());
    }
    let file = data_dir.join("recordings").join(id).join("notes.json");
    if file.exists() { Ok(file) } else { Err(missing()) }
}

/// Every processed meeting as `{ id, notes }`, newest first.
fn meetings(data_dir: &Path) -> Vec<Value> {
    let Ok(entries) = std::fs::read_dir(data_dir.join("recordings")) else { return vec![] };
    let mut out: Vec<(u64, Value)> = entries
        .flatten()
        .filter_map(|e| {
            let id = e.file_name().into_string().ok().filter(|id| valid_id(id))?;
            let notes = at_rest::read_json(&e.path().join("notes.json")).filter(|n| n["meeting"].is_object())?;
            Some((id.parse().ok()?, json!({ "id": id, "notes": for_agents(notes) })))
        })
        .collect();
    out.sort_by_key(|(id, _)| std::cmp::Reverse(*id));
    out.into_iter().map(|(_, v)| v).collect()
}

fn notes(data_dir: &Path, id: &str) -> Result<Value, String> {
    let file = notes_path(data_dir, id)?;
    notes_file::read(&file)
        .map(for_agents)
        .map_err(|_| format!("No processed meeting with id \"{id}\". Use list_meetings to see ids."))
}

/// notes.json without your notes and the salt behind their hash: those stay in the app.
/// The proof's notice (your statement that you told everyone) stays out too: agents
/// don't need it.
fn for_agents(mut notes: Value) -> Value {
    if let Some(m) = notes.get_mut("meeting").and_then(Value::as_object_mut) {
        m.remove("yourNotes");
    }
    if let Some(p) = notes.get_mut("proof").and_then(Value::as_object_mut) {
        p.remove("notice");
    }
    if let Some(n) = notes.as_object_mut() {
        n.remove("yourNotesSalt");
        // What the run cost is about your NEAR AI account, not the meeting.
        n.remove("cost");
    }
    notes
}

fn check_agent(agent: &str) -> Result<String, String> {
    let name = agent.trim();
    if name.is_empty() || name.chars().count() > 60 {
        return Err("Give your agent name, 1 to 60 characters (e.g. \"Claude Code\")".into());
    }
    Ok(name.to_string())
}

/// Finds an action item, refusing ones that are done or claimed by another agent.
fn open_item<'a>(notes: &'a mut Value, item_id: &str, agent: &str, claimed_by_other: impl Fn(&str, &str) -> String) -> Result<&'a mut serde_json::Map<String, Value>, String> {
    let item = notes["meeting"]["actionItems"]
        .as_array_mut()
        .and_then(|items| items.iter_mut().find(|i| i["id"] == item_id))
        .and_then(Value::as_object_mut)
        .ok_or_else(|| format!("No action item \"{item_id}\" in this meeting. Use get_meeting to see item ids."))?;
    if item.get("done").and_then(Value::as_bool) == Some(true) {
        return Err("This action item is already done".into());
    }
    if let Some(by) = item.get("claimed").and_then(|c| c["agent"].as_str())
        && by != agent
    {
        let at = item["claimed"]["at"].as_str().unwrap_or_default();
        return Err(claimed_by_other(by, at));
    }
    Ok(item)
}

fn claim(data_dir: &Path, meeting_id: &str, item_id: &str, agent: &str, now: &dyn Fn() -> String) -> Result<Value, String> {
    let agent = check_agent(agent)?;
    let file = notes_path(data_dir, meeting_id)?;
    notes_file::try_update(&file, |notes| {
        let item = open_item(notes, item_id, &agent, |by, at| format!("Already claimed by {by} at {at}"))?;
        if !item.contains_key("claimed") {
            item.insert("claimed".into(), json!({ "agent": agent, "at": now() }));
        }
        Ok(json!({ "claimed": true, "item": item }))
    })
}

fn complete(data_dir: &Path, meeting_id: &str, item_id: &str, agent: &str, note: Option<&str>, now: &dyn Fn() -> String) -> Result<Value, String> {
    let agent = check_agent(agent)?;
    let note: Option<String> = note.map(|n| n.trim().chars().take(NOTE_MAX).collect()).filter(|n: &String| !n.is_empty());
    let file = notes_path(data_dir, meeting_id)?;
    notes_file::try_update(&file, |notes| {
        let item = open_item(notes, item_id, &agent, |by, _| format!("Claimed by {by}; only that agent can complete it"))?;
        let at = now();
        if !item.contains_key("claimed") {
            item.insert("claimed".into(), json!({ "agent": agent, "at": at }));
        }
        item.insert("done".into(), true.into());
        let mut completed = json!({ "agent": agent, "at": at });
        if let Some(n) = note {
            completed["note"] = n.into();
        }
        item.insert("completed".into(), completed);
        Ok(json!({ "completed": true, "item": item }))
    })
}

// ---------- the activity list ----------

const ACTIVITY_MAX: usize = 200;
const NAME_MAX: usize = 60;

/// One agent request as the user sees it on the Connected agents screen. Ids and names
/// only: the meeting's title, the item's text and any note stay in notes.json.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub at: String,
    /// What the agent calls itself: the name it gave a claim or completion, else its
    /// MCP client name (e.g. "claude-code"). Neither is checked.
    pub agent: String,
    /// "meetings", "notes", "claim", "complete" or "other".
    pub op: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meeting_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    pub allowed: bool,
    /// Why it was refused: "token", "read-only", or "rules" (unknown id, done, claimed by another agent).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refused: Option<String>,
}

impl Activity {
    /// The entry for one request, or None for the lookups that come with other requests
    /// (project names, the write switch), which would only crowd the list.
    fn of(req: &Value, result: &Result<Value, String>, now: &dyn Fn() -> String) -> Option<Self> {
        let op = match req["op"].as_str().unwrap_or_default() {
            "projects" | "access" => return None,
            op @ ("meetings" | "notes" | "claim" | "complete") => op,
            _ => "other",
        };
        let short = |v: &Value| v.as_str().map(|s| s.trim().chars().filter(|c| !c.is_control()).take(NAME_MAX).collect::<String>()).filter(|s| !s.is_empty());
        let meeting_id = req["meetingId"].as_str().or(req["id"].as_str()).filter(|id| valid_id(id)).map(str::to_string);
        let item_id = req["itemId"].as_str().filter(|id| !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        let refused = result.as_ref().err().map(|e| match e.as_str() {
            TOKEN_REFUSED => "token",
            WRITES_OFF => "read-only",
            _ => "rules",
        });
        Some(Self {
            at: now(),
            agent: short(&req["agent"]).or_else(|| short(&req["client"])).unwrap_or_else(|| "Unnamed agent".into()),
            op: op.into(),
            meeting_id,
            item_id: item_id.map(str::to_string),
            allowed: result.is_ok(),
            refused: refused.map(str::to_string),
        })
    }
}

fn activity_path(data_dir: &Path) -> PathBuf {
    data_dir.join("agents-activity.json")
}

/// Connections are served on their own threads; one append at a time.
static ACTIVITY_LOCK: Mutex<()> = Mutex::new(());

fn record(data_dir: &Path, entry: Activity) -> Result<(), String> {
    let _held = ACTIVITY_LOCK.lock().map_err(|e| e.to_string())?;
    let path = activity_path(data_dir);
    let mut list: Vec<Activity> = at_rest::read_json(&path).and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
    list.push(entry);
    let drop = list.len().saturating_sub(ACTIVITY_MAX);
    list.drain(..drop);
    at_rest::write_json(&path, &serde_json::to_value(&list).map_err(|e| e.to_string())?)
}

/// The newest `limit` entries, newest first.
pub fn read_activity(data_dir: &Path, limit: usize) -> Vec<Activity> {
    let list: Vec<Activity> = at_rest::read_json(&activity_path(data_dir)).and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
    list.into_iter().rev().take(limit).collect()
}

/// Now as JavaScript's `toISOString()` writes it: `2026-10-26T12:00:00.000Z`.
fn now_iso() -> String {
    let d = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    let secs = d.as_secs();
    let (y, m, day) = crate::recovery::civil_date(secs);
    let t = secs % 86_400;
    format!("{y:04}-{m:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z", t / 3600, t / 60 % 60, t % 60, d.subsec_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data_dir(name: &str) -> PathBuf {
        // Short: a Unix socket path must fit in 104 bytes.
        let dir = PathBuf::from("/tmp").join(format!("ac-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let rec = dir.join("recordings/1761000000");
        std::fs::create_dir_all(&rec).unwrap();
        at_rest::write_json(&dir.join("projects.json"), &json!([{ "id": "general", "name": "General" }])).unwrap();
        let notes = json!({ "meeting": { "title": "Sync with Ada", "project": "General", "actionItems": [
            { "id": "a1", "text": "Send Ada the pilot plan", "owner": "You", "done": false },
            { "id": "a2", "text": "Share the term sheet", "owner": "Ada", "done": false },
            { "id": "a3", "text": "Book the call", "owner": "You", "done": true }
        ], "followUps": [{ "id": "f2", "amount": { "$bigint": "12500000" } }], "yourNotes": "Push for the pilot" },
            "proof": { "notesHash": "abc", "notice": { "by": "you", "at": "2026-10-26T11:58:00.000Z", "how": "chat" } }, "yourNotesSalt": "5a5a",
            "cost": { "usd": 0.0042, "whisperSeconds": 384, "whisperUsd": 0.00000384, "pricesAsOf": "2026-11-01" } });
        at_rest::write_json(&rec.join("notes.json"), &notes).unwrap();
        // Recorded, not processed: no notes.
        std::fs::create_dir_all(dir.join("recordings/1761200000")).unwrap();
        dir
    }

    /// Most tests are about the claim rules, so writes are allowed; the read-only default has its own tests.
    fn dispatch_rw(dir: &Path, req: &Value, now: &dyn Fn() -> String) -> Result<Value, String> {
        dispatch(dir, req, true, now)
    }

    fn at(t: &'static str) -> impl Fn() -> String {
        move || t.to_string()
    }

    fn read_notes(dir: &Path) -> Value {
        notes_file::read(&dir.join("recordings/1761000000/notes.json")).unwrap()
    }

    #[test]
    fn reads_processed_meetings_and_projects() {
        let dir = data_dir("read");
        let now = at("x");
        let list = dispatch_rw(&dir, &json!({ "op": "meetings" }), &now).unwrap();
        assert_eq!(list.as_array().unwrap().len(), 1);
        assert_eq!(list[0]["id"], "1761000000");
        assert_eq!(list[0]["notes"]["meeting"]["title"], "Sync with Ada");
        assert_eq!(dispatch_rw(&dir, &json!({ "op": "projects" }), &now).unwrap()[0]["name"], "General");
        assert!(dispatch_rw(&dir, &json!({ "op": "notes", "id": "1761200000" }), &now).unwrap_err().contains("No processed meeting"));
        assert!(dispatch_rw(&dir, &json!({ "op": "notes", "id": "../../etc" }), &now).unwrap_err().contains("No processed meeting"));
        assert!(dispatch_rw(&dir, &json!({ "op": "delete" }), &now).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn your_notes_and_their_salt_never_reach_agents() {
        let dir = data_dir("yours");
        let now = at("2026-10-26T12:00:00.000Z");
        let list = dispatch_rw(&dir, &json!({ "op": "meetings" }), &now).unwrap();
        let one = dispatch_rw(&dir, &json!({ "op": "notes", "id": "1761000000" }), &now).unwrap();
        let done = dispatch_rw(&dir, &json!({ "op": "complete", "meetingId": "1761000000", "itemId": "a1", "agent": "Codex" }), &now).unwrap();
        for v in [&list, &one, &done] {
            let text = v.to_string();
            assert!(!text.contains("Push for the pilot") && !text.contains("yourNotes") && !text.contains("5a5a"), "{text}");
            assert!(!text.contains("\"notice\""), "the proof's notice stays in the app: {text}");
            assert!(!text.contains("pricesAsOf"), "the estimated cost stays in the app: {text}");
        }
        // Still on disk, untouched by the agent's write.
        let saved = read_notes(&dir);
        assert_eq!(saved["meeting"]["yourNotes"], "Push for the pilot");
        assert_eq!(saved["yourNotesSalt"], "5a5a");
        assert_eq!(saved["proof"]["notice"]["how"], "chat");
        assert_eq!(saved["cost"]["pricesAsOf"], "2026-11-01");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn claim_then_complete_with_the_same_rules_as_before() {
        let dir = data_dir("claim");
        let claim_req = |agent: &str| json!({ "op": "claim", "meetingId": "1761000000", "itemId": "a1", "agent": agent });
        dispatch_rw(&dir, &claim_req("Claude Code"), &at("2026-10-26T12:00:00.000Z")).unwrap();
        assert_eq!(read_notes(&dir)["meeting"]["actionItems"][0]["claimed"], json!({ "agent": "Claude Code", "at": "2026-10-26T12:00:00.000Z" }));
        // Same agent again: harmless, keeps the first time. Another agent: refused.
        dispatch_rw(&dir, &claim_req("Claude Code"), &at("later")).unwrap();
        assert_eq!(read_notes(&dir)["meeting"]["actionItems"][0]["claimed"]["at"], "2026-10-26T12:00:00.000Z");
        assert!(dispatch_rw(&dir, &claim_req("Codex"), &at("x")).unwrap_err().contains("Already claimed by Claude Code"));
        let complete = |agent: &str| json!({ "op": "complete", "meetingId": "1761000000", "itemId": "a1", "agent": agent, "note": "  Sent the plan as a doc " });
        assert!(dispatch_rw(&dir, &complete("Codex"), &at("x")).unwrap_err().contains("Claimed by Claude Code"));
        dispatch_rw(&dir, &complete("Claude Code"), &at("2026-10-26T12:05:00.000Z")).unwrap();
        let item = &read_notes(&dir)["meeting"]["actionItems"][0];
        assert_eq!(item["done"], true);
        assert_eq!(item["completed"], json!({ "agent": "Claude Code", "at": "2026-10-26T12:05:00.000Z", "note": "Sent the plan as a doc" }));
        assert!(dispatch_rw(&dir, &claim_req("Claude Code"), &at("x")).unwrap_err().contains("already done"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn writes_change_only_the_one_item_and_stay_encrypted() {
        let dir = data_dir("only");
        let before = read_notes(&dir);
        dispatch_rw(&dir, &json!({ "op": "complete", "meetingId": "1761000000", "itemId": "a2", "agent": "Codex" }), &at("t")).unwrap();
        let mut after = read_notes(&dir);
        after["meeting"]["actionItems"][1] = before["meeting"]["actionItems"][1].clone();
        assert_eq!(after, before);
        assert!(at_rest::is_sealed(&std::fs::read(dir.join("recordings/1761000000/notes.json")).unwrap()));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn bad_input_is_refused() {
        let dir = data_dir("bad");
        let now = at("t");
        let r = |v: Value| dispatch_rw(&dir, &v, &now).unwrap_err();
        assert!(r(json!({ "op": "claim", "meetingId": "1761000000", "itemId": "zz", "agent": "Codex" })).contains("No action item \"zz\""));
        assert!(r(json!({ "op": "claim", "meetingId": "1761000000", "itemId": "a1", "agent": "  " })).contains("agent name"));
        assert!(r(json!({ "op": "claim", "meetingId": "1761200000", "itemId": "a1", "agent": "Codex" })).contains("No processed meeting"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn concurrent_claims_of_one_item_have_one_winner() {
        let dir = data_dir("race");
        let wins: usize = std::thread::scope(|s| {
            let handles: Vec<_> = ["A", "B", "C", "D", "E", "F"]
                .iter()
                .map(|agent| {
                    let dir = &dir;
                    s.spawn(move || dispatch_rw(dir, &json!({ "op": "claim", "meetingId": "1761000000", "itemId": "a1", "agent": agent }), &at("t")).is_ok())
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap() as usize).sum()
        });
        assert_eq!(wins, 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn call(path: &Path, line: &str) -> Value {
        let mut s = UnixStream::connect(path).unwrap();
        writeln!(s, "{line}").unwrap();
        let mut reply = String::new();
        BufReader::new(s).read_line(&mut reply).unwrap();
        serde_json::from_str(&reply).unwrap()
    }

    #[test]
    fn the_socket_is_owner_only_needs_the_token_and_goes_away_when_stopped() {
        let dir = data_dir("sock");
        let token = new_token().unwrap();
        let server = Server::start(&dir, token.clone(), false).unwrap();
        let path = socket_path(&dir);
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(std::fs::metadata(socket_dir(&dir)).unwrap().permissions().mode() & 0o777, 0o700);

        let refused = call(&path, &json!({ "token": "nope", "op": "meetings" }).to_string());
        assert_eq!(refused["ok"], false);
        assert!(refused["error"].as_str().unwrap().contains("refused the token"));
        assert_eq!(call(&path, "{}")["ok"], false);
        let ok = call(&path, &json!({ "token": token, "op": "meetings" }).to_string());
        assert_eq!(ok["ok"], true);
        assert_eq!(ok["result"][0]["notes"]["meeting"]["title"], "Sync with Ada");

        // Read-only until the user flips the switch, which applies to the next request.
        let claim = json!({ "token": token, "op": "claim", "meetingId": "1761000000", "itemId": "a1", "agent": "Codex" }).to_string();
        assert_eq!(call(&path, &claim)["error"], WRITES_OFF);
        server.set_allow_writes(true);
        assert_eq!(call(&path, &claim)["ok"], true);
        server.set_allow_writes(false);
        assert_eq!(call(&path, &claim)["error"], WRITES_OFF);
        // Every request above is in the activity list, newest first; bad JSON isn't.
        let ops: Vec<(String, bool)> = read_activity(&dir, 20).into_iter().map(|a| (a.op, a.allowed)).collect();
        let expected = [("claim", false), ("claim", true), ("claim", false), ("meetings", true), ("other", false), ("meetings", false)];
        assert_eq!(ops, expected.map(|(o, ok)| (o.to_string(), ok)));

        drop(server);
        assert!(!path.exists());
        assert!(UnixStream::connect(&path).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn settings_are_saved_encrypted() {
        let dir = data_dir("settings");
        assert!(!load_settings(&dir).enabled);
        save_settings(&dir, &Settings { enabled: true, token: Some("t0k".into()), allow_writes: Some(true) }).unwrap();
        assert!(at_rest::is_sealed(&std::fs::read(dir.join("agents.json")).unwrap()));
        let s = load_settings(&dir);
        assert!(s.enabled && s.token.as_deref() == Some("t0k") && s.writes_allowed());
        assert!(same_token("abc", "abc") && !same_token("abc", "abd") && !same_token("abc", "ab"));
        assert_eq!(now_iso().len(), "2026-10-26T12:00:00.000Z".len());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn agents_read_only_by_default_and_are_told_which_switch_to_turn_on() {
        let dir = data_dir("ro");
        let now = at("t");
        let before = read_notes(&dir);
        assert!(dispatch(&dir, &json!({ "op": "meetings" }), false, &now).is_ok());
        assert!(dispatch(&dir, &json!({ "op": "notes", "id": "1761000000" }), false, &now).is_ok());
        assert_eq!(dispatch(&dir, &json!({ "op": "access" }), false, &now).unwrap(), json!({ "allowWrites": false }));
        assert_eq!(dispatch(&dir, &json!({ "op": "access" }), true, &now).unwrap(), json!({ "allowWrites": true }));
        for op in ["claim", "complete"] {
            let err = dispatch(&dir, &json!({ "op": op, "meetingId": "1761000000", "itemId": "a1", "agent": "Codex" }), false, &now).unwrap_err();
            assert_eq!(err, WRITES_OFF);
            assert!(err.contains("Settings → Connected agents"));
        }
        assert_eq!(read_notes(&dir), before, "nothing changed");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn settings_from_before_the_switch_read_as_read_only() {
        let dir = data_dir("old");
        // agents.json as an earlier version wrote it: agents on, no write switch.
        at_rest::write_json(&dir.join("agents.json"), &json!({ "enabled": true, "token": "t0k" })).unwrap();
        let s = load_settings(&dir);
        assert!(s.enabled && s.allow_writes.is_none() && !s.writes_allowed());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_activity_list_holds_ids_and_names_never_meeting_content() {
        let dir = data_dir("log");
        let token = "t0k";
        let send = |v: Value, writes: bool| {
            let _ = answer(&dir, token, writes, &v.to_string(), &at("2026-10-26T12:00:00.000Z"));
        };
        send(json!({ "token": token, "op": "meetings", "client": "claude-code" }), false);
        send(json!({ "token": token, "op": "projects", "client": "claude-code" }), false);
        send(json!({ "token": token, "op": "access", "client": "claude-code" }), false);
        send(json!({ "token": token, "op": "claim", "meetingId": "1761000000", "itemId": "a1", "agent": "Claude Code", "client": "claude-code" }), false);
        send(json!({ "token": token, "op": "claim", "meetingId": "1761000000", "itemId": "a1", "agent": "Claude Code" }), true);
        send(json!({ "token": token, "op": "complete", "meetingId": "1761000000", "itemId": "a1", "agent": "Claude Code", "note": "Sent the pilot plan" }), true);
        send(json!({ "token": token, "op": "claim", "meetingId": "1761000000", "itemId": "a1", "agent": "Codex" }), true);
        send(json!({ "token": "wrong", "op": "notes", "id": "1761000000", "client": "stale" }), true);
        send(json!({ "token": token, "op": "notes", "id": "../../etc", "itemId": "<script>" }), true);

        let list = read_activity(&dir, 20);
        fn row(a: &Activity) -> (&str, &str, bool, Option<&str>) {
            (&a.op, &a.agent, a.allowed, a.refused.as_deref())
        }
        assert_eq!(
            list.iter().map(row).collect::<Vec<_>>(),
            [
                ("notes", "Unnamed agent", false, Some("rules")),
                ("notes", "stale", false, Some("token")),
                ("claim", "Codex", false, Some("rules")),
                ("complete", "Claude Code", true, None),
                ("claim", "Claude Code", true, None),
                ("claim", "Claude Code", false, Some("read-only")),
                ("meetings", "claude-code", true, None),
            ],
            "newest first; project and switch lookups aren't listed"
        );
        assert_eq!(list[3].meeting_id.as_deref(), Some("1761000000"));
        assert_eq!(list[3].item_id.as_deref(), Some("a1"));
        assert_eq!(list[3].at, "2026-10-26T12:00:00.000Z");
        assert_eq!((list[0].meeting_id.as_deref(), list[0].item_id.as_deref()), (None, None), "only well-formed ids are kept");

        let bytes = std::fs::read(dir.join("agents-activity.json")).unwrap();
        assert!(at_rest::is_sealed(&bytes));
        let plain = String::from_utf8(at_rest::read_bytes(&dir.join("agents-activity.json")).unwrap().to_vec()).unwrap();
        for content in ["Sync with Ada", "pilot plan", "Push for the pilot", "Sent the pilot plan", "General"] {
            assert!(!plain.contains(content), "{content} in {plain}");
        }
        assert_eq!(read_activity(&dir, 2).len(), 2);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_activity_list_keeps_the_newest_200() {
        let dir = data_dir("cap");
        for i in 0..205 {
            record(&dir, Activity { at: format!("{i:03}"), agent: "A".into(), op: "meetings".into(), meeting_id: None, item_id: None, allowed: true, refused: None }).unwrap();
        }
        let all = read_activity(&dir, 1000);
        assert_eq!(all.len(), 200);
        assert_eq!((all[0].at.as_str(), all[199].at.as_str()), ("204", "005"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
