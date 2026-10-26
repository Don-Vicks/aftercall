import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** True inside the Tauri app; false when the interface runs in a plain browser (pnpm dev:ui). */
export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface RecordingInfo {
  dir: string;
  microphone: string;
  systemAudio: boolean;
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
  start: (project: string) => invoke<RecordingInfo>("start_recording", { project }),
  pause: (paused: boolean) => invoke<void>("pause_recording", { paused }),
  stop: () => invoke<SavedRecording>("stop_recording"),
  list: () => invoke<SavedRecording[]>("list_recordings"),
  onLevels: (fn: (l: Levels) => void): Promise<UnlistenFn> => listen<Levels>("recorder:levels", (e) => fn(e.payload)),
  onSilence: (fn: (s: SilenceEvent) => void): Promise<UnlistenFn> => listen<SilenceEvent>("recorder:silence", (e) => fn(e.payload)),
  onMenuNewRecording: (fn: () => void): Promise<UnlistenFn> => listen("menu:new-recording", () => fn()),
};
