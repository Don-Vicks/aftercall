mod agents;
mod at_rest;
mod attest;
mod calendar;
mod capture;
mod github;
mod live_window;
mod near;
mod nearai;
mod notes_file;
mod phone;
mod projects;
mod recorder;
mod recovery;
mod recovery_kit;
mod samples;
mod wipe;
mod your_notes;

/// The NEAR AI transport, exposed for the integration tests in tests/.
#[doc(hidden)]
pub mod test_api {
    pub use crate::attest::{QuoteReport, decode_hex, nvidia_keys, verify_quote, verify_quote_with};
    pub use crate::nearai::{E2ee, StreamProgress, TLS_PIN_MISMATCH, chat, chat_stream_with, check_key, spki_sha256, transcribe, transcribe_with_roots};
}

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use recorder::{Events, Levels, QuietEvent, Recording, RecordingInfo, RecordingResult, SilenceEvent};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// The recording in progress: the recorder, what it was started for, and its clock.
struct Live {
    recording: Recording,
    meta: MeetingMeta,
    info: RecordingInfo,
    clock: Arc<Clock>,
}

/// Seconds recorded and whether it's paused, shared with the recorder's event sink.
#[derive(Default)]
struct Clock {
    seconds: AtomicU64,
    paused: AtomicBool,
}

#[derive(Default)]
struct RecorderState(Mutex<Option<Live>>);

/// What the interface needs to show a recording in progress, or to pick it up
/// again after a reload (`recorder_status`, and the `recorder:state` event).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RecorderStatus {
    id: String,
    project: String,
    /// Unix seconds.
    started_at: u64,
    /// Seconds recorded, not counting pauses.
    seconds: u64,
    paused: bool,
    microphone: String,
    system_audio: bool,
    /// What you've typed so far (your-notes.json), if anything.
    your_notes: Option<String>,
}

impl Live {
    fn status(&self) -> RecorderStatus {
        RecorderStatus {
            id: self.meta.id.clone(),
            project: self.meta.project.clone(),
            started_at: self.meta.started_at,
            seconds: self.clock.seconds.load(Ordering::Relaxed),
            paused: self.clock.paused.load(Ordering::Relaxed),
            microphone: self.info.microphone.clone(),
            system_audio: self.info.system_audio,
            your_notes: your_notes::read(&PathBuf::from(&self.meta.dir)),
        }
    }
}

/// Saved next to the audio as `meeting.json` so recordings survive a restart.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MeetingMeta {
    id: String,
    project: String,
    /// Unix seconds.
    started_at: u64,
    seconds: u64,
    chunks: usize,
    dir: String,
    /// Notes saved after processing (`notes.json`), as the JSON the interface wrote.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
    /// "Sample" for the built-in fictional recordings (samples.rs); absent for real ones.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    label: Option<String>,
    /// A name for recordings that come with one (samples); real ones are named from the calendar.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    /// What you typed during the call (`your-notes.json`). Read from its own file for the
    /// interface; never written into meeting.json.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    your_notes: Option<String>,
    /// That you told everyone before recording, as you logged it on the record sheet.
    /// Kept here so notes made after a restart still put it in the proof.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    notice: Option<NoticeLog>,
}

/// The record sheet's consent tick: your own statement, with when you ticked it and,
/// if you said, how you told them. Mirrors NoticeLog in packages/core/src/meeting.ts.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct NoticeLog {
    by: NoticeBy,
    /// ISO time the box was ticked.
    at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    how: Option<NoticeHow>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
enum NoticeBy {
    You,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
enum NoticeHow {
    Aloud,
    Chat,
    Invite,
    Email,
}

impl NoticeLog {
    /// An ISO time is under 40 characters; anything longer isn't one.
    fn check(self) -> Result<Self, String> {
        if self.at.is_empty() || self.at.len() > 40 {
            return Err("Bad notice time".into());
        }
        Ok(self)
    }
}

fn recordings_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("recordings"))
}

fn now_secs() -> Result<u64, String> {
    Ok(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs())
}

/// Forwards recorder updates to the interface as Tauri events, and keeps the
/// menu bar clock in step (once a second, not on every 50 ms level update).
struct AppEvents {
    app: AppHandle,
    clock: Arc<Clock>,
}

impl Events for AppEvents {
    fn levels(&self, levels: Levels) {
        let before = self.clock.seconds.swap(levels.seconds, Ordering::Relaxed);
        if before != levels.seconds {
            // Queued, not called: tray calls wait for the main thread, which may itself be
            // waiting for this thread to stop (finish_recording). Queuing can't deadlock.
            let (app, seconds, paused) = (self.app.clone(), levels.seconds, self.clock.paused.load(Ordering::Relaxed));
            let _ = self.app.run_on_main_thread(move || {
                if app.state::<RecorderState>().0.lock().is_ok_and(|s| s.is_some()) {
                    set_tray_clock(&app, seconds, paused);
                }
            });
        }
        let _ = self.app.emit("recorder:levels", levels);
    }
    fn silence(&self, event: SilenceEvent) {
        let _ = self.app.emit("recorder:silence", event);
    }
    fn quiet(&self, event: QuietEvent) {
        let _ = self.app.emit("recorder:quiet", event);
    }
}

/// "12:34", or "1:02:03" past an hour.
fn clock_text(seconds: u64) -> String {
    let (h, m, s) = (seconds / 3600, seconds / 60 % 60, seconds % 60);
    if h > 0 { format!("{h}:{m:02}:{s:02}") } else { format!("{m:02}:{s:02}") }
}

/// The menu bar title while recording: "● 12:34", or "Paused 12:34".
fn tray_title(seconds: u64, paused: bool) -> String {
    if paused { format!("Paused {}", clock_text(seconds)) } else { format!("● {}", clock_text(seconds)) }
}

fn set_tray_clock(app: &AppHandle, seconds: u64, paused: bool) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_title(Some(tray_title(seconds, paused)));
    }
}

/// The menu bar item for idle (`None`) or a recording (`Some(paused)`): its title, tooltip and menu.
fn set_tray_recording(app: &AppHandle, recording: Option<(u64, bool)>) {
    // ⌘⇧M is Aftercall's only while there's a moment to mark.
    apply_mark_shortcut(app, recording.is_some());
    let Some(tray) = app.tray_by_id("main") else { return };
    match recording {
        Some((seconds, paused)) => {
            let _ = tray.set_title(Some(tray_title(seconds, paused)));
            let _ = tray.set_tooltip(Some(if paused { "Aftercall · paused" } else { "Aftercall · recording" }));
        }
        None => {
            let _ = tray.set_title(Some(""));
            let _ = tray.set_tooltip(Some("Aftercall"));
        }
    }
    if let Ok(menu) = tray_menu(app, recording.map(|(_, paused)| paused)) {
        let _ = tray.set_menu(Some(menu));
    }
}

/// ⌘⇧R: new recording, or your notes while recording. Registered system-wide unless you
/// turned that off in Settings, so it works from the call's own app; the menu bar items
/// show it too.
const RECORD_SHORTCUT: &str = "CmdOrCtrl+Shift+R";

/// ⌘⇧M: mark this moment in your notes. Held system-wide only while a recording runs
/// (and only when ⌘⇧R is allowed from any app), so other apps keep it the rest of the time.
const MARK_SHORTCUT: &str = "CmdOrCtrl+Shift+M";

/// Two triggers closer than this are one press.
const PRESS_GAP: Duration = Duration::from_millis(400);

