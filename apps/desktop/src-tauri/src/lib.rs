mod capture;
mod recorder;

use std::sync::Mutex;

use recorder::{Events, Levels, Recording, RecordingInfo, RecordingResult, SilenceEvent};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct RecorderState(Mutex<Option<Recording>>);

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
fn start_recording(app: AppHandle, state: State<RecorderState>) -> Result<RecordingInfo, String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        return Err("Already recording".into());
    }
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs();
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("recordings").join(stamp.to_string());
    let (recording, info) = Recording::start(dir, AppEvents(app.clone())).map_err(|e| format!("{e:#}"))?;
    *slot = Some(recording);
    set_tray_recording(&app, true);
    Ok(info)
}

#[tauri::command]
fn pause_recording(paused: bool, state: State<RecorderState>) -> Result<(), String> {
    let slot = state.0.lock().map_err(|e| e.to_string())?;
    slot.as_ref().ok_or("Not recording")?.pause(paused);
    Ok(())
}

#[tauri::command]
fn stop_recording(app: AppHandle, state: State<RecorderState>) -> Result<RecordingResult, String> {
    let recording = state.0.lock().map_err(|e| e.to_string())?.take().ok_or("Not recording")?;
    set_tray_recording(&app, false);
    recording.stop().map_err(|e| format!("{e:#}"))
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
        .invoke_handler(tauri::generate_handler![start_recording, pause_recording, stop_recording])
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
