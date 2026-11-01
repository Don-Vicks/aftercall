import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { NoticeLog } from "@aftercall/core";

/** True inside the Tauri app; false when the interface runs in a plain browser (pnpm dev:ui). */
export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** A recording in progress, as the recorder reports it (`recorder_status`, `recorder:state`). */
export interface RecorderStatus {
  id: string;
  project: string;
  /** Unix seconds. */
  startedAt: number;
  /** Seconds recorded, not counting pauses. */
  seconds: number;
  paused: boolean;
  microphone: string;
  /** False when macOS gave no access to the call's audio: only your mic is recorded. */
  systemAudio: boolean;
  /** What you've typed so far, from your-notes.json. */
  yourNotes?: string | null;
}

/** A saved recording (`meeting.json` next to its audio). */
export interface SavedRecording {
  id: string;
  project: string;
  /** Unix seconds. */
  startedAt: number;
  seconds: number;
  chunks: number;
  dir: string;
  /** Contents of notes.json once the recording has been processed. */
  notes?: string;
  /** "Sample" for the built-in fictional calls (samples/); absent for real recordings. */
  label?: string;
  /** The name a sample comes with. Real recordings are named from the calendar. */
  title?: string;
  /** The calendar event's title, looked up in the app (not saved). */
  eventTitle?: string;
  /** What you typed during the call (your-notes.json), if anything. Read-only once notes exist. */
  yourNotes?: string;
  /** The record sheet's "I've told everyone" tick, kept in meeting.json for the proof. Samples have none. */
  notice?: NoticeLog;
}

export interface Levels {
  mic: number;
  system: number;
  seconds: number;
}

export interface SilenceEvent {
  stem: "mic" | "system";
  silent: boolean;
}

export const recorder = {
  start: (project: string, notice?: NoticeLog) => invoke<RecorderStatus>("start_recording", { project, notice: notice ?? null }),
  pause: (paused: boolean) => invoke<void>("pause_recording", { paused }),
  stop: () => invoke<SavedRecording>("stop_recording"),
  /** The recording in progress, or null: how a reloaded window picks it up again. */
  status: () => invoke<RecorderStatus | null>("recorder_status"),
  list: () => invoke<SavedRecording[]>("list_recordings"),
  /** Your notes for the recording in progress (sealed on disk). */
  saveLiveNotes: (text: string) => invoke<void>("save_live_notes", { text }),
  /** Your notes for a stopped recording; refused once its notes are made. */
  saveYourNotes: (id: string, text: string) => invoke<void>("save_your_notes", { id, text }),
  /** System Settings → Privacy & Security → Screen & System Audio Recording. */
  openAudioSettings: () => invoke<void>("open_audio_settings"),
  onLevels: (fn: (l: Levels) => void): Promise<UnlistenFn> => listen<Levels>("recorder:levels", (e) => fn(e.payload)),
  onSilence: (fn: (s: SilenceEvent) => void): Promise<UnlistenFn> => listen<SilenceEvent>("recorder:silence", (e) => fn(e.payload)),
  /** Every change of state: started, paused, resumed (a status), stopped (null). */
  onState: (fn: (s: RecorderStatus | null) => void): Promise<UnlistenFn> => listen<RecorderStatus | null>("recorder:state", (e) => fn(e.payload)),
  /** The saved recording, however it was stopped: a Stop button, the menu bar, the floating recorder. */
  onStopped: (fn: (r: SavedRecording) => void): Promise<UnlistenFn> => listen<SavedRecording>("recorder:stopped", (e) => fn(e.payload)),
  /** The floating recorder's "Open notes", or "Add a note…" in the menu bar. */
  onOpenLive: (fn: () => void): Promise<UnlistenFn> => listen("recorder:open-live", () => fn()),
  onMenuNewRecording: (fn: () => void): Promise<UnlistenFn> => listen("menu:new-recording", () => fn()),
};

/** Calls the floating recorder makes; they bring the main window back. */
export const liveWindow = {
  openNotes: () => invoke<void>("live_open_notes"),
  showMain: () => invoke<void>("show_main_window"),
};