/// One press, one action. With the menu bar menu open, ⌘⇧R can reach both the global
/// shortcut and the menu item that shows it; whichever comes second is dropped.
#[derive(Default)]
struct PressGate(Mutex<Option<Instant>>);

/// ⌘⇧M's own gate, so a mark right after ⌘⇧R isn't dropped as the same press.
#[derive(Default)]
struct MarkGate(PressGate);

impl PressGate {
    fn accept(&self, now: Instant) -> bool {
        let mut last = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if last.is_some_and(|t| now.saturating_duration_since(t) < PRESS_GAP) {
            return false;
        }
        *last = Some(now);
        true
    }
}

/// ⌘⇧R as applied now: what you chose in Settings (`wanted`), and whether Aftercall holds
/// it system-wide (`registered`; false when you turned it off or another app already
/// had it, and then it works only inside Aftercall's window, which the copy says).
/// Kept in memory so Settings shows what is in force, not what a file says later.
#[derive(Default)]
struct RecordShortcut {
    wanted: AtomicBool,
    registered: AtomicBool,
}

/// True when ⌘⇧R works from any app; false when it works only inside Aftercall.
#[tauri::command]
fn record_shortcut_everywhere(state: State<RecordShortcut>) -> bool {
    state.registered.load(Ordering::Relaxed)
}

/// Your choice in Settings: ⌘⇧R from any app (the default), or only inside Aftercall,
/// so other apps keep it (Safari's Reader, for example). Saved as plain `shortcut.json`,
/// like near.json: it holds no secret, so launch never waits on the Keychain for it and a
/// failed Keychain read can't turn an "off" back on.
#[derive(Serialize, Deserialize)]
struct ShortcutPrefs {
    everywhere: bool,
}

impl Default for ShortcutPrefs {
    fn default() -> Self {
        Self { everywhere: true }
    }
}

fn shortcut_prefs_path(dir: &std::path::Path) -> PathBuf {
    dir.join("shortcut.json")
}

