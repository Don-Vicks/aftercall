//! Coding agents: the local channel the MCP server (apps/mcp) uses to reach meetings.
//!
//! Meetings are encrypted at rest, so the MCP server can't read files. Instead, while
//! the user has "Coding agents" turned on, the app listens on a Unix domain socket,
//! `<data dir>/agents/aftercall.sock` (folder 0700, socket 0600), and answers one JSON
//! request per line:
//!
//! ```text
//! → {"token":"…","op":"meetings"|"projects"|"notes"|"access"|"claim"|"complete"|"draft", ...args}
//! ← {"ok":true,"result":…}  or  {"ok":false,"error":"…"}
//! ```
//!
//! Every request must carry the token shown on the Coding agents screen. The token
//! is made when the user turns agents on and dropped when they turn them off, so
//! turning them back on needs the new setup command. With agents off there is no socket.
//!
//! The user can also keep agents to chosen projects (Settings → Coding agents): then
//! meetings in other projects aren't listed or searched, and a request for one is refused
//! with `PROJECT_OFF`, which doesn't name the project. Settings saved before this choice
//! existed read as every project.
//!
//! What a request can do is fixed here: read processed meetings and projects, and,
//! only while the user has turned on "Let agents claim and complete action items",
//! claim or complete one action item, completing it with a note and a link to the work,
//! and propose a follow-up ("draft"): a recap to an address, or a payment to a payee already
//! on the owner's list within the caps. A proposal waits for the owner's tap like any
//! other, marked as the agent's, and never runs on autopilot. That switch is off by default and goes back off
//! when agents are turned off. Nothing else in notes.json can be changed. Your notes
//! (what you typed during the call) and their salt are never sent.
//!
//! Each read, claim and completion, and every refused request, is added to a short
//! activity list, `agents-activity.json` (sealed like every other file): when, which agent
//! by its own name, which request, the meeting and item ids, and whether it was allowed.
//! Never meeting content. The newest 200 are kept. Allowed lookups of project names and
//! of the write switch come with other requests and aren't listed; nor are lines that
//! aren't JSON.
//!
//! Limits: the token sits in the agent's own config (e.g. ~/.claude.json), which other
//! software running as the user could read. This keeps meetings away from apps that
//! only read files; it is not a wall against malware running as the user.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{at_rest, notes_file};

const MAX_REQUEST: u64 = 64 * 1024;
const NOTE_MAX: usize = 500;
/// The longest link to the work kept on a completed item (`WORK_LINK_MAX` in core).
const LINK_MAX: usize = 300;

/// What an agent is told when it asks for a meeting in a project the user keeps from agents.
/// It doesn't name the project: that is the user's to keep, too.
pub const PROJECT_OFF: &str =
    "Aftercall doesn't let agents reach this meeting's project. The user can allow it under Coding agents in Aftercall's sidebar.";

/// What an agent is told when it tries to claim or complete while agents may only read.
pub const WRITES_OFF: &str =
    "Aftercall lets agents read only. To let them claim and complete action items, turn that on under Coding agents in Aftercall's sidebar.";

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
    /// When the current token was made, so the screen counts only requests sent with it.
    /// None for a token from before this was kept.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_since: Option<String>,
    /// The fingerprint of the token Aftercall gave Claude Code ("Connect Claude Code").
    /// Kept when agents are turned off, so the screen can ask to reconnect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude_code: Option<String>,
    /// The ids of the projects agents may read, or None for every project (and in an
    /// agents.json from before this choice). Kept when agents are turned off and on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub projects: Option<Vec<String>>,
}

/// The most projects the choice can name, and the longest id (as projects.rs allows).
const SCOPE_MAX: usize = 200;

