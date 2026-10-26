mod capture;
mod near;
mod nearai;
mod recorder;

/// The NEAR AI transport, exposed for the integration tests in tests/.
#[doc(hidden)]
pub mod test_api {
    pub use crate::nearai::{chat, transcribe};
}

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
    /// Notes saved after processing (`notes.json`), as the JSON the interface wrote.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
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
    let meta = MeetingMeta { id: stamp.to_string(), project, started_at: stamp, seconds: 0, chunks: 0, dir: dir.display().to_string(), notes: None };
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
        .filter_map(|e| {
            let mut meta: MeetingMeta = serde_json::from_str(&std::fs::read_to_string(e.path().join("meeting.json")).ok()?).ok()?;
            meta.notes = std::fs::read_to_string(e.path().join("notes.json")).ok();
            Some(meta)
        })
        .collect();
    out.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(out)
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

#[tauri::command]
fn save_notes(app: AppHandle, id: String, notes: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&notes).map_err(|e| e.to_string())?;
    std::fs::write(recording_dir(&app, &id)?.join("notes.json"), notes).map_err(|e| e.to_string())
}

/// Deletes the audio once it has been transcribed. Notes and metadata stay.
#[tauri::command]
fn delete_audio(app: AppHandle, id: String) -> Result<usize, String> {
    let dir = recording_dir(&app, &id)?;
    let mut deleted = 0;
    for e in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        if e.path().extension().and_then(|x| x.to_str()) == Some("wav") {
            std::fs::remove_file(e.path()).map_err(|e| e.to_string())?;
            deleted += 1;
        }
    }
    Ok(deleted)
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
fn nearai_clear_key() -> Result<(), String> {
    nearai::clear_key()
}

#[tauri::command]
async fn nearai_transcribe(app: AppHandle, path: String, model: String, prompt: String) -> Result<String, String> {
    let file = nearai::check_audio_path(std::path::Path::new(&path), &recordings_dir(&app)?)?;
    nearai::transcribe(file, model, prompt).await
}

#[tauri::command]
async fn nearai_chat(body: String) -> Result<String, String> {
    nearai::chat(body).await
}

#[tauri::command]
async fn nearai_get(path: String) -> Result<String, String> {
    nearai::get(path).await
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

#[tauri::command]
fn near_public_key() -> Result<String, String> {
    Ok(near::app_key()?.public_key())
}

#[tauri::command]
async fn near_status(app: AppHandle) -> Result<near::NearStatus, String> {
    near::status(&near_config(&app)?).await
}

#[tauri::command]
async fn near_record_proof(app: AppHandle, meeting_id: String, proof_hash: String, model: String) -> Result<String, String> {
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
        .invoke_handler(tauri::generate_handler![
            start_recording,
            pause_recording,
            stop_recording,
            list_recordings,
            list_chunks,
            save_notes,
            delete_audio,
            nearai_set_key,
            nearai_has_key,
            nearai_clear_key,
            nearai_transcribe,
            nearai_chat,
            nearai_get,
            near_get_config,
            near_save_config,
            near_public_key,
            near_status,
            near_record_proof,
            near_get_proof,
            near_pay,
            near_wallet,
            near_payment_state,
            near_check_payee,
            near_owner_usdc,
            near_sign_in_message
        ])
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