fn load_shortcut_prefs(dir: &std::path::Path) -> ShortcutPrefs {
    std::fs::read_to_string(shortcut_prefs_path(dir)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save_shortcut_prefs(dir: &std::path::Path, prefs: &ShortcutPrefs) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    std::fs::write(shortcut_prefs_path(dir), serde_json::to_string(prefs).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutStatus {
    /// Your choice in Settings.
    wanted: bool,
    /// Whether Aftercall holds ⌘⇧R system-wide now: false when you turned it off or
    /// another app already had it.
    registered: bool,
}

#[tauri::command]
fn record_shortcut_status(state: State<RecordShortcut>) -> ShortcutStatus {
    shortcut_status(&state)
}

fn shortcut_status(state: &RecordShortcut) -> ShortcutStatus {
    ShortcutStatus { wanted: state.wanted.load(Ordering::Relaxed), registered: state.registered.load(Ordering::Relaxed) }
}

/// Settings → Shortcut: saves the choice and takes or releases ⌘⇧R at once.
#[tauri::command]
fn set_record_shortcut_everywhere(on: bool, app: AppHandle, state: State<RecordShortcut>) -> Result<ShortcutStatus, String> {
    save_shortcut_prefs(&data_dir(&app)?, &ShortcutPrefs { everywhere: on })?;
    apply_record_shortcut(&app, on);
    Ok(shortcut_status(&state))
}

/// Takes ⌘⇧R system-wide, or gives it back, and records whether Aftercall holds it.
/// A clash with another app is logged, not fatal: ⌘⇧R then works only inside Aftercall.
fn apply_record_shortcut(app: &AppHandle, on: bool) {
    let shortcuts = app.global_shortcut();
    if on && !shortcuts.is_registered(RECORD_SHORTCUT) {
        if let Err(e) = shortcuts.register(RECORD_SHORTCUT) {
            eprintln!("shortcut: ⌘⇧R works only inside Aftercall: {e}");
        }
    } else if !on && shortcuts.is_registered(RECORD_SHORTCUT) {
        if let Err(e) = shortcuts.unregister(RECORD_SHORTCUT) {
            eprintln!("shortcut: couldn't give ⌘⇧R back: {e}");
        }
    }
    let state = app.state::<RecordShortcut>();
    state.wanted.store(on, Ordering::Relaxed);
    state.registered.store(shortcuts.is_registered(RECORD_SHORTCUT), Ordering::Relaxed);
    let recording = app.state::<RecorderState>().0.lock().map(|s| s.is_some()).unwrap_or(false);
    apply_mark_shortcut(app, recording);
}

/// Takes ⌘⇧M system-wide while a recording runs and you allow shortcuts from any app;
/// gives it back otherwise. A clash is logged: ⌘⇧M then works only inside Aftercall.
fn apply_mark_shortcut(app: &AppHandle, recording: bool) {
    let shortcuts = app.global_shortcut();
    let want = recording && app.state::<RecordShortcut>().wanted.load(Ordering::Relaxed);
    let held = shortcuts.is_registered(MARK_SHORTCUT);
    if want && !held {
        if let Err(e) = shortcuts.register(MARK_SHORTCUT) {
            eprintln!("shortcut: ⌘⇧M works only inside Aftercall: {e}");
        }
    } else if !want && held && let Err(e) = shortcuts.unregister(MARK_SHORTCUT) {
        eprintln!("shortcut: couldn't give ⌘⇧M back: {e}");
    }
}

/// Which of Aftercall's global shortcuts was pressed.
fn is_mark_shortcut(shortcut: &Shortcut) -> bool {
    MARK_SHORTCUT.parse::<Shortcut>().is_ok_and(|mark| mark.id() == shortcut.id())
}

/// ⌘⇧M pressed in any app while recording. The main window types the time into your
/// notes; Aftercall stays in the background, so marking never takes you out of the call.
fn mark_shortcut(app: &AppHandle) {
    if !app.state::<MarkGate>().0.accept(Instant::now()) {
        return;
    }
    let _ = app.emit_to("main", "shortcut:mark", ());
}

/// ⌘⇧R pressed in any app. Aftercall comes to the front and the main window does what
/// ⌘⇧R does inside it: idle, the record sheet opens (and with the sheet open and the
/// box ticked, recording starts); recording, your notes open. The window decides
/// because only it knows whether the sheet is open.
fn record_shortcut(app: &AppHandle) {
    if !app.state::<PressGate>().accept(Instant::now()) {
        return;
    }
    show_main(app);
    let _ = app.emit_to("main", "shortcut:record", ());
}

/// Idle: New recording, Open, Quit. Recording: Add a note, Pause or Resume, Stop, Open, Quit.
fn tray_menu(app: &AppHandle, recording: Option<bool>) -> tauri::Result<Menu<tauri::Wry>> {
    let open = MenuItem::with_id(app, "open", "Open Aftercall", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Aftercall", true, Some("CmdOrCtrl+Q"))?;
    let separator = PredefinedMenuItem::separator(app)?;
    match recording {
        None => {
            let record = MenuItem::with_id(app, "record", "New recording…", true, Some(RECORD_SHORTCUT))?;
            Menu::with_items(app, &[&record, &open, &separator, &quit])
        }
        Some(paused) => {
            let note = MenuItem::with_id(app, "note", "Add a note…", true, Some(RECORD_SHORTCUT))?;
            let pause = MenuItem::with_id(app, "pause", if paused { "Resume" } else { "Pause" }, true, None::<&str>)?;
            let stop = MenuItem::with_id(app, "stop", "Stop and make notes", true, None::<&str>)?;
            let separator2 = PredefinedMenuItem::separator(app)?;
            Menu::with_items(app, &[&note, &pause, &stop, &separator, &open, &separator2, &quit])
        }
    }
}

/// Tells every window what the recorder is doing (null when idle).
fn emit_state(app: &AppHandle, status: Option<RecorderStatus>) {
    let _ = app.emit("recorder:state", status);
}

#[tauri::command]
fn start_recording(project: String, notice: Option<NoticeLog>, app: AppHandle, state: State<RecorderState>) -> Result<RecorderStatus, String> {
    let notice = notice.map(NoticeLog::check).transpose()?;
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        return Err("Already recording".into());
    }
    let stamp = now_secs()?;
    let dir = recordings_dir(&app)?.join(stamp.to_string());
    let meta = MeetingMeta {
        id: stamp.to_string(),
        project,
        started_at: stamp,
        seconds: 0,
        chunks: 0,
        dir: dir.display().to_string(),
        notes: None,
        label: None,
        title: None,
        your_notes: None,
        notice,
    };
    let key = at_rest::data_key()?;
    let clock = Arc::new(Clock::default());
    let (recording, info) = Recording::start(dir, key, AppEvents { app: app.clone(), clock: clock.clone() }).map_err(|e| format!("{e:#}"))?;
    let live = Live { recording, meta, info, clock };
    let status = live.status();
    *slot = Some(live);
    drop(slot);
    set_tray_recording(&app, Some((0, false)));
    emit_state(&app, Some(status.clone()));
    Ok(status)
}

/// The recording in progress, or null. The interface calls this on load, so a
/// reload (or the floating window) picks the recording up where it is.
#[tauri::command]
fn recorder_status(state: State<RecorderState>) -> Result<Option<RecorderStatus>, String> {
    Ok(state.0.lock().map_err(|e| e.to_string())?.as_ref().map(Live::status))
}

fn set_paused(app: &AppHandle, paused: bool) -> Result<(), String> {
    let state = app.state::<RecorderState>();
    let status = {
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        let live = slot.as_ref().ok_or("Not recording")?;
        live.recording.pause(paused);
        live.clock.paused.store(paused, Ordering::Relaxed);
        live.status()
    };
    set_tray_recording(app, Some((status.seconds, paused)));
    emit_state(app, Some(status));
    Ok(())
}

/// Stops the recording in progress and saves meeting.json. Every way of stopping
/// comes here: the Stop buttons, the menu bar, and quitting the app.
fn finish_recording(app: &AppHandle) -> Result<MeetingMeta, String> {
    let state = app.state::<RecorderState>();
    let live = state.0.lock().map_err(|e| e.to_string())?.take().ok_or("Not recording")?;
    set_tray_recording(app, None);
    live_window::hide(app);
    emit_state(app, None);
    let Live { recording, mut meta, .. } = live;
    let result: RecordingResult = recording.stop().map_err(|e| format!("{e:#}"))?;
    meta.seconds = result.seconds;
    meta.chunks = result.chunks;
    let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    let dir = PathBuf::from(&meta.dir);
    at_rest::write_string(&dir.join("meeting.json"), &json)?;
    meta.your_notes = your_notes::read(&dir);
    let _ = app.emit("recorder:stopped", meta.clone());
    Ok(meta)
}

/// Saves what you've typed into the recording in progress (your-notes.json).
#[tauri::command]
fn save_live_notes(text: String, state: State<RecorderState>) -> Result<(), String> {
    let dir = {
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        PathBuf::from(&slot.as_ref().ok_or("Not recording")?.meta.dir)
    };
    your_notes::save(&dir, &text, now_secs()?)
}

/// Saves your notes for a stopped recording, until its notes are made.
#[tauri::command]
fn save_your_notes(app: AppHandle, id: String, text: String) -> Result<(), String> {
    your_notes::save(&recording_dir(&app, &id)?, &text, now_secs()?)
}

/// Opens System Settings where Aftercall is allowed to hear: Screen & System Audio
/// Recording for the call's audio, or Microphone (`pane` "mic").
#[tauri::command]
fn open_audio_settings(app: AppHandle, pane: Option<String>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let anchor = if pane.as_deref() == Some("mic") { "Privacy_Microphone" } else { "Privacy_ScreenCapture" };
    app.opener()
        .open_url(format!("x-apple.systempreferences:com.apple.preference.security?{anchor}"), None::<&str>)
        .map_err(|e| e.to_string())
}

/// From the floating recorder: bring the main window back, at the recording's page.
#[tauri::command]
fn live_open_notes(app: AppHandle) {
    show_main(&app);
    let _ = app.emit("recorder:open-live", ());
}

/// From the floating recorder after Stop: bring the main window back to show the notes being made.
#[tauri::command]
fn show_main_window(app: AppHandle) {
    show_main(&app);
}

#[tauri::command]
fn pause_recording(paused: bool, app: AppHandle) -> Result<(), String> {
    set_paused(&app, paused)
}

#[tauri::command]
fn stop_recording(app: AppHandle) -> Result<MeetingMeta, String> {
    finish_recording(&app)
}

/// Every saved recording, newest first.
#[tauri::command]
fn list_recordings(app: AppHandle) -> Result<Vec<MeetingMeta>, String> {
    let root = recordings_dir(&app)?;
    let Ok(entries) = std::fs::read_dir(&root) else { return Ok(vec![]) };
    let mut out: Vec<MeetingMeta> = entries
        .flatten()
        .filter_map(|e| {
            let mut meta: MeetingMeta = serde_json::from_str(&at_rest::read_string(&e.path().join("meeting.json")).ok()?).ok()?;
            meta.notes = at_rest::read_string(&e.path().join("notes.json")).ok();
            meta.your_notes = your_notes::read(&e.path());
            Some(meta)
        })
        .collect();
    out.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(out)
}

/// Copies a fictional sample call into the recordings folder as a recording labelled "Sample".
#[tauri::command]
fn open_sample(app: AppHandle, sample: String, project: String) -> Result<MeetingMeta, String> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs();
    let dir = samples::install(&recordings_dir(&app)?, &sample, &project, now)?;
    serde_json::from_str(&at_rest::read_string(&dir.join("meeting.json"))?).map_err(|e| e.to_string())
}

/// The folder of one recording, refusing ids that could point elsewhere.
fn recording_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return Err("Bad recording id".into());
    }
    Ok(recordings_dir(app)?.join(id))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Chunk {
    path: String,
    speaker: &'static str,
    index: usize,
}

/// The audio files of a recording: mic-NNN.wav is You, system-NNN.wav is Others.
#[tauri::command]
fn list_chunks(app: AppHandle, id: String) -> Result<Vec<Chunk>, String> {
    let dir = recording_dir(&app, &id)?;
    let mut chunks: Vec<Chunk> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            let (stem, rest) = name.strip_suffix(".wav")?.split_once('-')?;
            let speaker = match stem { "mic" => "you", "system" => "others", _ => return None };
            Some(Chunk { path: e.path().display().to_string(), speaker, index: rest.parse().ok()? })
        })
        .collect();
    chunks.sort_by(|a, b| a.index.cmp(&b.index).then(a.speaker.cmp(b.speaker)));
    Ok(chunks)
}

/// Saves notes.json, keeping action-item state already on disk (see notes_file.rs).
#[tauri::command]
fn save_notes(app: AppHandle, id: String, notes: String) -> Result<(), String> {
    notes_file::save(&recording_dir(&app, &id)?.join("notes.json"), &notes)
}

/// Ticks or unticks one action item in notes.json; returns the saved notes.
#[tauri::command]
fn set_action_item_done(app: AppHandle, id: String, item_id: String, done: bool) -> Result<String, String> {
    notes_file::set_item_done(&recording_dir(&app, &id)?.join("notes.json"), &item_id, done)
}