/// Checks a choice of projects: None (every project), or ids as projects.json has them.
pub fn check_scope(projects: &Option<Vec<String>>) -> Result<(), String> {
    match projects {
        Some(ids) if ids.len() > SCOPE_MAX || ids.iter().any(|id| id.is_empty() || id.len() > 64) => Err("Choose at most 200 projects".into()),
        _ => Ok(()),
    }
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
                            let (root, token, can_write, closed) = (root.clone(), token.clone(), can_write.clone(), flag.clone());
                            let _ = std::thread::Builder::new()
                                .name("agents-conn".into())
                                .spawn(move || serve(stream, &root, &token, &can_write, &closed));
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

/// Turning agents off or making a new token drops the server. Connections that are
/// still open end before their next request, and nothing more is written.
impl Drop for Server {
    fn drop(&mut self) {
        self.writes.store(false, Ordering::Relaxed);
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Answers each request line on one connection, until the server stops.
fn serve(stream: UnixStream, data_dir: &Path, token: &str, writes: &AtomicBool, stop: &AtomicBool) {
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
        if stop.load(Ordering::Relaxed) {
            return;
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

const TOKEN_REFUSED: &str = "Aftercall refused the token. Reconnect Claude Code from Coding agents in Aftercall's sidebar.";

// ---------- what agents can do ----------

/// Runs one request. `writes` is the user's "Let agents claim and complete action items"
/// switch; `now` gives the time stamped on claims and completions.
pub fn dispatch(data_dir: &Path, req: &Value, writes: bool, now: &dyn Fn() -> String) -> Result<Value, String> {
    let str_arg = |k: &str| req[k].as_str().unwrap_or_default().to_string();
    let op = req["op"].as_str().unwrap_or_default();
    if matches!(op, "claim" | "complete" | "draft") && !writes {
        return Err(WRITES_OFF.into());
    }
    let scope = Scope::of(data_dir);
    if matches!(op, "claim" | "complete" | "draft") {
        scope.check(data_dir, &str_arg("meetingId"))?;
    }
    match op {
        "projects" => Ok(projects(data_dir, &scope)),
        "meetings" => Ok(Value::Array(meetings(data_dir, &scope))),
        "notes" => notes(data_dir, &str_arg("id"), &scope),
        "access" => Ok(json!({ "allowWrites": writes, "allProjects": matches!(scope, Scope::All) })),
        "claim" => claim(data_dir, &str_arg("meetingId"), &str_arg("itemId"), &str_arg("agent"), now),
        "complete" => complete(data_dir, &str_arg("meetingId"), &str_arg("itemId"), &str_arg("agent"), req["note"].as_str(), req["link"].as_str(), now),
        "draft" => draft(data_dir, req, now),
        _ => Err("Unknown request".into()),
    }
}

/// The projects whose meetings agents may reach: every one, or those the user chose, by name
/// (meetings keep their project's name). Read from the settings on each request.
enum Scope {
    All,
    Only(Vec<String>),
}

impl Scope {
    fn of(data_dir: &Path) -> Self {
        let Some(ids) = load_settings(data_dir).projects else { return Scope::All };
        let entries = crate::projects::load_entries(data_dir).unwrap_or_default();
        Scope::Only(entries.into_iter().filter(|e| ids.contains(&e.project.id)).map(|e| e.project.name).collect())
    }

    fn allows(&self, project: &str) -> bool {
        match self {
            Scope::All => true,
            Scope::Only(names) => names.iter().any(|n| n == project),
        }
    }

    /// Refuses a meeting outside the scope with `PROJECT_OFF`; an unknown id is left to the request's own error.
    fn check(&self, data_dir: &Path, meeting_id: &str) -> Result<(), String> {
        if matches!(self, Scope::All) {
            return Ok(());
        }
        let Ok(file) = notes_path(data_dir, meeting_id) else { return Ok(()) };
        let notes = notes_file::read(&file).unwrap_or_default();
        if self.allows(notes["meeting"]["project"].as_str().unwrap_or_default()) { Ok(()) } else { Err(PROJECT_OFF.into()) }
    }
}

/// Ids and names: a project's brief is the user's private context, so agents never get it.
/// Only the projects agents may reach are listed.
fn projects(data_dir: &Path, scope: &Scope) -> Value {
    match crate::projects::public_list(data_dir) {
        Value::Array(list) => Value::Array(list.into_iter().filter(|p| scope.allows(p["name"].as_str().unwrap_or_default())).collect()),
        other => other,
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

/// Every processed meeting agents may reach as `{ id, notes }`, newest first.
fn meetings(data_dir: &Path, scope: &Scope) -> Vec<Value> {
    let Ok(entries) = std::fs::read_dir(data_dir.join("recordings")) else { return vec![] };
    let mut out: Vec<(u64, Value)> = entries
        .flatten()
        .filter_map(|e| {
            let id = e.file_name().into_string().ok().filter(|id| valid_id(id))?;
            let notes = at_rest::read_json(&e.path().join("notes.json")).filter(|n| n["meeting"].is_object())?;
            if !scope.allows(notes["meeting"]["project"].as_str().unwrap_or_default()) {
                return None;
            }
            Some((id.parse().ok()?, json!({ "id": id, "notes": for_agents(notes) })))
        })
        .collect();
    out.sort_by_key(|(id, _)| std::cmp::Reverse(*id));
    out.into_iter().map(|(_, v)| v).collect()
}

fn notes(data_dir: &Path, id: &str, scope: &Scope) -> Result<Value, String> {
    let file = notes_path(data_dir, id)?;
    let notes = notes_file::read(&file).map_err(|_| format!("No processed meeting with id \"{id}\". Use list_meetings to see ids."))?;
    if !scope.allows(notes["meeting"]["project"].as_str().unwrap_or_default()) {
        return Err(PROJECT_OFF.into());
    }
    Ok(for_agents(notes))
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

/// The agent's name on one line: it shows in the app, the trail and, as "done by", in recaps,
/// so a line break in it could pass for a line Aftercall wrote.
fn check_agent(agent: &str) -> Result<String, String> {
    plain_text(agent, 60).ok_or_else(|| "Give your agent name, 1 to 60 characters (e.g. \"Claude Code\")".into())
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

/// The link an agent gives to its work, when it is a plain http or https URL: one line of
/// printable ASCII, a host and no user name or password, at most `LINK_MAX` characters
/// (`workLink` in core). Empty is none. It is the agent's statement: the app shows it as
/// such, never opens or checks it, and nothing that pays reads action items.
pub fn check_link(link: Option<&str>) -> Result<Option<String>, String> {
    let Some(link) = link.map(str::trim).filter(|l| !l.is_empty()) else { return Ok(None) };
    let bad = || "Give the link to your work as a plain http or https URL, at most 300 characters".to_string();
    if link.chars().count() > LINK_MAX || !link.bytes().all(|b| b.is_ascii_graphic()) {
        return Err(bad());
    }
    let lower = link.to_ascii_lowercase();
    let rest = lower.strip_prefix("https://").or_else(|| lower.strip_prefix("http://")).ok_or_else(bad)?;
    let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if host.is_empty() || host.contains('@') {
        return Err(bad());
    }
    Ok(Some(link.to_string()))
}

fn complete(data_dir: &Path, meeting_id: &str, item_id: &str, agent: &str, note: Option<&str>, link: Option<&str>, now: &dyn Fn() -> String) -> Result<Value, String> {
    let agent = check_agent(agent)?;
    let note: Option<String> = note.map(|n| n.trim().chars().take(NOTE_MAX).collect()).filter(|n: &String| !n.is_empty());
    let link = check_link(link)?;
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
        if let Some(l) = link {
            completed["link"] = l.into();
        }
        item.insert("completed".into(), completed);
        Ok(json!({ "completed": true, "item": item }))
    })
}

// ---------- follow-ups agents propose ----------
//
// An agent can propose a follow-up the meeting didn't produce: a recap to an address, or
// a payment. It lands in the meeting's follow-ups as proposed by that agent, with its
// reason in place of a quote from the call (`proposedBy`), and waits for the owner like
// any other: autopilot refuses it (`autopilotDecision` in core). A payment can only go
// to a payee already on the owner's list, within the per-payment cap and what's left
// today, as the app last read them from the contract (`set_wallet`); the contract checks
// both again when the owner approves. Nothing in a proposal can carry a link to work.

/// The longest reason an agent can give, in characters.
const REASON_MAX: usize = 300;
/// Proposals from agents waiting in one meeting at once.
const PROPOSALS_MAX: usize = 5;
/// Proposals from agents one meeting keeps in all. Dismissed ones stay in notes.json, so
/// without this an agent could keep adding them for as long as the user keeps dismissing.
const PROPOSALS_TOTAL_MAX: usize = 20;

/// A payee on the owner's list, as the app read it from the contract.
#[derive(Deserialize, Clone, Debug)]
pub struct Payee {
    pub name: String,
    pub account: String,
}

/// The owner's payee list and caps, as the app last read them from the contract. In
/// memory only; until the app has read them, agents can't propose payments.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WalletSnapshot {
    pub payees: Vec<Payee>,
    /// USDC base units; 0 means no per-payment cap, so nothing is proposed.
    pub per_payment_cap: String,
    pub left_today: String,
}

/// The snapshot for each data folder (one in the app; one per test).
static WALLETS: Mutex<Option<HashMap<PathBuf, WalletSnapshot>>> = Mutex::new(None);

/// Keeps the payee list and caps the app just read, for agents' payment proposals.
pub fn set_wallet(data_dir: &Path, wallet: WalletSnapshot) {
    if let Ok(mut all) = WALLETS.lock() {
        all.get_or_insert_with(HashMap::new).insert(data_dir.to_path_buf(), wallet);
    }
}

fn wallet(data_dir: &Path) -> Option<WalletSnapshot> {
    WALLETS.lock().ok()?.as_ref()?.get(data_dir).cloned()
}

/// "12.5" or "12.50" USDC as base units (6 decimals); None for anything else, zero included.
pub fn usdc_units(amount: &str) -> Option<u128> {
    let a = amount.trim();
    let (whole, frac) = a.split_once('.').unwrap_or((a, ""));
    if whole.is_empty() || whole.len() > 12 || frac.len() > 6 || !whole.bytes().all(|b| b.is_ascii_digit()) || !frac.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let units = whole.parse::<u128>().ok()? * 1_000_000 + format!("{frac:0<6}").parse::<u128>().ok()?;
    (units > 0).then_some(units)
}

fn plain_text(s: &str, max: usize) -> Option<String> {
    let t = s.split_whitespace().collect::<Vec<_>>().join(" ");
    (!t.is_empty() && t.chars().count() <= max && !t.chars().any(char::is_control)).then_some(t)
}

/// A plain email address: one @, a dot in the domain, printable ASCII, at most 254 characters.
fn check_email(to: &str) -> Option<String> {
    let to = to.trim();
    let (local, domain) = to.split_once('@')?;
    let ok = to.len() <= 254
        && to.bytes().all(|b| b.is_ascii_graphic())
        && !local.is_empty()
        && !domain.contains('@')
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !to.contains(['<', '>', '"', ',', ';', '\\']);
    ok.then(|| to.to_string())
}

/// A follow-up an agent proposes, checked and added to the meeting's follow-ups.
fn draft(data_dir: &Path, req: &Value, now: &dyn Fn() -> String) -> Result<Value, String> {
    let agent = check_agent(req["agent"].as_str().unwrap_or_default())?;
    let reason = plain_text(req["reason"].as_str().unwrap_or_default(), REASON_MAX)
        .ok_or_else(|| format!("Give your reason for this follow-up, one line of at most {REASON_MAX} characters; the user sees it in place of a quote"))?;
    let meeting_id = req["meetingId"].as_str().unwrap_or_default();
    let file = notes_path(data_dir, meeting_id)?;
    let at = now();
    let proposed_by = json!({ "agent": agent, "at": at, "reason": reason });
    let mut follow_up = match req["kind"].as_str().unwrap_or_default() {
        "email" => {
            let to = check_email(req["to"].as_str().unwrap_or_default()).ok_or("Give the recap's address as a plain email address")?;
            let to_name = match req["toName"].as_str().filter(|n| !n.trim().is_empty()) {
                Some(n) => plain_text(n, 80).ok_or("Keep the name under 80 characters")?,
                None => to.split('@').next().unwrap_or_default().to_string(),
            };
            let subject = match req["subject"].as_str().filter(|s| !s.trim().is_empty()) {
                Some(s) => Some(plain_text(s, 200).ok_or("Keep the subject under 200 characters, on one line")?),
                None => None,
            };
            json!({ "kind": "email", "to": to, "toName": to_name, "subject": subject })
        }
        "payment" => {
            let units = usdc_units(req["amount"].as_str().unwrap_or_default()).ok_or("Give the amount in USDC, like \"12.50\"")?;
            let wallet = wallet(data_dir).ok_or("Aftercall hasn't read your payee list from NEAR yet, so agents can't propose payments. Open the wallet in Aftercall, then try again.")?;
            let wanted = req["payee"].as_str().unwrap_or_default().trim().to_lowercase();
            let payee = wallet
                .payees
                .iter()
                .find(|p| !wanted.is_empty() && (p.account.to_lowercase() == wanted || p.name.trim().to_lowercase() == wanted))
                .ok_or("Agents can only propose payments to payees already on the user's list. Use the payee's name or NEAR account as listed.")?;
            let cap: u128 = wallet.per_payment_cap.parse().unwrap_or(0);
            let left: u128 = wallet.left_today.parse().unwrap_or(0);
            // 0 is no per-payment cap on the contract; agents then propose no payment at all.
            if cap == 0 {
                return Err("The user hasn't set a per-payment cap, so agents can't propose payments".into());
            }
            if units > cap {
                return Err("That's over the user's per-payment cap, so agents can't propose it".into());
            }
            if units > left {
                return Err("That's over what the user's agent wallet can still pay today, so agents can't propose it".into());
            }
            json!({ "kind": "payment", "payeeName": payee.name, "payeeAccount": payee.account, "amount": { "$bigint": units.to_string() }, "heard": "", "payeeListed": true })
        }
        _ => return Err("A follow-up is a recap (kind \"email\") or a payment (kind \"payment\")".into()),
    };
    notes_file::try_update(&file, |notes| {
        let title = notes["meeting"]["title"].as_str().unwrap_or("Meeting").to_string();
        let list = notes["meeting"]["followUps"].as_array_mut().ok_or("This meeting's notes have no follow-ups list")?;
        let proposed = list.iter().filter(|f| f.get("proposedBy").is_some());
        if proposed.clone().count() >= PROPOSALS_TOTAL_MAX {
            return Err(format!("Agents have proposed {PROPOSALS_TOTAL_MAX} follow-ups in this meeting, the most one meeting keeps. Tell the user what you'd propose instead."));
        }
        let waiting = proposed.filter(|f| f["status"] == "proposed").count();
        if waiting >= PROPOSALS_MAX {
            return Err(format!("{PROPOSALS_MAX} proposals from agents already wait in this meeting. Ask the user to approve or dismiss them first."));
        }
        let n = (1..).find(|n| !list.iter().any(|f| f["id"] == format!("agent-{n}"))).unwrap_or(1);
        let fu = follow_up.as_object_mut().ok_or("Bad follow-up")?;
        fu.insert("id".into(), format!("agent-{n}").into());
        fu.insert("status".into(), "proposed".into());
        fu.insert("proposedBy".into(), proposed_by.clone());
        if fu.get("subject").is_some_and(Value::is_null) {
            fu.insert("subject".into(), title.into());
        }
        list.push(follow_up.clone());
        Ok(json!({ "drafted": true, "followUp": follow_up }))
    })
}

// ---------- the activity list ----------

const ACTIVITY_MAX: usize = 200;
const NAME_MAX: usize = 60;

/// One agent request as the user sees it on the Coding agents screen. Ids and names
/// only: the meeting's title, the item's text and any note stay in notes.json.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub at: String,
    /// What the agent calls itself: the name it gave a claim or completion, else its
    /// MCP client name (e.g. "claude-code"). Neither is checked.
    pub agent: String,
    /// "meetings", "notes", "claim", "complete", "draft", "projects" or "access" (only when
    /// refused), or "other" for a request Aftercall doesn't know.
    pub op: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meeting_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    pub allowed: bool,
    /// Why it was refused: "token", "read-only", "project" (a project the user keeps from
    /// agents), "unknown" (a request Aftercall doesn't know), or "rules" (anything else: an
    /// unknown id, done, claimed by another agent, no agent name, or the notes couldn't be read).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refused: Option<String>,
}

impl Activity {
    /// The entry for one request, or None for allowed lookups that come with other
    /// requests (project names, the write switch), which would only crowd the list.
    /// Refused ones are listed, so a wrong or old token always leaves a trace.
    fn of(req: &Value, result: &Result<Value, String>, now: &dyn Fn() -> String) -> Option<Self> {
        let op = match req["op"].as_str().unwrap_or_default() {
            "projects" | "access" if result.is_ok() => return None,
            op @ ("meetings" | "notes" | "claim" | "complete" | "draft" | "projects" | "access") => op,
            _ => "other",
        };
        let short = |v: &Value| v.as_str().map(|s| s.trim().chars().filter(|c| !c.is_control()).take(NAME_MAX).collect::<String>()).filter(|s| !s.is_empty());
        let meeting_id = req["meetingId"].as_str().or(req["id"].as_str()).filter(|id| valid_id(id)).map(str::to_string);
        let item_id = req["itemId"].as_str().filter(|id| !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        let refused = result.as_ref().err().map(|e| match e.as_str() {
            TOKEN_REFUSED => "token",
            WRITES_OFF => "read-only",
            PROJECT_OFF => "project",
            _ if op == "other" => "unknown",
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
pub(crate) fn now_iso() -> String {
    let d = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    let secs = d.as_secs();
    let (y, m, day) = crate::recovery::civil_date(secs);
    let t = secs % 86_400;
    format!("{y:04}-{m:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z", t / 3600, t / 60 % 60, t % 60, d.subsec_millis())
}

// ---------- Claude Code ----------
//
// "Connect Claude Code" runs the same `claude mcp add` the screen offers to copy, so the
// user doesn't have to open Terminal. An app opened from the Finder gets a minimal PATH
// (/usr/bin:/bin:/usr/sbin:/sbin), so the claude CLI and node are looked for in the
// folders they are usually installed in, then in the login shell's PATH. node's full
// path goes into the command, so Claude Code doesn't depend on its own PATH either.

/// Aftercall's server needs Node 20 or later, as the screen and docs/agents-demo.md say.
const NODE_MIN: u32 = 20;
/// How long one `claude` or shell call may take before it is stopped.
const TOOL_LIMIT: Duration = Duration::from_secs(30);

/// Removes Aftercall from Claude Code's user config. It fails, harmlessly, when there is none.
pub const CLAUDE_REMOVE: [&str; 5] = ["mcp", "remove", "--scope", "user", "aftercall"];

/// `claude mcp add` for every project (user scope): the command `claudeCommand` in
/// agents.ts shows, with node's full path. The name comes before `--env`, which takes
/// several values and would swallow it otherwise.
pub fn claude_add_args(token: &str, node: &Path, server: &Path, data_dir: &Path) -> Vec<String> {
    let mut args: Vec<String> = ["mcp", "add", "--scope", "user", "aftercall", "--env"].map(String::from).to_vec();
    args.push(format!("AFTERCALL_TOKEN={token}"));
    args.push("--".into());
    args.extend([node, server].map(|p| p.display().to_string()));
    args.push("--data-dir".into());
    args.push(data_dir.display().to_string());
    args
}

/// A short hash of the token: enough to tell which token Claude Code was given.
fn fingerprint(token: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(token.as_bytes()).iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// What the screen shows for Claude Code: "none", "connected" (Aftercall added itself
/// with the current token) or "stale" (with an older token, or agents are off: reconnect).
pub fn claude_link(s: &Settings) -> &'static str {
    match (&s.claude_code, &s.token) {
        (None, _) => "none",
        (Some(f), Some(t)) if *f == fingerprint(t) => "connected",
        _ => "stale",
    }
}

/// The folders a tool is usually installed in, in the order they are tried.
pub fn tool_dirs(name: &str, home: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![home.join(".local/bin")];
    if name == "claude" {
        dirs.push(home.join(".claude/local"));
    }
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
    dirs
}

fn is_executable(p: &Path) -> bool {
    std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

/// Every copy of `name` found, in order: in `dirs`, then the paths `login_shell` printed
/// for it (only full paths to an executable of that name; aliases and other lines are skipped).
pub fn find_tool(name: &str, dirs: &[PathBuf], login_shell: &dyn Fn(&str) -> Option<String>) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = dirs.iter().map(|d| d.join(name)).filter(|p| is_executable(p)).collect();
    for line in login_shell(name).unwrap_or_default().lines().map(str::trim) {
        let p = PathBuf::from(line);
        if p.is_absolute() && p.file_name().is_some_and(|f| f == name) && is_executable(&p) && !found.contains(&p) {
            found.push(p);
        }
    }
    found
}

/// Asks the user's login shell where `name` is, as Terminal would find it.
fn login_shell_lookup(name: &str) -> Option<String> {
    let out = run(Command::new("/bin/zsh").args(["-lc", &format!("command -v {name}")]), Duration::from_secs(5)).ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// The major version in `node --version`'s answer: "v24.10.0" is 24.
fn node_major(version: &str) -> Option<u32> {
    version.trim().strip_prefix('v')?.split('.').next()?.parse().ok()
}

/// The first node that is new enough, or why there is none.
pub fn pick_node(found: &[PathBuf], major: &dyn Fn(&Path) -> Option<u32>) -> Result<PathBuf, String> {
    let mut old = None;
    for p in found {
        match major(p) {
            Some(v) if v >= NODE_MIN => return Ok(p.clone()),
            Some(v) if old.is_none() => old = Some((v, p)),
            _ => {}
        }
    }
    Err(match old {
        Some((v, p)) => format!("Aftercall's server needs Node {NODE_MIN} or later, and this Mac has Node {v} at {}. Update Node, then try again.", p.display()),
        None => format!("Aftercall couldn't find Node on this Mac. Install Node {NODE_MIN} or later from nodejs.org, then try again."),
    })
}

fn node_version(node: &Path) -> Option<u32> {
    let out = run(Command::new(node).arg("--version"), Duration::from_secs(5)).ok()?;
    node_major(&String::from_utf8_lossy(&out.stdout))
}

/// The claude CLI and a node that is new enough, looked for as described above.
pub fn find_claude_and_node(home: &Path) -> (Option<PathBuf>, Result<PathBuf, String>) {
    let claude = find_tool("claude", &tool_dirs("claude", home), &login_shell_lookup).into_iter().next();
    let node = pick_node(&find_tool("node", &tool_dirs("node", home), &login_shell_lookup), &node_version);
    (claude, node)
}

/// Runs a command with no input, stopping it after `limit`. Its output is small, so it
/// is read once it has finished.
fn run(cmd: &mut Command, limit: Duration) -> Result<Output, String> {
    let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    let started = Instant::now();
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            return child.wait_with_output().map_err(|e| e.to_string());
        }
        if started.elapsed() > limit {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("it didn't finish within {} seconds", limit.as_secs()));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// A `claude` call with the tools' folders first on PATH: an npm install of claude starts with `#!/usr/bin/env node`.
fn claude_call(claude: &Path, node: Option<&Path>, args: &[String]) -> Result<Output, String> {
    let mut path: Vec<PathBuf> = [Some(claude), node].into_iter().flatten().filter_map(|p| p.parent().map(Path::to_path_buf)).collect();
    path.extend(std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect::<Vec<_>>()).unwrap_or_default());
    let path = std::env::join_paths(path).map_err(|e| e.to_string())?;
    run(Command::new(claude).args(args).env("PATH", path), TOOL_LIMIT)
}

/// What claude printed, on one line, with the token taken out.
fn said(out: &Output, token: &str) -> String {
    let text = format!("{}\n{}", String::from_utf8_lossy(&out.stderr), String::from_utf8_lossy(&out.stdout));
    let line = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("no message");
    let line = if token.is_empty() { line.to_string() } else { line.replace(token, "<token>") };
    line.chars().take(300).collect()
}

/// The result of Connect or Disconnect Claude Code, as the screen shows it.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeOutcome {
    pub ok: bool,
    /// "claude" or "node" when that couldn't be found: the screen offers the copy command.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing: Option<&'static str>,
    pub message: String,
    /// What to save as `Settings::claude_code` after this: Some(None) forgets it.
    #[serde(skip)]
    pub link: Option<Option<String>>,
}

impl ClaudeOutcome {
    fn failed(message: String) -> Self {
        Self { ok: false, missing: None, message, link: None }
    }
}

pub const CLAUDE_CONNECTED: &str = "Claude Code can now reach Aftercall. Start a new Claude Code session to use it.";
const NO_CLAUDE: &str = "Aftercall couldn't find the claude command on this Mac. Run this in Terminal instead.";

/// "Connect Claude Code": replaces any Aftercall entry in Claude Code's user config
/// with one that runs `server` with the current token. Agents must be on.
pub fn connect_claude(data_dir: &Path, server: &Path, claude: Option<&Path>, node: Result<PathBuf, String>) -> ClaudeOutcome {
    let settings = load_settings(data_dir);
    let Some(token) = settings.token.filter(|_| settings.enabled) else {
        return ClaudeOutcome::failed("Turn on \u{201c}Let agents read your meetings\u{201d} first.".into());
    };
    if !server.exists() {
        return ClaudeOutcome::failed(format!("Aftercall's server isn't at {}. Reinstall Aftercall, then try again.", server.display()));
    }
    let Some(claude) = claude else {
        return ClaudeOutcome { ok: false, missing: Some("claude"), message: NO_CLAUDE.into(), link: None };
    };
    let node = match node {
        Ok(n) => n,
        Err(message) => return ClaudeOutcome { ok: false, missing: Some("node"), message, link: None },
    };
    // Replace an entry made with an older token or path. Failing only means there was none.
    let _ = claude_call(claude, Some(&node), &CLAUDE_REMOVE.map(String::from));
    match claude_call(claude, Some(&node), &claude_add_args(&token, &node, server, data_dir)) {
        Ok(out) if out.status.success() => ClaudeOutcome { ok: true, missing: None, message: CLAUDE_CONNECTED.into(), link: Some(Some(fingerprint(&token))) },
        Ok(out) => ClaudeOutcome::failed(format!("Claude Code didn't add Aftercall: {}", said(&out, &token))),
        Err(e) => ClaudeOutcome::failed(format!("Claude Code didn't answer: {e}.")),
    }
}

/// "Disconnect Claude Code": removes Aftercall from Claude Code's user config.
pub fn disconnect_claude(claude: Option<&Path>) -> ClaudeOutcome {
    let Some(claude) = claude else {
        return ClaudeOutcome { ok: false, missing: Some("claude"), message: NO_CLAUDE.into(), link: None };
    };
    match claude_call(claude, None, &CLAUDE_REMOVE.map(String::from)) {
        Ok(out) if out.status.success() => ClaudeOutcome { ok: true, missing: None, message: "Claude Code can no longer reach Aftercall.".into(), link: Some(None) },
        Ok(out) if said(&out, "").contains("No MCP server named") => {
            ClaudeOutcome { ok: true, missing: None, message: "Claude Code had no Aftercall entry, so there was nothing to remove.".into(), link: Some(None) }
        }
        Ok(out) => ClaudeOutcome::failed(format!("Claude Code didn't remove Aftercall: {}", said(&out, ""))),
        Err(e) => ClaudeOutcome::failed(format!("Claude Code didn't answer: {e}.")),
    }
}

/// Saves what Connect or Disconnect left behind.
pub fn remember_claude(data_dir: &Path, outcome: &ClaudeOutcome) -> Result<(), String> {
    let Some(link) = &outcome.link else { return Ok(()) };
    let mut s = load_settings(data_dir);
    s.claude_code = link.clone();
    save_settings(data_dir, &s)
}

// ---------- Open in Claude Code ----------
//
// "Open in Claude Code" on an action item opens Terminal in the project's code folder and
// starts `claude` with the hand-off prompt (`handoffPrompt` in core). The prompt carries
// the meeting's words, so it never goes into a shell string: it is written to a private
// file (0600, in a 0700 folder under `agents/`), and the script Terminal runs reads it
// into a variable, which the shell hands to claude as one argument without reading it as
// code. The script holds only paths Aftercall chose, each single-quoted. When Claude Code
// isn't connected with the current token, the script also passes `--mcp-config` with the
// same server "Connect Claude Code" adds, under its own name (`TASK_SERVER`); that file holds
// the token, so it sits in the same private folder, which the script deletes when claude
// exits (or the next Open does).

/// The longest prompt passed to Claude Code, in bytes.
const PROMPT_MAX: usize = 8 * 1024;
/// A private folder older than this is left from an earlier Open whose claude has long read its files.
const HANDOFF_STALE: Duration = Duration::from_secs(120);

/// Where the private folders for Open in Claude Code go.
pub fn handoff_root(data_dir: &Path) -> PathBuf {
    socket_dir(data_dir).join("handoff")
}

/// One word for /bin/sh: single-quoted, with each `'` closed, escaped and reopened.
pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// The code folder as a real folder, or why it can't be used.
pub fn check_folder(folder: &Path) -> Result<PathBuf, String> {
    match std::fs::metadata(folder) {
        Ok(m) if m.is_dir() => folder.canonicalize().map_err(|e| e.to_string()),
        Ok(_) => Err(format!("{} isn't a folder. Choose the code folder again on the project page.", folder.display())),
        Err(_) => Err(format!("The code folder {} isn't there. Choose it again on the project page.", folder.display())),
    }
}

/// A prompt claude takes as its first message: not empty, not huge, and not read as an option.
pub fn check_prompt(prompt: &str) -> Result<(), String> {
    if prompt.trim().is_empty() || prompt.len() > PROMPT_MAX || prompt.starts_with('-') || prompt.contains('\0') {
        return Err("That prompt can't be passed to Claude Code. Copy it instead.".into());
    }
    Ok(())
}

/// What Open in Claude Code names Aftercall's server in its `--mcp-config` file. Claude Code
/// may still have a user-scope "aftercall" with an older token, and with two servers of one
/// name, which one the session gets is left to chance; under its own name, the server with
/// the current token is always there.
pub const TASK_SERVER: &str = "aftercall-task";
/// How the hand-off prompt starts (`handoffPrompt` in core).
const PROMPT_LEAD: &str = "Using the aftercall MCP server";

/// The same server "Connect Claude Code" adds (`claude_add_args`), as a `--mcp-config` file,
/// named `TASK_SERVER`.
pub fn mcp_config(token: &str, node: &Path, server: &Path, data_dir: &Path) -> Value {
    json!({ "mcpServers": { TASK_SERVER: {
        "command": node.display().to_string(),
        "args": [server.display().to_string(), "--data-dir", data_dir.display().to_string()],
        "env": { "AFTERCALL_TOKEN": token },
    } } })
}

/// The hand-off prompt for a session given `mcp_config`: it names `TASK_SERVER`, so the agent
/// doesn't use an "aftercall" holding an older token. Any other prompt is left as it is.
pub fn for_task_server(prompt: &str) -> String {
    match prompt.strip_prefix(PROMPT_LEAD) {
        Some(rest) => format!("Using the {TASK_SERVER} MCP server{rest}"),
        None => prompt.to_string(),
    }
}

/// The script Terminal runs. Everything in it is a path Aftercall chose, single-quoted;
/// the prompt is only ever in `prompt_file`.
pub fn launch_script(folder: &Path, claude: &Path, path_dirs: &[PathBuf], prompt_file: &Path, mcp: Option<&Path>, private_dir: &Path) -> String {
    let q = |p: &Path| sh_quote(&p.display().to_string());
    let mut lines = vec!["#!/bin/sh".to_string(), "# Written by Aftercall for Open in Claude Code. The prompt is read from a file; it is never part of this script.".to_string()];
    if !path_dirs.is_empty() {
        // claude installed by npm starts with `#!/usr/bin/env node`.
        lines.push(format!("PATH={}:\"$PATH\"; export PATH", path_dirs.iter().map(|d| q(d)).collect::<Vec<_>>().join(":")));
    }
    lines.push(format!("cd {} || exit 1", q(folder)));
    lines.push(format!("prompt=$(cat {}) || exit 1", q(prompt_file)));
    lines.push(format!("rm -f {}", q(prompt_file)));
    // `--mcp-config` takes several files and would read the prompt as one more; after `--`
    // the prompt is always the one message, never a file or an option.
    let config = mcp.map(|c| format!(" --mcp-config {}", q(c))).unwrap_or_default();
    lines.push(format!("{}{config} -- \"$prompt\"", q(claude)));
    lines.push("status=$?".into());
    lines.push(format!("rm -rf {}", q(private_dir)));
    lines.push("exit $status".into());
    lines.join("\n") + "\n"
}

/// What `open` is given: Terminal, and the script.
pub fn terminal_args(script: &Path) -> Vec<String> {
    vec!["-a".into(), "Terminal".into(), script.display().to_string()]
}

/// A new file only the user can read (and, with `exec`, run).
fn write_private(path: &Path, text: &str, exec: bool) -> Result<(), String> {
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(if exec { 0o700 } else { 0o600 })
        .open(path)
        .map_err(|e| e.to_string())?;
    f.write_all(text.as_bytes()).map_err(|e| e.to_string())
}

/// The private folder for one Open: the prompt, the MCP config when one is needed, and the script.
pub struct Prepared {
    pub dir: PathBuf,
    pub script: PathBuf,
}

/// Writes the private folder for one Open, after clearing folders earlier ones left.
pub fn prepare_launch(data_dir: &Path, folder: &Path, prompt: &str, claude: &Path, node: Option<&Path>, mcp: Option<&Value>) -> Result<Prepared, String> {
    check_prompt(prompt)?;
    let folder = check_folder(folder)?;
    let root = handoff_root(data_dir);
    std::fs::DirBuilder::new().recursive(true).mode(0o700).create(&root).map_err(|e| e.to_string())?;
    for dir in [socket_dir(data_dir), root.clone()] {
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    for e in std::fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
        let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age > HANDOFF_STALE);
        if old {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
    let dir = root.join(&new_token()?[..16]);
    std::fs::DirBuilder::new().mode(0o700).create(&dir).map_err(|e| e.to_string())?;
    let prompt_file = dir.join("prompt.txt");
    write_private(&prompt_file, prompt, false)?;
    let config = match mcp {
        Some(v) => {
            let p = dir.join("mcp.json");
            write_private(&p, &v.to_string(), false)?;
            Some(p)
        }
        None => None,
    };
    let mut path_dirs: Vec<PathBuf> = [Some(claude), node].into_iter().flatten().filter_map(|p| p.parent().map(Path::to_path_buf)).collect();
    path_dirs.dedup();
    let script = dir.join("open-in-claude-code.command");
    write_private(&script, &launch_script(&folder, claude, &path_dirs, &prompt_file, config.as_deref(), &dir), true)?;
    Ok(Prepared { dir, script })
}

/// What Open in Claude Code did, as the action item's menu shows it.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpenOutcome {
    pub ok: bool,
    /// What's missing, so the menu copies the prompt instead: "folder", "agents", "claude" or "node";
    /// or "project", a project the user keeps from agents, when nothing is copied either.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing: Option<&'static str>,
    pub message: String,
}

impl OpenOutcome {
    fn missing(what: &'static str, message: String) -> Self {
        Self { ok: false, missing: Some(what), message }
    }
}

/// "Open in Claude Code" for a meeting in `project`: Terminal in the project's code folder,
/// running claude with `prompt`, with Aftercall's MCP server. `open` starts Terminal with
/// the given arguments (tests pass a stand-in).
pub fn open_in_claude_code(
    data_dir: &Path,
    project: &str,
    prompt: &str,
    server: &Path,
    claude: Option<&Path>,
    node: Result<PathBuf, String>,
    open: &dyn Fn(&[String]) -> Result<(), String>,
) -> OpenOutcome {
    let Some(folder) = crate::projects::code_folder(data_dir, project) else {
        return OpenOutcome::missing("folder", format!("{project} has no code folder. Choose one on its project page."));
    };
    // A project the user keeps from agents: the prompt carries the item's words, so nothing
    // starts, and nothing is copied either, even with agents off.
    if !Scope::of(data_dir).allows(project) {
        return OpenOutcome::missing("project", format!("Agents can't reach meetings in {project}, so Aftercall didn't start Claude Code. Allow that project in Coding agents first."));
    }
    let settings = load_settings(data_dir);
    let Some(token) = settings.token.clone().filter(|_| settings.enabled) else {
        return OpenOutcome::missing("agents", "Turn on \u{201c}Let agents read your meetings\u{201d} in Coding agents first, so Claude Code can reach this meeting.".into());
    };
    let Some(claude) = claude else {
        return OpenOutcome::missing("claude", "Aftercall couldn't find the claude command on this Mac, so it copied the prompt instead.".into());
    };
    // Connected with this token: Claude Code already has the server, for every project.
    let (node, mcp) = if claude_link(&settings) == "connected" {
        (node.ok(), None)
    } else {
        let node = match node {
            Ok(n) => n,
            Err(message) => return OpenOutcome::missing("node", message),
        };
        if !server.exists() {
            return OpenOutcome { ok: false, missing: None, message: format!("Aftercall's server isn't at {}. Reinstall Aftercall, then try again.", server.display()) };
        }
        let config = mcp_config(&token, &node, server, data_dir);
        (Some(node), Some(config))
    };
    let prompt = if mcp.is_some() { for_task_server(prompt) } else { prompt.to_string() };
    let prepared = match prepare_launch(data_dir, &folder, &prompt, claude, node.as_deref(), mcp.as_ref()) {
        Ok(p) => p,
        Err(message) => return OpenOutcome { ok: false, missing: None, message },
    };
    match open(&terminal_args(&prepared.script)) {
        Ok(()) => OpenOutcome { ok: true, missing: None, message: format!("Claude Code is starting in Terminal, in {}.", folder.display()) },
        Err(e) => {
            let _ = std::fs::remove_dir_all(&prepared.dir);
            OpenOutcome { ok: false, missing: None, message: format!("Terminal didn't open: {e}") }
        }
    }
}

/// Starts Terminal with the script, through macOS's `open`.
pub fn open_terminal(args: &[String]) -> Result<(), String> {
    let out = run(Command::new("/usr/bin/open").args(args), Duration::from_secs(10))?;
    if out.status.success() { Ok(()) } else { Err(said(&out, "")) }
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
            "notes": { "action_items": [
                { "text": "Send Ada the pilot plan", "owner": "You", "due": null, "evidence": "e1" },
                { "text": "Share the term sheet", "owner": "Ada", "due": null, "evidence": "e2" },
                { "text": "Book the call", "owner": "You", "due": null, "evidence": "e3" }
            ] },
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
        // A project's brief never reaches an agent.
        at_rest::write_json(&dir.join("projects.json"), &json!([{ "id": "general", "name": "General", "brief": { "about": "Secret plans", "words": ["Moonbeam"] } }])).unwrap();
        assert_eq!(dispatch_rw(&dir, &json!({ "op": "projects" }), &now).unwrap(), json!([{ "id": "general", "name": "General" }]));
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

    fn wallet_for(dir: &Path) {
        set_wallet(
            dir,
            WalletSnapshot { payees: vec![Payee { name: "Designer".into(), account: "designer.testnet".into() }], per_payment_cap: "50000000".into(), left_today: "30000000".into() },
        );
    }

    #[test]
    fn agents_propose_a_recap_marked_as_theirs_with_their_reason() {
        let dir = data_dir("draft-mail");
        let req = json!({ "op": "draft", "meetingId": "1761000000", "agent": "Codex", "kind": "email", "to": "olamide@client.test", "reason": "  Olamide asked for the staging DNS\n once it was up ", "link": "https://example.com/x" });
        assert_eq!(dispatch(&dir, &req, false, &at("t")).unwrap_err(), WRITES_OFF, "needs the write switch");
        let out = dispatch_rw(&dir, &req, &at("2026-11-02T10:00:00.000Z")).unwrap();
        let saved = read_notes(&dir)["meeting"]["followUps"].as_array().unwrap().last().unwrap().clone();
        assert_eq!(out["followUp"], saved);
        assert_eq!(
            saved,
            json!({ "kind": "email", "to": "olamide@client.test", "toName": "olamide", "subject": "Sync with Ada", "id": "agent-1", "status": "proposed",
                "proposedBy": { "agent": "Codex", "at": "2026-11-02T10:00:00.000Z", "reason": "Olamide asked for the staging DNS once it was up" } })
        );
        assert!(saved.get("evidence").is_none() && saved.get("link").is_none(), "no quote from the call, and no link");
        // The next one gets the next id; bad input is refused by name.
        let next = dispatch_rw(&dir, &json!({ "op": "draft", "meetingId": "1761000000", "agent": "Codex", "kind": "email", "to": "ada@example.com", "toName": "Ada", "subject": "Pilot plan", "reason": "x" }), &at("t")).unwrap();
        assert_eq!((next["followUp"]["id"].as_str(), next["followUp"]["subject"].as_str()), (Some("agent-2"), Some("Pilot plan")));
        let r = |v: Value| dispatch_rw(&dir, &v, &at("t")).unwrap_err();
        let base = json!({ "op": "draft", "meetingId": "1761000000", "agent": "Codex", "kind": "email", "to": "ada@example.com", "reason": "Because" });
        let with = |k: &str, v: Value| {
            let mut b = base.clone();
            b[k] = v;
            b
        };
        assert!(r(with("reason", json!(""))).contains("reason"));
        assert!(r(with("reason", json!("x".repeat(REASON_MAX + 1)))).contains("reason"));
        for bad in ["ada", "ada@example", "Ada <ada@example.com>", "a@b.com, eve@evil.test", "ada@exa mple.com"] {
            assert!(r(with("to", json!(bad))).contains("email address"), "{bad}");
        }
        assert!(r(with("kind", json!("sms"))).contains("recap"));
        assert!(r(with("meetingId", json!("1761200000"))).contains("No processed meeting"));
        assert!(r(with("agent", json!(" "))).contains("agent name"));
        // At most five waiting at once.
        for _ in 0..3 {
            dispatch_rw(&dir, &base, &at("t")).unwrap();
        }
        assert!(r(base.clone()).contains("already wait"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_meeting_keeps_at_most_20_proposals_dismissed_ones_included() {
        let dir = data_dir("draft-cap");
        let file = dir.join("recordings/1761000000/notes.json");
        let req = json!({ "op": "draft", "meetingId": "1761000000", "agent": "Codex", "kind": "email", "to": "ada@example.com", "reason": "Ada asked" });
        let dismiss_all = || {
            notes_file::update(&file, |n| {
                for f in n["meeting"]["followUps"].as_array_mut().unwrap() {
                    if f["status"] == "proposed" {
                        f["status"] = "dismissed".into();
                    }
                }
            })
            .unwrap()
        };
        // Five wait at once; dismissing makes room again, until 20 in all.
        for round in 1..=4 {
            for _ in 0..PROPOSALS_MAX {
                dispatch_rw(&dir, &req, &at("t")).unwrap();
            }
            let err = dispatch_rw(&dir, &req, &at("t")).unwrap_err();
            assert!(err.contains(if round < 4 { "already wait" } else { "proposed 20 follow-ups in this meeting" }), "{err}");
            dismiss_all();
        }
        // All 20 dismissed, none waiting: still refused.
        let err = dispatch_rw(&dir, &req, &at("t")).unwrap_err();
        assert!(err.contains("proposed 20 follow-ups in this meeting") && err.contains("Tell the user"), "{err}");
        let list = read_notes(&dir)["meeting"]["followUps"].as_array().unwrap().clone();
        assert_eq!(list.iter().filter(|f| f.get("proposedBy").is_some()).count(), PROPOSALS_TOTAL_MAX, "nothing more is kept");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn agents_propose_payments_only_to_listed_payees_within_the_caps() {
        let dir = data_dir("draft-pay");
        let pay = |payee: &str, amount: &str| dispatch_rw(&dir, &json!({ "op": "draft", "meetingId": "1761000000", "agent": "Claude Code", "kind": "payment", "payee": payee, "amount": amount, "reason": "The deposit agreed in the call" }), &at("t"));
        assert!(pay("Designer", "20").unwrap_err().contains("hasn't read your payee list"), "no list read yet: no payments");
        wallet_for(&dir);
        assert!(pay("eve.testnet", "1").unwrap_err().contains("payees already on the user's list"));
        assert!(pay("Designer", "50.000001").unwrap_err().contains("per-payment cap"));
        assert!(pay("Designer", "30.5").unwrap_err().contains("still pay today"));
        for bad in ["0", "-5", "1e3", "12.3456789", "twelve", ""] {
            assert!(pay("Designer", bad).unwrap_err().contains("amount in USDC"), "{bad}");
        }
        let out = pay("DESIGNER.testnet", "12.5").unwrap();
        assert_eq!(
            out["followUp"],
            json!({ "kind": "payment", "payeeName": "Designer", "payeeAccount": "designer.testnet", "amount": { "$bigint": "12500000" }, "heard": "", "payeeListed": true,
                "id": "agent-1", "status": "proposed", "proposedBy": { "agent": "Claude Code", "at": "t", "reason": "The deposit agreed in the call" } })
        );
        // A per-payment cap of 0 means none set: nothing is proposed.
        set_wallet(&dir, WalletSnapshot { payees: vec![Payee { name: "Designer".into(), account: "designer.testnet".into() }], per_payment_cap: "0".into(), left_today: "99000000".into() });
        assert!(pay("Designer", "1").unwrap_err().contains("hasn't set a per-payment cap"));
        assert_eq!(usdc_units("12.50"), Some(12_500_000));
        assert_eq!(usdc_units("7"), Some(7_000_000));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_save_from_the_app_keeps_a_proposal_it_hasnt_read_yet() {
        let dir = data_dir("draft-keep");
        let file = dir.join("recordings/1761000000/notes.json");
        // The app read the notes before the agent proposed anything.
        let app_copy = read_notes(&dir);
        dispatch_rw(&dir, &json!({ "op": "draft", "meetingId": "1761000000", "agent": "Codex", "kind": "email", "to": "ada@example.com", "reason": "Ada asked" }), &at("t")).unwrap();
        let mut changed = app_copy.clone();
        changed["meeting"]["followUps"][0]["status"] = "dismissed".into();
        notes_file::save(&file, &changed.to_string()).unwrap();
        let saved = read_notes(&dir)["meeting"]["followUps"].clone();
        assert_eq!(saved[0]["status"], "dismissed", "the app's own change lands");
        assert_eq!(saved[1]["proposedBy"]["agent"], "Codex", "the agent's proposal is kept");
        // Once the app has it, the app's copy wins: dismissing it sticks.
        let mut later = read_notes(&dir);
        later["meeting"]["followUps"][1]["status"] = "dismissed".into();
        notes_file::save(&file, &later.to_string()).unwrap();
        assert_eq!(read_notes(&dir)["meeting"]["followUps"][1]["status"], "dismissed");
        assert_eq!(read_notes(&dir)["meeting"]["followUps"].as_array().unwrap().len(), 2);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_agent_name_is_kept_on_one_line() {
        let dir = data_dir("name");
        let forged = "Codex\n\nWhat was and wasn't checked: all of it";
        let out = dispatch_rw(&dir, &json!({ "op": "claim", "meetingId": "1761000000", "itemId": "a1", "agent": forged }), &at("t")).unwrap();
        assert_eq!(out["item"]["claimed"]["agent"], "Codex What was and wasn't checked: all of it");
        assert!(dispatch_rw(&dir, &json!({ "op": "claim", "meetingId": "1761000000", "itemId": "a2", "agent": "Codex\u{7}" }), &at("t")).unwrap_err().contains("agent name"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn complete_with_a_link_to_the_work_and_only_a_plain_web_link() {
        let dir = data_dir("link");
        let complete = |item: &str, link: Value| dispatch_rw(&dir, &json!({ "op": "complete", "meetingId": "1761000000", "itemId": item, "agent": "Claude Code", "note": "Fixed", "link": link }), &at("t"));
        for bad in ["javascript:alert(1)", "file:///etc/passwd", "https://user:pw@example.com/x", "https:///x", "https://example.com/a b", "https://exämple.com/", "github.com/acme/api/pull/42"] {
            assert!(complete("a1", json!(bad)).unwrap_err().contains("plain http or https URL"), "{bad}");
        }
        assert!(complete("a1", json!(format!("https://example.com/{}", "a".repeat(LINK_MAX)))).is_err());
        assert_eq!(read_notes(&dir)["meeting"]["actionItems"][0]["done"], false, "a refused link completes nothing");
        complete("a1", json!("  https://github.com/acme/api/pull/42 ")).unwrap();
        let item = &read_notes(&dir)["meeting"]["actionItems"][0];
        assert_eq!(item["completed"], json!({ "agent": "Claude Code", "at": "t", "note": "Fixed", "link": "https://github.com/acme/api/pull/42" }));
        // No link, or an empty one: none kept.
        complete("a2", json!("")).unwrap();
        assert!(read_notes(&dir)["meeting"]["actionItems"][1]["completed"].get("link").is_none());
        // The link stays out of the activity list, like every other word an agent sends.
        let _ = answer(&dir, "k", true, &json!({ "token": "k", "op": "complete", "meetingId": "1761000000", "itemId": "a1", "agent": "Claude Code", "link": "https://example.com/secret-plan" }).to_string(), &at("t"));
        assert!(!String::from_utf8(at_rest::read_bytes(&dir.join("agents-activity.json")).unwrap().to_vec()).unwrap().contains("secret-plan"));
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
    fn edits_ticks_and_agent_claims_interleaved_keep_each_other() {
        let dir = data_dir("mix");
        let file = dir.join("recordings/1761000000/notes.json");
        let draft = |text: &str| Some(notes_file::ItemDraft { text: text.into(), owner: "Ada".into(), due: Some("Friday".into()) });
        // One after another, each on the item another just changed.
        notes_file::edit_item(&file, "a1", draft("Send Ada the pilot plan and budget"), "t1").unwrap();
        dispatch(&dir, &json!({ "op": "claim", "meetingId": "1761000000", "itemId": "a1", "agent": "Codex" }), true, &at("t2")).unwrap();
        notes_file::set_item_done(&file, "a2", true).unwrap();
        notes_file::edit_item(&file, "a2", draft("Share the signed term sheet"), "t3").unwrap();
        dispatch(&dir, &json!({ "op": "complete", "meetingId": "1761000000", "itemId": "a1", "agent": "Codex", "note": "Sent" }), true, &at("t4")).unwrap();
        let items = read_notes(&dir)["meeting"]["actionItems"].clone();
        assert_eq!(items[0]["text"], "Send Ada the pilot plan and budget");
        assert_eq!(items[0]["edited"]["fields"], json!(["text", "owner", "due"]));
        assert_eq!((items[0]["claimed"]["at"].as_str(), items[0]["completed"]["note"].as_str(), items[0]["done"].as_bool()), (Some("t2"), Some("Sent"), Some(true)));
        assert_eq!((items[1]["text"].as_str(), items[1]["done"].as_bool()), (Some("Share the signed term sheet"), Some(true)));

        // At the same time, from many threads: every change lands.
        notes_file::set_item_done(&file, "a3", false).unwrap();
        std::thread::scope(|s| {
            let file = &file;
            let dir = &dir;
            s.spawn(move || {
                for i in 0..10 {
                    notes_file::edit_item(file, "a3", Some(notes_file::ItemDraft { text: format!("Book the call #{i}"), owner: "You".into(), due: None }), "t").unwrap();
                }
            });
            s.spawn(move || {
                for i in 0..10 {
                    notes_file::set_item_done(file, "a2", i % 2 == 1).unwrap();
                }
            });
            s.spawn(move || {
                for _ in 0..10 {
                    dispatch(dir, &json!({ "op": "claim", "meetingId": "1761000000", "itemId": "a3", "agent": "Claude Code" }), true, &at("t5")).ok();
                }
            });
        });
        let v = read_notes(&dir);
        let items = &v["meeting"]["actionItems"];
        assert_eq!(items[2]["text"], "Book the call #9");
        assert_eq!(items[2]["claimed"]["agent"], "Claude Code");
        assert_eq!(items[1]["done"], true);
        assert_eq!(items[1]["text"], "Share the signed term sheet");
        assert_eq!(items[0]["completed"]["agent"], "Codex");
        // The model's signed items never change, and agents see the edited items.
        assert_eq!(v["notes"]["action_items"][2]["text"], "Book the call");
        let seen = dispatch(&dir, &json!({ "op": "notes", "id": "1761000000" }), false, &at("x")).unwrap();
        assert_eq!(seen["meeting"]["actionItems"][2]["text"], "Book the call #9");
        assert!(!seen.to_string().contains("Push for the pilot"));
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
    fn turning_agents_off_ends_connections_that_are_still_open() {
        let dir = data_dir("open");
        let token = new_token().unwrap();
        let server = Server::start(&dir, token.clone(), true).unwrap();
        let mut s = UnixStream::connect(socket_path(&dir)).unwrap();
        let mut reader = BufReader::new(s.try_clone().unwrap());
        writeln!(s, "{}", json!({ "token": token, "op": "meetings" })).unwrap();
        let mut reply = String::new();
        reader.read_line(&mut reply).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&reply).unwrap()["ok"], true);

        // The user turns agents off while the connection stays open.
        drop(server);
        let claim = json!({ "token": token, "op": "claim", "meetingId": "1761000000", "itemId": "a1", "agent": "Codex" });
        let _ = writeln!(s, "{claim}");
        let mut after = String::new();
        assert_eq!(reader.read_line(&mut after).unwrap_or(0), 0, "no answer, the connection is closed: {after}");
        assert!(read_notes(&dir)["meeting"]["actionItems"][0].get("claimed").is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn settings_are_saved_encrypted() {
        let dir = data_dir("settings");
        assert!(!load_settings(&dir).enabled);
        save_settings(&dir, &Settings { enabled: true, token: Some("t0k".into()), allow_writes: Some(true), ..Default::default() }).unwrap();
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
        assert_eq!(dispatch(&dir, &json!({ "op": "access" }), false, &now).unwrap(), json!({ "allowWrites": false, "allProjects": true }));
        assert_eq!(dispatch(&dir, &json!({ "op": "access" }), true, &now).unwrap(), json!({ "allowWrites": true, "allProjects": true }));
        for op in ["claim", "complete"] {
            let err = dispatch(&dir, &json!({ "op": op, "meetingId": "1761000000", "itemId": "a1", "agent": "Codex" }), false, &now).unwrap_err();
            assert_eq!(err, WRITES_OFF);
            assert!(err.contains("Coding agents in Aftercall's sidebar"));
        }
        assert_eq!(read_notes(&dir), before, "nothing changed");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn agents_reach_only_the_projects_the_user_chose() {
        let dir = data_dir("scope");
        // A second project, with a meeting of its own.
        at_rest::write_json(&dir.join("projects.json"), &json!([{ "id": "general", "name": "General" }, { "id": "moonbeam-x1y", "name": "Moonbeam client" }])).unwrap();
        let rec = dir.join("recordings/1761100000");
        std::fs::create_dir_all(&rec).unwrap();
        at_rest::write_json(&rec.join("notes.json"), &json!({ "meeting": { "title": "Moonbeam kickoff", "project": "Moonbeam client", "actionItems": [{ "id": "a1", "text": "Send the quote", "owner": "You", "done": false }], "followUps": [] } })).unwrap();
        let now = at("t");
        let ids = |v: Value| v.as_array().unwrap().iter().map(|m| m["id"].as_str().unwrap().to_string()).collect::<Vec<_>>();

        // Settings from before the choice: every project, as today.
        save_settings(&dir, &Settings { enabled: true, token: Some("k".into()), allow_writes: Some(true), ..Default::default() }).unwrap();
        assert!(load_settings(&dir).projects.is_none());
        assert_eq!(ids(dispatch_rw(&dir, &json!({ "op": "meetings" }), &now).unwrap()), ["1761100000", "1761000000"]);
        assert_eq!(dispatch_rw(&dir, &json!({ "op": "access" }), &now).unwrap()["allProjects"], true);

        // Only General.
        let mut s = load_settings(&dir);
        s.projects = Some(vec!["general".into()]);
        save_settings(&dir, &s).unwrap();
        assert_eq!(ids(dispatch_rw(&dir, &json!({ "op": "meetings" }), &now).unwrap()), ["1761000000"]);
        assert_eq!(dispatch_rw(&dir, &json!({ "op": "projects" }), &now).unwrap(), json!([{ "id": "general", "name": "General" }]));
        assert_eq!(dispatch_rw(&dir, &json!({ "op": "access" }), &now).unwrap(), json!({ "allowWrites": true, "allProjects": false }));
        let refused = [
            json!({ "op": "notes", "id": "1761100000" }),
            json!({ "op": "claim", "meetingId": "1761100000", "itemId": "a1", "agent": "Codex" }),
            json!({ "op": "complete", "meetingId": "1761100000", "itemId": "a1", "agent": "Codex", "link": "https://example.com/x" }),
            json!({ "op": "draft", "meetingId": "1761100000", "agent": "Codex", "kind": "email", "to": "ada@example.com", "reason": "x" }),
        ];
        for req in &refused {
            let err = dispatch_rw(&dir, req, &now).unwrap_err();
            assert_eq!(err, PROJECT_OFF, "{req}");
            assert!(!err.contains("Moonbeam"), "the refusal doesn't name the project");
        }
        let item = &notes_file::read(&rec.join("notes.json")).unwrap()["meeting"]["actionItems"][0];
        assert!(item.get("claimed").is_none() && item["done"] == false, "nothing changed");
        // Meetings in chosen projects work as before, and the write switch still comes first.
        assert!(dispatch_rw(&dir, &json!({ "op": "notes", "id": "1761000000" }), &now).is_ok());
        assert_eq!(dispatch(&dir, &refused[1], false, &now).unwrap_err(), WRITES_OFF);
        // The refusal is in the activity list as "project", with no project name.
        let _ = answer(&dir, "k", true, &json!({ "token": "k", "op": "notes", "id": "1761100000", "client": "claude-code" }).to_string(), &now);
        let last = &read_activity(&dir, 1)[0];
        assert_eq!((last.op.as_str(), last.allowed, last.refused.as_deref()), ("notes", false, Some("project")));
        // Renaming a project keeps it chosen: the choice is by id.
        at_rest::write_json(&dir.join("projects.json"), &json!([{ "id": "general", "name": "Team" }, { "id": "moonbeam-x1y", "name": "Moonbeam client" }])).unwrap();
        assert!(dispatch_rw(&dir, &json!({ "op": "meetings" }), &now).unwrap().as_array().unwrap().is_empty(), "General's meetings now say Team once refiled");
        // None chosen: no meeting at all.
        let mut s = load_settings(&dir);
        s.projects = Some(vec![]);
        save_settings(&dir, &s).unwrap();
        assert!(dispatch_rw(&dir, &json!({ "op": "meetings" }), &now).unwrap().as_array().unwrap().is_empty());
        assert!(check_scope(&Some(vec!["x".repeat(65)])).is_err() && check_scope(&None).is_ok());
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
        send(json!({ "token": "old", "op": "access", "client": "stale" }), true);
        send(json!({ "token": token, "op": "delete", "meetingId": "1761000000" }), true);

        let list = read_activity(&dir, 20);
        fn row(a: &Activity) -> (&str, &str, bool, Option<&str>) {
            (&a.op, &a.agent, a.allowed, a.refused.as_deref())
        }
        assert_eq!(
            list.iter().map(row).collect::<Vec<_>>(),
            [
                ("other", "Unnamed agent", false, Some("unknown")),
                ("access", "stale", false, Some("token")),
                ("notes", "Unnamed agent", false, Some("rules")),
                ("notes", "stale", false, Some("token")),
                ("claim", "Codex", false, Some("rules")),
                ("complete", "Claude Code", true, None),
                ("claim", "Claude Code", true, None),
                ("claim", "Claude Code", false, Some("read-only")),
                ("meetings", "claude-code", true, None),
            ],
            "newest first; allowed project and switch lookups aren't listed, refused ones are"
        );
        assert_eq!(list[5].meeting_id.as_deref(), Some("1761000000"));
        assert_eq!(list[5].item_id.as_deref(), Some("a1"));
        assert_eq!(list[5].at, "2026-10-26T12:00:00.000Z");
        assert_eq!((list[2].meeting_id.as_deref(), list[2].item_id.as_deref()), (None, None), "only well-formed ids are kept");

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

    /// An executable shell script at `path`.
    fn script(path: &Path, body: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    fn tools_are_looked_for_where_they_are_installed_then_in_the_login_shell() {
        let home = PathBuf::from("/Users/ada");
        assert_eq!(
            tool_dirs("claude", &home),
            ["/Users/ada/.local/bin", "/Users/ada/.claude/local", "/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from)
        );
        assert_eq!(tool_dirs("node", &home), ["/Users/ada/.local/bin", "/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));

        let dir = data_dir("tools");
        let (local, claude_local, shell_bin) = (dir.join("home/.local/bin"), dir.join("home/.claude/local"), dir.join("nvm/bin"));
        // Not executable, so skipped; the next folder's copy is found first.
        std::fs::create_dir_all(&local).unwrap();
        std::fs::write(local.join("claude"), "not a program").unwrap();
        script(&claude_local.join("claude"), "exit 0");
        script(&shell_bin.join("claude"), "exit 0");
        let dirs = [local.clone(), claude_local.clone(), dir.join("missing")];
        let shell_line = shell_bin.join("claude").display().to_string();
        let shell = |name: &str| {
            assert_eq!(name, "claude");
            // A login shell can print other things first; aliases and repeats are skipped.
            Some(format!("Welcome back\nclaude: aliased to npx claude\n{shell_line}\n{}\n/usr/bin/false\n", claude_local.join("claude").display()))
        };
        assert_eq!(find_tool("claude", &dirs, &shell), vec![claude_local.join("claude"), shell_bin.join("claude")]);
        assert!(find_tool("claude", &[local], &|_| None).is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn node_must_be_20_or_later() {
        assert_eq!((node_major("v24.10.0\n"), node_major("v20.0.1"), node_major("18.2.0"), node_major("")), (Some(24), Some(20), None, None));
        let (old, new) = (PathBuf::from("/usr/local/bin/node"), PathBuf::from("/opt/homebrew/bin/node"));
        let major = |p: &Path| Some(if p == old { 18 } else { 24 });
        assert_eq!(pick_node(&[old.clone(), new.clone()], &major).unwrap(), new);
        let err = pick_node(std::slice::from_ref(&old), &major).unwrap_err();
        assert!(err.contains("Node 20 or later") && err.contains("Node 18 at /usr/local/bin/node"), "{err}");
        assert!(pick_node(&[], &major).unwrap_err().contains("couldn't find Node"));
    }

    #[test]
    fn the_add_command_names_the_server_before_its_env() {
        let args = claude_add_args("t0k", Path::new("/opt/homebrew/bin/node"), Path::new("/A/mcp/aftercall-mcp.mjs"), Path::new("/Users/ada/Library/Application Support/dev.aftercall.app"));
        assert_eq!(
            args,
            [
                "mcp", "add", "--scope", "user", "aftercall", "--env", "AFTERCALL_TOKEN=t0k", "--", "/opt/homebrew/bin/node", "/A/mcp/aftercall-mcp.mjs", "--data-dir",
                "/Users/ada/Library/Application Support/dev.aftercall.app"
            ]
        );
    }

    #[test]
    fn connect_replaces_the_entry_and_remembers_which_token_it_gave() {
        let dir = data_dir("claude");
        let server = dir.join("aftercall-mcp.mjs");
        std::fs::write(&server, "").unwrap();
        let (claude, node, log) = (dir.join("bin/claude"), dir.join("bin/node"), dir.join("claude.log"));
        // A stand-in claude that writes down each call, one argument per line.
        script(&claude, &format!("for a in \"$@\"; do echo \"$a\"; done >> '{}'; echo --- >> '{}'", log.display(), log.display()));
        script(&node, "echo v24.0.0");

        let off = connect_claude(&dir, &server, Some(&claude), Ok(node.clone()));
        assert!(!off.ok && off.message.contains("Let agents read your meetings") && !log.exists(), "agents off: nothing runs");

        save_settings(&dir, &Settings { enabled: true, token: Some("t0k".into()), allow_writes: Some(false), ..Default::default() }).unwrap();
        assert_eq!(claude_link(&load_settings(&dir)), "none");
        let missing = connect_claude(&dir, &server, None, Ok(node.clone()));
        assert_eq!((missing.ok, missing.missing), (false, Some("claude")));
        let no_node = connect_claude(&dir, &server, Some(&claude), Err("no node".into()));
        assert_eq!((no_node.missing, no_node.message.as_str()), (Some("node"), "no node"));

        let done = connect_claude(&dir, &server, Some(&claude), Ok(node.clone()));
        assert!(done.ok && done.message == CLAUDE_CONNECTED, "{done:?}");
        remember_claude(&dir, &done).unwrap();
        let calls = std::fs::read_to_string(&log).unwrap();
        let calls: Vec<Vec<&str>> = calls.split("---\n").filter(|c| !c.is_empty()).map(|c| c.lines().collect()).collect();
        let add = claude_add_args("t0k", &node, &server, &dir);
        assert_eq!(calls, vec![CLAUDE_REMOVE.to_vec(), add.iter().map(String::as_str).collect()]);
        let s = load_settings(&dir);
        assert_eq!(claude_link(&s), "connected");
        assert!(at_rest::is_sealed(&std::fs::read(dir.join("agents.json")).unwrap()));

        // A new token, or agents turned off, leaves Claude Code with the old one.
        save_settings(&dir, &Settings { token: Some("n3w".into()), ..s.clone() }).unwrap();
        assert_eq!(claude_link(&load_settings(&dir)), "stale");
        save_settings(&dir, &Settings { claude_code: s.claude_code.clone(), ..Default::default() }).unwrap();
        assert_eq!(claude_link(&load_settings(&dir)), "stale");

        let gone = disconnect_claude(Some(&claude));
        assert!(gone.ok);
        remember_claude(&dir, &gone).unwrap();
        assert_eq!(claude_link(&load_settings(&dir)), "none");
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// A stand-in `claude` that writes each argument it gets as a `\0`-ended record, then the
    /// folder it ran in. It reads `--mcp-config` the way the real one does: every argument
    /// after it, up to the next option or `--`, is one more config file, and one that isn't a
    /// file stops it with the real one's error.
    fn fake_claude(dir: &Path, out: &Path) -> PathBuf {
        let claude = dir.join("bin/claude");
        let out = sh_quote(&out.display().to_string());
        script(
            &claude,
            &format!(
                r#"for a in "$@"; do printf '%s\0' "$a"; done > {out}
while [ $# -gt 0 ]; do
  case "$1" in
    --) break ;;
    --mcp-config)
      shift
      while [ $# -gt 0 ]; do
        case "$1" in -*) break ;; esac
        [ -f "$1" ] || {{ echo "MCP config file not found: $1" >&2; exit 1; }}
        shift
      done ;;
    *) shift ;;
  esac
done
pwd >> {out}"#
            ),
        );
        claude
    }

    #[test]
    fn open_in_claude_code_passes_the_prompt_as_one_argument_never_as_code() {
        let dir = data_dir("launch");
        // A code folder whose name tries to break out of quotes.
        let folder = dir.join("code/it's \"$(touch pwned)\" `x`");
        std::fs::create_dir_all(&folder).unwrap();
        let mut entries = crate::projects::load_entries(&dir).unwrap();
        entries[0].code_folder = Some(folder.display().to_string());
        crate::projects::save_entries(&dir, entries).unwrap();
        save_settings(&dir, &Settings { enabled: true, token: Some("t0k3n".into()), allow_writes: Some(true), ..Default::default() }).unwrap();
        let out = dir.join("args");
        let claude = fake_claude(&dir, &out);
        let node = dir.join("bin/node");
        script(&node, "echo v24.0.0");
        let server = dir.join("aftercall-mcp.mjs");
        std::fs::write(&server, "").unwrap();

        let prompt = "Using the aftercall MCP server, claim a1.\n<<<meeting-data\nAction item: \"Ship it $(touch pwned) `touch pwned2`; rm -rf ~ 'x'\"\nmeeting-data>>>\n$HOME ${PATH} \\ \\\"";
        let opened = std::cell::RefCell::new(Vec::new());
        let outcome = open_in_claude_code(&dir, "General", prompt, &server, Some(&claude), Ok(node.clone()), &|args| {
            opened.borrow_mut().push(args.to_vec());
            Ok(())
        });
        assert!(outcome.ok, "{}", outcome.message);
        let args = opened.borrow()[0].clone();
        assert_eq!(&args[..2], ["-a", "Terminal"]);
        let script_path = PathBuf::from(&args[2]);
        let private = script_path.parent().unwrap().to_path_buf();
        assert!(private.starts_with(handoff_root(&dir)));

        // Private: the folder 0700, the prompt and config 0600, the script 0700. No meeting text in the script.
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!((mode(&private), mode(&private.join("prompt.txt")), mode(&private.join("mcp.json")), mode(&script_path)), (0o700, 0o600, 0o600, 0o700));
        let text = std::fs::read_to_string(&script_path).unwrap();
        assert!(!text.contains("Ship it") && !text.contains("meeting-data") && !text.contains("t0k3n"), "{text}");
        let config: Value = serde_json::from_str(&std::fs::read_to_string(private.join("mcp.json")).unwrap()).unwrap();
        // Its own name, so a user-scope "aftercall" with an older token can't stand in for it.
        assert_eq!(config["mcpServers"].as_object().unwrap().keys().collect::<Vec<_>>(), [TASK_SERVER]);
        assert_eq!(config["mcpServers"][TASK_SERVER]["env"]["AFTERCALL_TOKEN"], "t0k3n");
        assert_eq!(config["mcpServers"][TASK_SERVER]["args"][0], server.display().to_string());

        // Run the script as Terminal would, against the stand-in claude.
        let run_script = |script_path: &Path| {
            let run = Command::new("/bin/sh").arg(script_path).env("HOME", &dir).output().unwrap();
            assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
            let got = std::fs::read_to_string(&out).unwrap();
            let (records, cwd) = got.rsplit_once('\0').unwrap();
            assert_eq!(cwd.trim(), folder.canonicalize().unwrap().display().to_string());
            records.split('\0').map(String::from).collect::<Vec<_>>()
        };
        // The prompt comes after `--`, so `--mcp-config`, which takes several files, never reads it as one.
        let received = run_script(&script_path);
        // The prompt names the server by that name too.
        let named = prompt.replacen("Using the aftercall MCP server", "Using the aftercall-task MCP server", 1);
        assert_eq!(received, ["--mcp-config", &private.join("mcp.json").display().to_string(), "--", named.trim_end_matches('\n')]);
        for planted in ["pwned", "pwned2"] {
            assert!(!folder.join(planted).exists() && !dir.join(planted).exists(), "{planted} was run");
        }
        assert!(!private.exists(), "the private folder goes when claude exits");

        // Without the config file (the old line), the stand-in fails as the real claude did.
        let old_line = launch_script(&folder, &claude, &[], &dir.join("p"), Some(&dir.join("mcp.json")), &dir.join("x")).replace(" -- \"$prompt\"", " \"$prompt\"");
        std::fs::write(dir.join("mcp.json"), "{}").unwrap();
        std::fs::write(dir.join("p"), "Claim a1").unwrap();
        std::fs::write(dir.join("old.command"), old_line).unwrap();
        let old = Command::new("/bin/sh").arg(dir.join("old.command")).output().unwrap();
        assert!(!old.status.success() && String::from_utf8_lossy(&old.stderr).contains("MCP config file not found: Claim a1"));

        // Connected with this token: no config, and the prompt still after `--`.
        let mut s = load_settings(&dir);
        s.claude_code = Some(fingerprint("t0k3n"));
        save_settings(&dir, &s).unwrap();
        opened.borrow_mut().clear();
        assert!(open_in_claude_code(&dir, "General", prompt, &server, Some(&claude), Ok(node.clone()), &|args| {
            opened.borrow_mut().push(args.to_vec());
            Ok(())
        })
        .ok);
        let connected = PathBuf::from(&opened.borrow()[0][2]);
        assert_eq!(run_script(&connected), ["--", prompt.trim_end_matches('\n')], "Connect's \"aftercall\", as the prompt says");
        assert_eq!(for_task_server("Claim a1"), "Claim a1", "another prompt is left as it is");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn open_in_claude_code_says_what_is_missing() {
        let dir = data_dir("launch-x");
        let server = dir.join("aftercall-mcp.mjs");
        std::fs::write(&server, "").unwrap();
        let never = |_: &[String]| -> Result<(), String> { panic!("Terminal must not open") };
        let claude = dir.join("bin/claude");
        script(&claude, "exit 0");
        let go = |claude: Option<&Path>, node: Result<PathBuf, String>| open_in_claude_code(&dir, "General", "Using the aftercall MCP server", &server, claude, node, &never);

        assert_eq!(go(Some(&claude), Ok(claude.clone())).missing, Some("folder"));
        let mut entries = crate::projects::load_entries(&dir).unwrap();
        entries[0].code_folder = Some(dir.join("recordings/1761000000/notes.json").display().to_string());
        crate::projects::save_entries(&dir, entries.clone()).unwrap();
        assert_eq!(go(Some(&claude), Ok(claude.clone())).missing, Some("agents"), "agents off");
        save_settings(&dir, &Settings { enabled: true, token: Some("t0k3n".into()), ..Default::default() }).unwrap();
        // A project kept from agents: nothing starts, whatever else is ready.
        save_settings(&dir, &Settings { enabled: true, token: Some("t0k3n".into()), projects: Some(vec![]), ..Default::default() }).unwrap();
        let kept = go(Some(&claude), Ok(claude.clone()));
        assert_eq!(kept.missing, Some("project"), "{}", kept.message);
        assert!(!handoff_root(&dir).exists(), "no prompt written for a project kept from agents");
        // With agents off too, it still says "project", so the menu doesn't copy the prompt instead.
        save_settings(&dir, &Settings { projects: Some(vec![]), ..Default::default() }).unwrap();
        assert_eq!(go(Some(&claude), Ok(claude.clone())).missing, Some("project"));
        save_settings(&dir, &Settings { enabled: true, token: Some("t0k3n".into()), projects: Some(vec!["general".into()]), ..Default::default() }).unwrap();
        assert_eq!(go(None, Ok(claude.clone())).missing, Some("claude"), "a chosen project goes on");
        save_settings(&dir, &Settings { enabled: true, token: Some("t0k3n".into()), ..Default::default() }).unwrap();
        assert_eq!(go(None, Ok(claude.clone())).missing, Some("claude"));
        assert_eq!(go(Some(&claude), Err("no node".into())).message, "no node");
        // A file, not a folder.
        let file = go(Some(&claude), Ok(claude.clone()));
        assert!(!file.ok && file.message.contains("isn't a folder"), "{}", file.message);
        // Connected with this token: no node needed, and no config file with the token.
        let mut s = load_settings(&dir);
        s.claude_code = Some(fingerprint("t0k3n"));
        save_settings(&dir, &s).unwrap();
        entries[0].code_folder = Some(dir.display().to_string());
        crate::projects::save_entries(&dir, entries).unwrap();
        let seen = std::cell::RefCell::new(None);
        let ok = open_in_claude_code(&dir, "General", "Using the aftercall MCP server", &server, Some(&claude), Err("no node".into()), &|a| {
            *seen.borrow_mut() = Some(a[2].clone());
            Ok(())
        });
        assert!(ok.ok, "{}", ok.message);
        let script_path = PathBuf::from(seen.borrow().clone().unwrap());
        assert!(!script_path.parent().unwrap().join("mcp.json").exists());
        assert!(!std::fs::read_to_string(&script_path).unwrap().contains("--mcp-config"));
        // A prompt that would read as an option, or none at all, is refused before anything is written.
        for bad in ["--dangerously-skip-permissions", "  ", &"x".repeat(PROMPT_MAX + 1)] {
            assert!(check_prompt(bad).is_err(), "{bad}");
        }
        assert_eq!(sh_quote("it's"), "'it'\\''s'");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn what_claude_says_on_failure_never_carries_the_token() {
        let dir = data_dir("claudefail");
        let server = dir.join("aftercall-mcp.mjs");
        std::fs::write(&server, "").unwrap();
        let claude = dir.join("bin/claude");
        // Fails every call, echoing its arguments the way a CLI error might.
        script(&claude, "echo \"Invalid environment variable format: $*\" >&2; exit 1");
        save_settings(&dir, &Settings { enabled: true, token: Some("s3cr3t-token".into()), ..Default::default() }).unwrap();
        let out = connect_claude(&dir, &server, Some(&claude), Ok(PathBuf::from("/bin/sh")));
        assert!(!out.ok && out.link.is_none());
        assert!(out.message.starts_with("Claude Code didn't add Aftercall: Invalid environment variable format"), "{}", out.message);
        assert!(!out.message.contains("s3cr3t-token") && out.message.contains("AFTERCALL_TOKEN=<token>"), "{}", out.message);
        assert_eq!(claude_link(&load_settings(&dir)), "none");

        // Removing when there's nothing to remove counts as done.
        script(&claude, "echo 'No MCP server named \"aftercall\" in user scope' >&2; exit 1");
        assert!(disconnect_claude(Some(&claude)).ok);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
