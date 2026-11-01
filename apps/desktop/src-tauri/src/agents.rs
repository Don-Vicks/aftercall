//! Connected agents: the local channel the MCP server (apps/mcp) uses to reach meetings.
//!
//! Meetings are encrypted at rest, so the MCP server can't read files. Instead, while
//! the user has "Connected agents" turned on, the app listens on a Unix domain socket,
//! `<data dir>/agents/aftercall.sock` (folder 0700, socket 0600), and answers one JSON
//! request per line:
//!
//! ```text
//! → {"token":"…","op":"meetings"|"projects"|"notes"|"claim"|"complete", ...args}
//! ← {"ok":true,"result":…}  or  {"ok":false,"error":"…"}
//! ```
//!
//! Every request must carry the token shown on the Connected agents screen. The token
//! is made when the user turns agents on and dropped when they turn them off, so
//! turning them back on needs the new setup command. With agents off there is no socket.
//!
//! What a request can do is fixed here: read processed meetings and projects, and
//! claim or complete one action item. Nothing else in notes.json can be changed.
//! Your notes (what you typed during the call) and their salt are never sent.
//!
//! Limits: the token sits in the agent's own config (e.g. ~/.claude.json), which other
//! software running as the user could read. This keeps meetings away from apps that
//! only read files; it is not a wall against malware running as the user.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{at_rest, notes_file};

const MAX_REQUEST: u64 = 64 * 1024;
const NOTE_MAX: usize = 500;

pub fn socket_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("agents")
}

pub fn socket_path(data_dir: &Path) -> PathBuf {
    socket_dir(data_dir).join("aftercall.sock")
}

// ---------- settings ----------

/// Saved (encrypted) as `agents.json`: whether agents are on, and the current token.
#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Settings {
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
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
    path: PathBuf,
    thread: Option<JoinHandle<()>>,
}