/// Changes one action item's text, owner and due date in notes.json, or with
/// `restore` puts back what the model signed; returns the saved notes. The signed
/// notes themselves never change (see notes_file::edit_item).
#[tauri::command]
fn edit_action_item(app: AppHandle, id: String, item_id: String, text: String, owner: String, due: Option<String>, restore: bool) -> Result<String, String> {
    let draft = (!restore).then_some(notes_file::ItemDraft { text, owner, due });
    notes_file::edit_item(&recording_dir(&app, &id)?.join("notes.json"), &item_id, draft, &agents::now_iso())
}

/// The agents socket while Coding agents is on (see agents.rs).
#[derive(Default)]
struct AgentsState(Mutex<Option<agents::Server>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentsInfo {
    /// Where the app keeps meetings; the MCP server finds the socket under it.
    data_dir: String,
    /// The MCP server agents run with `node` (see `mcp_server_path`).
    server_path: String,
    server_found: bool,
    /// Coding agents is on and the socket is open.
    enabled: bool,
    /// Agents may claim and complete action items. Off by default.
    allow_writes: bool,
    /// Agents were on before this switch existed and are read-only now; the screen says so
    /// until the user chooses.
    read_only_since_update: bool,
    /// The token agents must send; only while enabled.
    token: Option<String>,
    /// When that token was made; requests before it were sent with another.
    token_since: Option<String>,
    /// "none", "connected" or "stale": whether "Connect Claude Code" gave Claude Code this token.
    claude_code: &'static str,
    socket_path: String,
    /// The ids of the projects agents may reach; None for every project.
    projects: Option<Vec<String>>,
}

/// Where the bundled MCP server sits among the app's resources (tauri.conf.json).
const MCP_RESOURCE: &str = "mcp/aftercall-mcp.mjs";

/// The MCP server agents run with `node`: one plain-JS file shipped inside the app,
/// built from apps/mcp by `pnpm --filter @aftercall/mcp build`. Debug builds fall back
/// to this checkout's build, then its source (Node 24 runs TypeScript directly).
fn mcp_server_path(app: &AppHandle) -> PathBuf {
    let bundled = app.path().resource_dir().map(|d| d.join(MCP_RESOURCE));
    if let Ok(p) = &bundled
        && p.exists()
    {
        return p.clone();
    }
    #[cfg(debug_assertions)]
    {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../mcp");
        for p in [repo.join("dist/aftercall-mcp.mjs"), repo.join("src/main.ts")] {
            if p.exists() {
                return p.canonicalize().unwrap_or(p);
            }
        }
    }
    bundled.unwrap_or_else(|_| PathBuf::from(MCP_RESOURCE))
}

fn agents_snapshot(app: &AppHandle, state: &AgentsState) -> Result<AgentsInfo, String> {
    let dir = data_dir(app)?;
    let server = mcp_server_path(app);
    let running = state.0.lock().map_err(|e| e.to_string())?.is_some();
    let settings = agents::load_settings(&dir);
    Ok(AgentsInfo {
        socket_path: agents::socket_path(&dir).display().to_string(),
        data_dir: dir.display().to_string(),
        server_found: server.exists(),
        server_path: server.display().to_string(),
        enabled: running,
        allow_writes: running && settings.writes_allowed(),
        read_only_since_update: running && settings.allow_writes.is_none(),
        claude_code: agents::claude_link(&settings),
        token_since: if running { settings.token_since.clone() } else { None },
        projects: settings.projects.clone(),
        token: if running { settings.token } else { None },
    })
}

/// "Agents can reach": every project (None) or the chosen ones, by id. Applies to the next
/// request; kept when agents are turned off and on.
#[tauri::command]
fn agents_set_projects(app: AppHandle, state: State<AgentsState>, projects: Option<Vec<String>>) -> Result<AgentsInfo, String> {
    agents::check_scope(&projects)?;
    let dir = data_dir(&app)?;
    {
        // One settings write at a time with the switches.
        let _held = state.0.lock().map_err(|e| e.to_string())?;
        let mut settings = agents::load_settings(&dir);
        settings.projects = projects;
        agents::save_settings(&dir, &settings)?;
    }
    agents_snapshot(&app, &state)
}

/// What the Coding agents screen needs to show the switch and the exact setup commands.
#[tauri::command]
fn agents_info(app: AppHandle, state: State<AgentsState>) -> Result<AgentsInfo, String> {
    agents_snapshot(&app, &state)
}

/// Opens the socket with the saved token (making one if needed), replacing any running server.
fn agents_start(dir: &std::path::Path, state: &AgentsState, fresh_token: bool) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    slot.take(); // close the old socket first
    let mut settings = agents::load_settings(dir);
    if fresh_token || settings.token.is_none() {
        settings.token = Some(agents::new_token()?);
        settings.token_since = Some(agents::now_iso());
    }
    settings.enabled = true;
    agents::save_settings(dir, &settings)?;
    *slot = Some(agents::Server::start(dir, settings.token.clone().unwrap_or_default(), settings.writes_allowed())?);
    Ok(())
}

/// Turns Coding agents on or off. Off closes the socket, forgets the token and puts
/// agents back to read-only; on starts read-only unless the user allowed writes since.
#[tauri::command]
fn agents_set_enabled(app: AppHandle, state: State<AgentsState>, enabled: bool) -> Result<AgentsInfo, String> {
    let dir = data_dir(&app)?;
    if enabled {
        let mut settings = agents::load_settings(&dir);
        if settings.allow_writes.is_none() {
            settings.allow_writes = Some(false);
            agents::save_settings(&dir, &settings)?;
        }
        agents_start(&dir, &state, false)?;
    } else {
        state.0.lock().map_err(|e| e.to_string())?.take();
        // Claude Code keeps the old token, so the screen asks to reconnect next time. The
        // projects agents may reach stay as chosen: turning agents on again doesn't widen them.
        let old = agents::load_settings(&dir);
        agents::save_settings(&dir, &agents::Settings { allow_writes: Some(false), claude_code: old.claude_code, projects: old.projects, ..Default::default() })?;
    }
    agents_snapshot(&app, &state)
}

/// "Let agents claim and complete action items". Applies to the next request; the token stays.
#[tauri::command]
fn agents_set_allow_writes(app: AppHandle, state: State<AgentsState>, allow: bool) -> Result<AgentsInfo, String> {
    let dir = data_dir(&app)?;
    {
        let slot = state.0.lock().map_err(|e| e.to_string())?;
        let Some(server) = slot.as_ref() else { return Err("Turn on Coding agents first".into()) };
        let mut settings = agents::load_settings(&dir);
        settings.allow_writes = Some(allow);
        agents::save_settings(&dir, &settings)?;
        server.set_allow_writes(allow);
    }
    agents_snapshot(&app, &state)
}

/// The newest agent requests, newest first, for "Recent agent activity".
#[tauri::command]
fn agents_activity(app: AppHandle) -> Result<Vec<agents::Activity>, String> {
    Ok(agents::read_activity(&data_dir(&app)?, 20))
}

/// Replaces the token; agents set up with the old one stop working.
#[tauri::command]
fn agents_new_token(app: AppHandle, state: State<AgentsState>) -> Result<AgentsInfo, String> {
    if state.0.lock().map_err(|e| e.to_string())?.is_none() {
        return Err("Turn on Coding agents first".into());
    }
    agents_start(&data_dir(&app)?, &state, true)?;
    agents_snapshot(&app, &state)
}

