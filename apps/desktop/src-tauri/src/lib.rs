mod capture;
mod recorder;

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use recorder::{Events, Levels, Recording, RecordingInfo, RecordingResult, SilenceEvent};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};

/// The recording in progress, with the project and start time it was started for.
#[derive(Default)]
struct RecorderState(Mutex<Option<(Recording, MeetingMeta)>>);

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
}

fn recordings_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("recordings"))
}

/// Forwards recorder updates to the interface as Tauri events.
struct AppEvents(AppHandle);

impl Events for AppEvents {
    fn levels(&self, levels: Levels) {
        let _ = self.0.emit("recorder:levels", levels);
    }
    fn silence(&self, event: SilenceEvent) {
        let _ = self.0.emit("recorder:silence", event);
    }
}

fn set_tray_recording(app: &AppHandle, recording: bool) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_title(Some(if recording { "● Rec" } else { "" }));
        let _ = tray.set_tooltip(Some(if recording { "Aftercall · recording" } else { "Aftercall" }));
    }
}

#[tauri::command]
fn start_recording(project: String, app: AppHandle, state: State<RecorderState>) -> Result<RecordingInfo, String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        return Err("Already recording".into());
    }
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs();
    let dir = recordings_dir(&app)?.join(stamp.to_string());
    let meta = MeetingMeta { id: stamp.to_string(), project, started_at: stamp, seconds: 0, chunks: 0, dir: dir.display().to_string() };
    let (recording, info) = Recording::start(dir, AppEvents(app.clone())).map_err(|e| format!("{e:#}"))?;
    *slot = Some((recording, meta));
    set_tray_recording(&app, true);
    Ok(info)
}

#[tauri::command]
fn pause_recording(paused: bool, state: State<RecorderState>) -> Result<(), String> {
    let slot = state.0.lock().map_err(|e| e.to_string())?;
    slot.as_ref().ok_or("Not recording")?.0.pause(paused);
    Ok(())
}

#[tauri::command]
fn stop_recording(app: AppHandle, state: State<RecorderState>) -> Result<MeetingMeta, String> {
    let (recording, mut meta) = state.0.lock().map_err(|e| e.to_string())?.take().ok_or("Not recording")?;
    set_tray_recording(&app, false);
    let result: RecordingResult = recording.stop().map_err(|e| format!("{e:#}"))?;
    meta.seconds = result.seconds;
    meta.chunks = result.chunks;
    let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    std::fs::write(PathBuf::from(&meta.dir).join("meeting.json"), json).map_err(|e| e.to_string())?;
    Ok(meta)
}

/// Every saved recording, newest first.
#[tauri::command]
fn list_recordings(app: AppHandle) -> Result<Vec<MeetingMeta>, String> {
    let root = recordings_dir(&app)?;
    let Ok(entries) = std::fs::read_dir(&root) else { return Ok(vec![]) };
    let mut out: Vec<MeetingMeta> = entries
        .flatten()
        .filter_map(|e| std::fs::read_to_string(e.path().join("meeting.json")).ok())
        .filter_map(|json| serde_json::from_str(&json).ok())
        .collect();
    out.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(out)
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
        .manage(RecorderState::default())
        .invoke_handler(tauri::generate_handler![start_recording, pause_recording, stop_recording, list_recordings])
        .setup(|app| {
            // Menu bar item: start a recording or open the app from anywhere.
            let record = MenuItem::with_id(app, "record", "New recording…", true, Some("CmdOrCtrl+Shift+R"))?;
            let open = MenuItem::with_id(app, "open", "Open Aftercall", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Aftercall", true, Some("CmdOrCtrl+Q"))?;
            let menu = Menu::with_items(app, &[&record, &open, &PredefinedMenuItem::separator(app)?, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main").menu(&menu).tooltip("Aftercall");
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone()).icon_as_template(true);
            }
            tray.on_menu_event(|app, event| match event.id.as_ref() {
                "record" => {
                    show_main(app);
                    let _ = app.emit("menu:new-recording", ());
                }
                "open" => show_main(app),
                "quit" => app.exit(0),
                _ => {}
            })
            .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