impl Server {
    /// Opens the socket and answers requests on a background thread until stopped.
    pub fn start(data_dir: &Path, token: String) -> Result<Self, String> {
        let dir = socket_dir(data_dir);
        std::fs::DirBuilder::new().recursive(true).mode(0o700).create(&dir).map_err(|e| e.to_string())?;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
        let path = socket_path(data_dir);
        let _ = std::fs::remove_file(&path); // left over from a crash or a quit
        let listener = UnixListener::bind(&path).map_err(|e| format!("Couldn't open the agents socket: {e}"))?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;

        let stop = Arc::new(AtomicBool::new(false));
        let (flag, root) = (stop.clone(), data_dir.to_path_buf());
        let thread = std::thread::Builder::new()
            .name("agents".into())
            .spawn(move || {
                while !flag.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            let (root, token) = (root.clone(), token.clone());
                            let _ = std::thread::Builder::new().name("agents-conn".into()).spawn(move || serve(stream, &root, &token));
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(50)),
                        Err(_) => std::thread::sleep(Duration::from_millis(200)),
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self { stop, path, thread: Some(thread) })
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
fn serve(stream: UnixStream, data_dir: &Path, token: &str) {
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
        let reply = match answer(data_dir, token, &line) {
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

fn answer(data_dir: &Path, token: &str, line: &str) -> Result<Value, String> {
    let req: Value = serde_json::from_str(line).map_err(|_| "Bad request".to_string())?;
    if !req["token"].as_str().is_some_and(|t| same_token(t, token)) {
        return Err("Aftercall refused the token. Copy the current setup from Settings → Connected agents in Aftercall.".into());
    }
    dispatch(data_dir, &req, &now_iso)
}

// ---------- what agents can do ----------

/// Runs one request. `now` gives the time stamped on claims and completions.
pub fn dispatch(data_dir: &Path, req: &Value, now: &dyn Fn() -> String) -> Result<Value, String> {
    let str_arg = |k: &str| req[k].as_str().unwrap_or_default().to_string();
    match req["op"].as_str().unwrap_or_default() {
        "projects" => Ok(projects(data_dir)),
        "meetings" => Ok(Value::Array(meetings(data_dir))),
        "notes" => notes(data_dir, &str_arg("id")),
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
fn for_agents(mut notes: Value) -> Value {
    if let Some(m) = notes.get_mut("meeting").and_then(Value::as_object_mut) {
        m.remove("yourNotes");
    }
    if let Some(n) = notes.as_object_mut() {
        n.remove("yourNotesSalt");
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
            "proof": { "notesHash": "abc" }, "yourNotesSalt": "5a5a" });
        at_rest::write_json(&rec.join("notes.json"), &notes).unwrap();
        // Recorded, not processed: no notes.
        std::fs::create_dir_all(dir.join("recordings/1761200000")).unwrap();
        dir
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
        let list = dispatch(&dir, &json!({ "op": "meetings" }), &now).unwrap();
        assert_eq!(list.as_array().unwrap().len(), 1);
        assert_eq!(list[0]["id"], "1761000000");
        assert_eq!(list[0]["notes"]["meeting"]["title"], "Sync with Ada");
        assert_eq!(dispatch(&dir, &json!({ "op": "projects" }), &now).unwrap()[0]["name"], "General");
        assert!(dispatch(&dir, &json!({ "op": "notes", "id": "1761200000" }), &now).unwrap_err().contains("No processed meeting"));
        assert!(dispatch(&dir, &json!({ "op": "notes", "id": "../../etc" }), &now).unwrap_err().contains("No processed meeting"));
        assert!(dispatch(&dir, &json!({ "op": "delete" }), &now).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn your_notes_and_their_salt_never_reach_agents() {
        let dir = data_dir("yours");
        let now = at("2026-10-26T12:00:00.000Z");
        let list = dispatch(&dir, &json!({ "op": "meetings" }), &now).unwrap();
        let one = dispatch(&dir, &json!({ "op": "notes", "id": "1761000000" }), &now).unwrap();
        let done = dispatch(&dir, &json!({ "op": "complete", "meetingId": "1761000000", "itemId": "a1", "agent": "Codex" }), &now).unwrap();
        for v in [&list, &one, &done] {
            let text = v.to_string();
            assert!(!text.contains("Push for the pilot") && !text.contains("yourNotes") && !text.contains("5a5a"), "{text}");
        }
        // Still on disk, untouched by the agent's write.
        let saved = read_notes(&dir);
        assert_eq!(saved["meeting"]["yourNotes"], "Push for the pilot");
        assert_eq!(saved["yourNotesSalt"], "5a5a");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn claim_then_complete_with_the_same_rules_as_before() {
        let dir = data_dir("claim");
        let claim_req = |agent: &str| json!({ "op": "claim", "meetingId": "1761000000", "itemId": "a1", "agent": agent });
        dispatch(&dir, &claim_req("Claude Code"), &at("2026-10-26T12:00:00.000Z")).unwrap();
        assert_eq!(read_notes(&dir)["meeting"]["actionItems"][0]["claimed"], json!({ "agent": "Claude Code", "at": "2026-10-26T12:00:00.000Z" }));
        // Same agent again: harmless, keeps the first time. Another agent: refused.
        dispatch(&dir, &claim_req("Claude Code"), &at("later")).unwrap();
        assert_eq!(read_notes(&dir)["meeting"]["actionItems"][0]["claimed"]["at"], "2026-10-26T12:00:00.000Z");
        assert!(dispatch(&dir, &claim_req("Codex"), &at("x")).unwrap_err().contains("Already claimed by Claude Code"));
        let complete = |agent: &str| json!({ "op": "complete", "meetingId": "1761000000", "itemId": "a1", "agent": agent, "note": "  Sent the plan as a doc " });
        assert!(dispatch(&dir, &complete("Codex"), &at("x")).unwrap_err().contains("Claimed by Claude Code"));
        dispatch(&dir, &complete("Claude Code"), &at("2026-10-26T12:05:00.000Z")).unwrap();
        let item = &read_notes(&dir)["meeting"]["actionItems"][0];
        assert_eq!(item["done"], true);
        assert_eq!(item["completed"], json!({ "agent": "Claude Code", "at": "2026-10-26T12:05:00.000Z", "note": "Sent the plan as a doc" }));
        assert!(dispatch(&dir, &claim_req("Claude Code"), &at("x")).unwrap_err().contains("already done"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn writes_change_only_the_one_item_and_stay_encrypted() {
        let dir = data_dir("only");
        let before = read_notes(&dir);
        dispatch(&dir, &json!({ "op": "complete", "meetingId": "1761000000", "itemId": "a2", "agent": "Codex" }), &at("t")).unwrap();
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
        let r = |v: Value| dispatch(&dir, &v, &now).unwrap_err();
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
                    s.spawn(move || dispatch(dir, &json!({ "op": "claim", "meetingId": "1761000000", "itemId": "a1", "agent": agent }), &at("t")).is_ok())
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
        let server = Server::start(&dir, token.clone()).unwrap();
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

        drop(server);
        assert!(!path.exists());
        assert!(UnixStream::connect(&path).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn settings_are_saved_encrypted() {
        let dir = data_dir("settings");
        assert!(!load_settings(&dir).enabled);
        save_settings(&dir, &Settings { enabled: true, token: Some("t0k".into()) }).unwrap();
        assert!(at_rest::is_sealed(&std::fs::read(dir.join("agents.json")).unwrap()));
        let s = load_settings(&dir);
        assert!(s.enabled && s.token.as_deref() == Some("t0k"));
        assert!(same_token("abc", "abc") && !same_token("abc", "abd") && !same_token("abc", "ab"));
        assert_eq!(now_iso().len(), "2026-10-26T12:00:00.000Z".len());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