/// "Connect Claude Code" (on) or "Disconnect Claude Code" (off): runs `claude mcp add`
/// or `claude mcp remove` for the user, off the main thread (see agents.rs).
#[tauri::command]
async fn agents_claude(app: AppHandle, connect: bool) -> Result<agents::ClaudeOutcome, String> {
    let dir = data_dir(&app)?;
    let server = mcp_server_path(&app);
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let run_dir = dir.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let (claude, node) = agents::find_claude_and_node(&home);
        if connect { agents::connect_claude(&run_dir, &server, claude.as_deref(), node) } else { agents::disconnect_claude(claude.as_deref()) }
    })
    .await
    .map_err(|e| e.to_string())?;
    // One settings write at a time with the switches.
    let state = app.state::<AgentsState>();
    let _held = state.0.lock().map_err(|e| e.to_string())?;
    agents::remember_claude(&dir, &outcome)?;
    Ok(outcome)
}

/// The payee list and caps the app just read from the contract, kept in memory for
/// agents' payment proposals (see agents.rs).
#[tauri::command]
fn agents_set_wallet(app: AppHandle, wallet: agents::WalletSnapshot) -> Result<(), String> {
    agents::set_wallet(&data_dir(&app)?, wallet);
    Ok(())
}

/// "Open in Claude Code" on an action item: Terminal in the project's code folder, running
/// claude with the hand-off prompt and Aftercall's MCP server (see agents.rs).
#[tauri::command]
async fn agents_open_claude(app: AppHandle, project: String, prompt: String) -> Result<agents::OpenOutcome, String> {
    let dir = data_dir(&app)?;
    let server = mcp_server_path(&app);
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let (claude, node) = agents::find_claude_and_node(&home);
        agents::open_in_claude_code(&dir, &project, &prompt, &server, claude.as_deref(), node, &agents::open_terminal)
    })
    .await
    .map_err(|e| e.to_string())
}

/// The cached transcription of one audio chunk, e.g. "mic-000".
fn transcript_path(app: &AppHandle, id: &str, chunk: &str) -> Result<PathBuf, String> {
    let valid = chunk.len() <= 32 && chunk.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !valid {
        return Err("Bad chunk name".into());
    }
    Ok(recording_dir(app, id)?.join("transcripts").join(format!("{chunk}.json")))
}

#[tauri::command]
fn read_chunk_transcript(app: AppHandle, id: String, chunk: String) -> Result<Option<String>, String> {
    Ok(at_rest::read_string(&transcript_path(&app, &id, &chunk)?).ok())
}

#[tauri::command]
fn write_chunk_transcript(app: AppHandle, id: String, chunk: String, raw: String) -> Result<(), String> {
    let path = transcript_path(&app, &id, &chunk)?;
    std::fs::create_dir_all(path.parent().ok_or("No parent")?).map_err(|e| e.to_string())?;
    at_rest::write_string(&path, &raw)
}

/// Deletes the audio and the cached chunk transcriptions once the notes are saved.
#[tauri::command]
fn delete_audio(app: AppHandle, id: String) -> Result<usize, String> {
    delete_audio_in(&recording_dir(&app, &id)?)
}

/// Removes a recording folder's .wav chunks and transcripts/ cache; returns how many
/// chunks went. A chunk already gone (the launch sweep got there first) is fine.
fn delete_audio_in(dir: &std::path::Path) -> Result<usize, String> {
    let _ = std::fs::remove_dir_all(dir.join("transcripts"));
    let mut deleted = 0;
    for e in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        if e.path().extension().and_then(|x| x.to_str()) == Some("wav") {
            match std::fs::remove_file(e.path()) {
                Ok(()) => deleted += 1,
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => return Err(err.to_string()),
            }
        }
    }
    Ok(deleted)
}

/// Audio still beside saved notes: the app quit, or a delete failed, after the notes
/// were saved. The recap says the audio is deleted once the notes are saved, so it goes
/// now. Recordings without notes keep theirs, to be processed or retried.
fn sweep_audio(recordings: &std::path::Path) -> usize {
    let Ok(entries) = std::fs::read_dir(recordings) else { return 0 };
    entries.flatten().filter(|e| e.path().join("notes.json").is_file()).map(|e| delete_audio_in(&e.path()).unwrap_or(0)).sum()
}

/// The paired phone, read at launch: phone.json and its Keychain item, or None.
#[tauri::command]
fn phone_load(app: AppHandle) -> Result<Option<phone::Pairing>, String> {
    phone::load(&data_dir(&app)?)
}

/// Keeps a phone you just paired (after They match), replacing any other.
#[tauri::command]
fn phone_pair(app: AppHandle, state: phone::PhoneState, secrets: phone::PhoneSecrets) -> Result<(), String> {
    phone::pair(&data_dir(&app)?, &state, &secrets)
}

/// Saves the paired phone's counters and results; a counter never goes back.
#[tauri::command]
fn phone_save(app: AppHandle, state: phone::PhoneState) -> Result<(), String> {
    phone::save(&data_dir(&app)?, &state)
}

/// Forgets the paired phone on this Mac (Unpair, or the relay forgot it).
#[tauri::command]
fn phone_forget(app: AppHandle) -> Result<(), String> {
    phone::forget(&data_dir(&app)?)
}

#[tauri::command]
fn nearai_set_key(key: String) -> Result<(), String> {
    nearai::set_key(&key)
}

#[tauri::command]
fn nearai_has_key() -> bool {
    nearai::has_key()
}

#[tauri::command]
fn nearai_key_hint() -> Option<String> {
    nearai::key_hint()
}

#[tauri::command]
async fn nearai_check_key(key: String) -> String {
    nearai::check_key(&key).await
}

#[tauri::command]
fn nearai_clear_key() -> Result<(), String> {
    nearai::clear_key()
}

/// `tls_pin`: the gateway's attested TLS key fingerprint; the upload goes only to a certificate carrying it.
#[tauri::command]
async fn nearai_transcribe(app: AppHandle, path: String, model: String, prompt: String, tls_pin: String) -> Result<String, String> {
    let file = nearai::check_audio_path(std::path::Path::new(&path), &recordings_dir(&app)?)?;
    nearai::transcribe(file, model, prompt, tls_pin).await
}

/// `e2ee` carries the two public keys the request is end-to-end encrypted to; there is no plaintext request.
#[tauri::command]
async fn nearai_chat(body: String, e2ee: nearai::E2ee) -> Result<String, String> {
    nearai::chat(body, e2ee).await
}

/// The notes request, streamed: the same keys as `nearai_chat`, and progress (counts only)
/// sent to the web view on `on_progress` as the encrypted reply arrives.
#[tauri::command]
async fn nearai_chat_stream(body: String, e2ee: nearai::E2ee, on_progress: tauri::ipc::Channel<nearai::StreamProgress>) -> Result<String, String> {
    nearai::chat_stream(body, e2ee, |p| {
        let _ = on_progress.send(p);
    })
    .await
}

#[tauri::command]
async fn nearai_get(path: String) -> Result<String, String> {
    nearai::get(path).await
}

#[tauri::command]
async fn tee_verify_quote(quote: String) -> Result<attest::QuoteReport, String> {
    attest::verify_quote(&quote).await
}

#[tauri::command]
async fn tee_nvidia_attest(payload: String) -> Result<String, String> {
    attest::nvidia_attest(payload).await
}

#[tauri::command]
async fn tee_nvidia_keys() -> Result<String, String> {
    attest::nvidia_keys().await
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn near_config(app: &AppHandle) -> Result<near::NearConfig, String> {
    near::load_config(&data_dir(app)?).ok_or_else(|| "Connect your NEAR account first".to_string())
}

#[tauri::command]
fn near_get_config(app: AppHandle) -> Result<Option<near::NearConfig>, String> {
    Ok(near::load_config(&data_dir(&app)?))
}

#[tauri::command]
fn near_save_config(app: AppHandle, config: near::NearConfig) -> Result<(), String> {
    near::save_config(&data_dir(&app)?, &config)
}

/// "Save and check": is the account there, and is the contract Aftercall's? Saves nothing.
#[tauri::command]
async fn near_check_setup(config: near::NearConfig) -> Result<near::SetupCheck, String> {
    near::check_setup(&config).await
}

/// Does the signing page answer? Asked from Rust, so the webview's origin and CORS don't matter.
#[tauri::command]
async fn near_page_answers(url: String) -> bool {
    near::page_answers(&url).await
}

#[tauri::command]
fn near_public_key() -> Result<String, String> {
    Ok(near::app_key()?.public_key())
}

#[tauri::command]
async fn near_status(app: AppHandle) -> Result<near::NearStatus, String> {
    near::status(&near_config(&app)?).await
}

#[tauri::command]
async fn near_record_proof(app: AppHandle, meeting_id: String, proof_hash: String, model: String) -> Result<near::ProofTx, String> {
    near::record_proof(&near_config(&app)?, &meeting_id, &proof_hash, &model).await
}

#[tauri::command]
async fn near_get_proof(app: AppHandle, owner: String, meeting_id: String) -> Result<serde_json::Value, String> {
    near::get_proof(&near_config(&app)?, &owner, &meeting_id).await
}

#[tauri::command]
async fn near_pay(app: AppHandle, payee: String, amount: String, memo: String, followup_id: String) -> Result<near::PayOutcome, String> {
    near::pay(&near_config(&app)?, &payee, &amount, &memo, &followup_id).await
}

#[tauri::command]
async fn near_pay_cross_chain(
    app: AppHandle,
    payee: String,
    amount: String,
    memo: String,
    followup_id: String,
    deposit_address: String,
    quote_id: String,
) -> Result<near::PayOutcome, String> {
    near::pay_cross_chain(&near_config(&app)?, &payee, &amount, &memo, &followup_id, &deposit_address, &quote_id).await
}

#[tauri::command]
async fn near_wallet(app: AppHandle) -> Result<serde_json::Value, String> {
    near::wallet(&near_config(&app)?).await
}

#[tauri::command]
async fn near_payment_state(app: AppHandle, followup_id: String) -> Result<serde_json::Value, String> {
    near::payment_state(&near_config(&app)?, &followup_id).await
}

#[tauri::command]
async fn near_check_payee(app: AppHandle, account: String) -> Result<serde_json::Value, String> {
    near::check_payee(&near_config(&app)?, &account).await
}

#[tauri::command]
async fn near_owner_usdc(app: AppHandle) -> Result<String, String> {
    near::owner_usdc(&near_config(&app)?).await
}

#[tauri::command]
fn near_sign_in_message(app: AppHandle, message: String, nonce: String, recipient: String) -> Result<serde_json::Value, String> {
    near::sign_in_message(&near_config(&app)?, &message, &nonce, &recipient)
}

#[tauri::command]
fn recovery_status() -> Result<recovery::RecoveryStatus, String> {
    recovery::status()
}

/// A new phrase to show once. Nothing is stored until `recovery_use_phrase`.
#[tauri::command]
fn recovery_new_phrase() -> Result<String, String> {
    recovery::new_phrase()
}

/// Derives this Mac's NEAR key and backup key from the phrase and keeps them in the Keychain.
#[tauri::command]
fn recovery_use_phrase(phrase: String) -> Result<String, String> {
    recovery::use_phrase(&phrase)
}

/// A phrase for a new NEAR account (wallet path m/44'/397'/0') and its public key. Nothing is
/// kept: not in the Keychain, not on disk, not in logs. Separate from this Mac's recovery phrase.
#[tauri::command]
fn near_new_wallet_phrase() -> Result<recovery::NewWallet, String> {
    recovery::new_wallet()
}

/// Read-only: can `<name>.testnet` be created? An error says what's wrong with the name.
#[tauri::command]
async fn near_testnet_name_free(account_id: String) -> Result<bool, String> {
    near::testnet_name_free(&account_id).await
}

/// Creates `<name>.testnet` with the public key through NEAR's testnet helper, then reads its
/// balance back. Testnet only. Refuses a name that's already taken before asking the helper.
#[tauri::command]
async fn near_create_testnet_account(account_id: String, public_key: String) -> Result<near::CreatedAccount, String> {
    if !near::testnet_name_free(&account_id).await? {
        return Err(format!("{account_id} is already taken. Pick another name."));
    }
    let mut created = near::create_testnet_account(&account_id, &public_key, near::helper_post).await?;
    created.balance = near::testnet_balance(&account_id).await.unwrap_or(None);
    Ok(created)
}

/// Writes a recovery kit (the words, numbered, and how to restore them) to the path you
/// picked in the Save dialog, readable by you alone. Refuses Aftercall's own folders.
/// The text is wiped from memory afterwards and never logged. Returns the saved path.
#[tauri::command]
fn recovery_save_kit(app: AppHandle, path: String, text: String) -> Result<String, String> {
    let text = zeroize::Zeroizing::new(text);
    let p = app.path();
    let app_dirs: Vec<PathBuf> = [p.app_data_dir(), p.app_local_data_dir(), p.app_config_dir(), p.app_cache_dir(), p.app_log_dir()]
        .into_iter()
        .filter_map(Result::ok)
        .collect();
    recovery_kit::save(std::path::Path::new(&path), &text, &app_dirs).map(|saved| saved.display().to_string())
}

/// Writes an encrypted backup to Downloads; returns its path.
#[tauri::command]
fn backup_export(app: AppHandle, local: std::collections::BTreeMap<String, String>) -> Result<String, String> {
    let folder = app.path().download_dir().map_err(|e| e.to_string())?;
    recovery::export(&data_dir(&app)?, &folder, local)
}

/// Restores a backup file (base64 of its bytes, as the file picker read it).
#[tauri::command]
fn backup_import(app: AppHandle, file: String) -> Result<recovery::Restored, String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD.decode(file).map_err(|e| e.to_string())?;
    recovery::import(&data_dir(&app)?, &bytes)
}

/// The user's projects, with their briefs and where each brief came from. A first run starts with one, "General".
#[tauri::command]
fn list_projects(app: AppHandle) -> Result<Vec<projects::Entry>, String> {
    projects::load_entries(&data_dir(&app)?)
}

/// Saves the projects, their briefs and where the briefs came from, sealed with the data key (`projects.rs`).
#[tauri::command]
fn save_projects(app: AppHandle, projects: Vec<projects::Entry>) -> Result<(), String> {
    projects::save_entries(&data_dir(&app)?, projects)
}

/// Whether the GitHub CLI is on this Mac (looked for, not run), for "Fill from GitHub".
#[tauri::command]
async fn github_cli(app: AppHandle) -> bool {
    let Ok(home) = app.path().home_dir() else { return false };
    tauri::async_runtime::spawn_blocking(move || github::find_gh(&home).is_some()).await.unwrap_or(false)
}

/// A GitHub repo's public details for a project brief, through `gh` or GitHub's public API (`github.rs`). No AI.
#[tauri::command]
async fn github_repo(app: AppHandle, repo: String) -> Result<github::RepoDetails, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    github::lookup(home, repo).await
}

/// Moves every recording filed under project `from` to project `to` (rename or delete
/// of a project), in both meeting.json and the saved notes.
#[tauri::command]
fn move_recordings_project(app: AppHandle, from: String, to: String) -> Result<usize, String> {
    let to = to.trim();
    if to.is_empty() || to.chars().count() > 60 {
        return Err("Project names are 1 to 60 characters".into());
    }
    let Ok(entries) = std::fs::read_dir(recordings_dir(&app)?) else { return Ok(0) };
    let mut moved = 0;
    for entry in entries.flatten() {
        let meta_path = entry.path().join("meeting.json");
        let Ok(json) = at_rest::read_string(&meta_path) else { continue };
        let Ok(mut meta) = serde_json::from_str::<serde_json::Value>(&json) else { continue };
        if meta["project"] != from.as_str() {
            continue;
        }
        meta["project"] = to.into();
        at_rest::write_json(&meta_path, &meta)?;
        let notes_path = entry.path().join("notes.json");
        if notes_path.exists() {
            notes_file::update(&notes_path, |notes| notes["meeting"]["project"] = to.into())?;
        }
        moved += 1;
    }
    Ok(moved)
}

/// Deletes a recording: its audio, notes and metadata. The proof on NEAR stays, as on-chain data does.
#[tauri::command]
fn delete_recording(app: AppHandle, id: String) -> Result<(), String> {
    let dir = recording_dir(&app, &id)?;
    if dir.exists() {
        std::fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Deletes everything Aftercall keeps on this Mac: the data folder (meetings, notes,
/// transcripts, audio, projects and their briefs, settings) and its Keychain items. The folder goes
/// first; the keys go only once it's gone, so nothing is left that can't be read.
/// Refused while a recording is running. Proofs and payments on NEAR stay.
#[tauri::command]
fn delete_all_data(app: AppHandle, recorder: State<RecorderState>, agents: State<AgentsState>) -> Result<wipe::Wiped, String> {
    if recorder.0.lock().map_err(|e| e.to_string())?.is_some() {
        return Err("Stop the recording first.".into());
    }
    // Close the agents socket, which lives in the data folder.
    agents.0.lock().map_err(|e| e.to_string())?.take();
    let folder_removed = wipe::remove_data_dir(&data_dir(&app)?, &app.config().identifier)?;
    at_rest::forget_data_key();
    let (keychain_removed, keychain_failed) = wipe::delete_keychain_items();
    // shortcut.json went with the folder, so ⌘⇧R is back to the default now, not at the next launch.
    apply_record_shortcut(&app, ShortcutPrefs::default().everywhere);
    Ok(wipe::Wiped { folder_removed, keychain_removed, keychain_failed })
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // A recovery phrase's Copy button, and the Save dialog for its kit (recovery_kit.rs).
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        // ⌘⇧R from any app, unless you turned that off in Settings. Registered in setup,
        // where a clash is logged instead of stopping the app; it is then handled only
        // inside Aftercall (App.tsx).
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    if is_mark_shortcut(shortcut) {
                        mark_shortcut(app);
                    } else {
                        record_shortcut(app);
                    }
                })
                .build(),
        )
        .manage(RecorderState::default())
        .manage(PressGate::default())
        .manage(MarkGate::default())
        .manage(RecordShortcut::default())
        .manage(AgentsState::default())
        .invoke_handler(tauri::generate_handler![
            start_recording,
            pause_recording,
            stop_recording,
            recorder_status,
            save_live_notes,
            save_your_notes,
            open_audio_settings,
            record_shortcut_everywhere,
            record_shortcut_status,
            set_record_shortcut_everywhere,
            live_open_notes,
            show_main_window,
            list_recordings,
            open_sample,
            list_chunks,
            save_notes,
            set_action_item_done,
            edit_action_item,
            agents_info,
            agents_set_enabled,
            agents_new_token,
            agents_set_allow_writes,
            agents_activity,
            agents_claude,
            agents_open_claude,
            agents_set_wallet,
            agents_set_projects,
            delete_audio,
            phone_load,
            phone_pair,
            phone_save,
            phone_forget,
            nearai_set_key,
            nearai_has_key,
            nearai_clear_key,
            nearai_key_hint,
            nearai_check_key,
            nearai_transcribe,
            nearai_chat,
            nearai_chat_stream,
            nearai_get,
            tee_verify_quote,
            tee_nvidia_attest,
            tee_nvidia_keys,
            near_get_config,
            near_save_config,
            near_check_setup,
            near_page_answers,
            near_public_key,
            near_status,
            near_record_proof,
            near_get_proof,
            near_pay,
            near_pay_cross_chain,
            near_wallet,
            near_payment_state,
            near_check_payee,
            near_owner_usdc,
            near_sign_in_message,
            list_projects,
            save_projects,
            github_cli,
            github_repo,
            delete_recording,
            read_chunk_transcript,
            write_chunk_transcript,
            move_recordings_project,
            calendar::calendar_status,
            calendar::calendar_request_access,
            calendar::calendar_events_between,
            recovery_status,
            recovery_new_phrase,
            recovery_use_phrase,
            near_new_wallet_phrase,
            near_testnet_name_free,
            near_create_testnet_account,
            recovery_save_kit,
            backup_export,
            backup_import,
            delete_all_data
        ])
        .setup(|app| {
            if let Ok(dir) = data_dir(app.handle()) {
                // Seal files an earlier version left in plaintext. Off the main thread:
                // the first run asks the Keychain for the data key.
                let migrate_dir = dir.clone();
                std::thread::spawn(move || match at_rest::data_key().and_then(|_| at_rest::migrate(&migrate_dir)) {
                    Ok(0) => {}
                    Ok(n) => eprintln!("at rest: encrypted {n} files left by an earlier version"),
                    Err(e) => eprintln!("at rest: {e}"),
                });
                // Audio left beside saved notes by an earlier run goes now.
                let recordings = dir.join("recordings");
                std::thread::spawn(move || match sweep_audio(&recordings) {
                    0 => {}
                    n => eprintln!("audio: deleted {n} chunks left beside saved notes"),
                });
                // Coding agents stays on across restarts, with the same token.
                if agents::load_settings(&dir).enabled
                    && let Err(e) = agents_start(&dir, &app.state::<AgentsState>(), false)
                {
                    eprintln!("agents: {e}");
                }
            }
            // ⌘⇧R from any app unless you turned that off in Settings.
            let everywhere = data_dir(app.handle()).map(|d| load_shortcut_prefs(&d).everywhere).unwrap_or(true);
            apply_record_shortcut(app.handle(), everywhere);
            // Menu bar item: start a recording or open the app from anywhere. While
            // recording it shows the time and offers Add a note, Pause and Stop.
            let menu = tray_menu(app.handle(), None)?;
            // A black template glyph: macOS tints it for light and dark menu bars.
            let glyph = tauri::image::Image::from_bytes(include_bytes!("../icons/source/tray@2x.png"))?;
            TrayIconBuilder::with_id("main")
                .menu(&menu)
                .tooltip("Aftercall")
                .icon(glyph)
                .icon_as_template(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    // These two show ⌘⇧R, so they share the global shortcut's gate.
                    "record" if app.state::<PressGate>().accept(Instant::now()) => {
                        show_main(app);
                        let _ = app.emit("menu:new-recording", ());
                    }
                    "note" if app.state::<PressGate>().accept(Instant::now()) => {
                        show_main(app);
                        let _ = app.emit("recorder:open-live", ());
                    }
                    "pause" => {
                        let paused = app.state::<RecorderState>().0.lock().ok().and_then(|s| s.as_ref().map(|l| l.clock.paused.load(Ordering::Relaxed)));
                        if let Some(paused) = paused {
                            let _ = set_paused(app, !paused);
                        }
                    }
                    "stop" => {
                        if let Err(e) = finish_recording(app) {
                            eprintln!("recorder: {e}");
                        }
                        show_main(app);
                    }
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            // The floating recorder, hidden until a recording runs with the main window in the background.
            if let Err(e) = live_window::create(app.handle()) {
                eprintln!("live window: {e}");
            }
            Ok(())
        })
        // Closing the window hides it: Aftercall keeps running in the menu bar so
        // ⌘⇧R and a recording in progress survive. Quit from the menu bar or ⌘Q.
        // While recording, the floating recorder stands in for the main window
        // whenever it is in the background, and steps aside when it comes back.
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                tauri::WindowEvent::Focused(focused) => {
                    let app = window.app_handle();
                    let recording = app.state::<RecorderState>().0.lock().map(|s| s.is_some()).unwrap_or(false);
                    if *focused {
                        live_window::hide(app);
                    } else if recording {
                        live_window::show(app);
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // Quitting mid-recording (⌘Q, the menu bar, the Dock) still saves the
            // recording: the last audio is sealed and meeting.json written first.
            // ⌘Q from the app menu ends the run loop without ExitRequested, so Exit
            // does the same.
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                let recording = app.state::<RecorderState>().0.lock().map(|s| s.is_some()).unwrap_or(false);
                if recording && let Err(e) = finish_recording(app) {
                    eprintln!("recorder: couldn't save the recording on quit: {e}");
                }
            }
            // Clicking the Dock icon brings the hidden window back.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => show_main(app),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shortcut_works_from_any_app_until_you_turn_it_off() {
        let dir = std::env::temp_dir().join(format!("aftercall-shortcut-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert!(load_shortcut_prefs(&dir).everywhere, "on by default, before anything is saved");
        save_shortcut_prefs(&dir, &ShortcutPrefs { everywhere: false }).unwrap();
        assert!(!load_shortcut_prefs(&dir).everywhere, "off stays off after a restart");
        save_shortcut_prefs(&dir, &ShortcutPrefs { everywhere: true }).unwrap();
        assert!(load_shortcut_prefs(&dir).everywhere);
        std::fs::write(shortcut_prefs_path(&dir), b"not json").unwrap();
        assert!(load_shortcut_prefs(&dir).everywhere, "an unreadable file falls back to the default");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn audio_left_beside_saved_notes_is_swept_and_unprocessed_audio_stays() {
        let root = std::env::temp_dir().join(format!("aftercall-sweep-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let done = root.join("1700000000");
        let pending = root.join("1700000100");
        for d in [&done, &pending] {
            std::fs::create_dir_all(d.join("transcripts")).unwrap();
            std::fs::write(d.join("mic-000.wav"), b"a").unwrap();
            std::fs::write(d.join("system-000.wav"), b"b").unwrap();
            std::fs::write(d.join("meeting.json"), b"{}").unwrap();
        }
        std::fs::write(done.join("notes.json"), b"{}").unwrap();

        assert_eq!(sweep_audio(&root), 2);
        assert!(!done.join("mic-000.wav").exists() && !done.join("transcripts").exists());
        assert!(done.join("notes.json").exists() && done.join("meeting.json").exists(), "only the audio goes");
        assert!(pending.join("mic-000.wav").exists() && pending.join("transcripts").exists(), "no notes yet: the audio is still needed");
        assert_eq!(sweep_audio(&root), 0, "nothing left to sweep");
        assert_eq!(delete_audio_in(&done).unwrap(), 0, "deleting again is fine");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_menu_bar_clock_reads_like_a_timer() {
        assert_eq!(clock_text(0), "00:00");
        assert_eq!(clock_text(754), "12:34");
        assert_eq!(clock_text(3599), "59:59");
        assert_eq!(clock_text(3723), "1:02:03");
        assert_eq!(tray_title(754, false), "● 12:34");
        assert_eq!(tray_title(754, true), "Paused 12:34");
    }

    #[test]
    fn the_mark_shortcut_is_its_own_key() {
        let mark: Shortcut = MARK_SHORTCUT.parse().unwrap();
        let record: Shortcut = RECORD_SHORTCUT.parse().unwrap();
        assert!(is_mark_shortcut(&mark));
        assert!(!is_mark_shortcut(&record), "⌘⇧R still opens the record sheet or your notes");
    }

    #[test]
    fn one_press_of_the_shortcut_is_one_action() {
        let gate = PressGate::default();
        let t0 = Instant::now();
        assert!(gate.accept(t0), "the first trigger acts");
        assert!(!gate.accept(t0 + Duration::from_millis(5)), "the menu item seeing the same press is dropped");
        assert!(!gate.accept(t0 + PRESS_GAP - Duration::from_millis(1)));
        assert!(gate.accept(t0 + PRESS_GAP), "a second press acts");
        assert!(!gate.accept(t0), "a clock that goes backwards counts as the same press");
    }

    #[test]
    fn your_notes_never_go_into_meeting_json() {
        let meta = MeetingMeta {
            id: "1700000000".into(),
            project: "General".into(),
            started_at: 1_700_000_000,
            seconds: 60,
            chunks: 1,
            dir: "/tmp/x".into(),
            notes: None,
            label: None,
            title: None,
            your_notes: None,
            notice: None,
        };
        let json = serde_json::to_string(&meta).unwrap();
        assert!(!json.contains("yourNotes"));
        let with = MeetingMeta { your_notes: Some("Deposit 40".into()), ..meta };
        assert!(serde_json::to_string(&with).unwrap().contains(r#""yourNotes":"Deposit 40""#), "the interface gets them as yourNotes");
    }

    #[test]
    fn the_notice_round_trips_through_meeting_json() {
        // Older meeting.json files have no notice, and samples never get one.
        let old: MeetingMeta = serde_json::from_str(r#"{"id":"1700000000","project":"General","startedAt":1700000000,"seconds":60,"chunks":1,"dir":"/x"}"#).unwrap();
        assert_eq!(old.notice, None);
        assert!(!serde_json::to_string(&old).unwrap().contains("notice"));

        let notice: NoticeLog = serde_json::from_str(r#"{"by":"you","at":"2026-11-01T14:02:00.000Z","how":"chat"}"#).unwrap();
        let meta = MeetingMeta { notice: Some(notice.clone()), ..old };
        let back: MeetingMeta = serde_json::from_str(&serde_json::to_string(&meta).unwrap()).unwrap();
        assert_eq!(back.notice, Some(notice));

        let no_how: NoticeLog = serde_json::from_str(r#"{"by":"you","at":"2026-11-01T14:02:00.000Z"}"#).unwrap();
        assert_eq!(no_how.how, None);
        assert!(!serde_json::to_string(&no_how).unwrap().contains("how"));
    }

    #[test]
    fn a_notice_must_be_yours_and_say_how_in_known_words() {
        assert!(serde_json::from_str::<NoticeLog>(r#"{"by":"ada","at":"2026-11-01T14:02:00Z"}"#).is_err());
        assert!(serde_json::from_str::<NoticeLog>(r#"{"by":"you","at":"2026-11-01T14:02:00Z","how":"telepathy"}"#).is_err());
        let long = NoticeLog { by: NoticeBy::You, at: "x".repeat(41), how: None };
        assert!(long.check().is_err());
        let empty = NoticeLog { by: NoticeBy::You, at: String::new(), how: None };
        assert!(empty.check().is_err());
    }
}
