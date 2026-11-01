import { useEffect, useRef, useSyncExternalStore } from "react";
import type { CalendarEvent } from "@aftercall/core";
import { rmsToLevel } from "../primitives";
import { calendar } from "../calendar";
import { isDesktop, recorder, type RecorderStatus, type SavedRecording } from "../recorder";

/**
 * The live recording, held outside React so every view, the pill, the notes drawer
 * and the floating window read one truth. In the Mac app the Rust recorder is the
 * source (recorder_status on load, then recorder:* events), so a reloaded window
 * picks up a recording in progress. In a plain browser it is simulated.
 */

export type Phase = "idle" | "starting" | "recording" | "paused" | "stopping";
export type NotesSave = "idle" | "saving" | "saved" | "error";

export interface RecordingSession {
  phase: Phase;
  id: string | null;
  project: string;
  /** Unix seconds; 0 when idle. */
  startedAt: number;
  /** Seconds recorded, not counting pauses. */
  seconds: number;
  microphone: string;
  /** False when macOS gave no access to the call's audio (only the mic is recorded). */
  systemAudio: boolean;
  /** The call's audio has been exact zeros for 30 s: usually a missing permission. */
  callSilent: boolean;
  /** "Keep recording" on the warning; it comes back if the call goes silent again. */
  warningDismissed: boolean;
  /** The calendar event this call is probably for. */
  event: CalendarEvent | null;
  /** True for the made-up event the browser preview shows. */
  eventIsSample: boolean;
  /** Your notes, as typed. */
  notes: string;
  notesSave: NotesSave;
  notesError: string | null;
  /** The notes drawer over the page (the pill's Note, ⌘⇧R). */
  drawerOpen: boolean;
  /** True while the recording's own page is on screen; it has the notes, so no drawer. */
  onLivePage: boolean;
  /** Bumped to ask the live page to put the cursor in its notes. */
  focusNotes: number;
}

/** A recording that just stopped. `saved` is null in the browser preview (nothing on disk). */
export interface Stopped {
  saved: SavedRecording | null;
  project: string;
  seconds: number;
}

const idle = (): RecordingSession => ({
  phase: "idle",
  id: null,
  project: "",
  startedAt: 0,
  seconds: 0,
  microphone: "",
  systemAudio: true,
  callSilent: false,
  warningDismissed: false,
  event: null,
  eventIsSample: false,
  notes: "",
  notesSave: "idle",
  notesError: null,
  drawerOpen: false,
  onLivePage: false,
  focusNotes: 0,
});

let state = idle();
const listeners = new Set<() => void>();

function set(patch: Partial<RecordingSession>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const getSession = () => state;
export const isLive = (s: RecordingSession = state) => s.phase === "recording" || s.phase === "paused" || s.phase === "stopping";

function subscribe(l: () => void) {
  start();
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** The live recording, for any component: the pill, the sidebar's live row, Home's live card. */
export function useRecordingSession(): RecordingSession {
  return useSyncExternalStore(subscribe, getSession, getSession);
}

// ---------- levels ----------

/**
 * The last few levels of one stem (0..1), newest last. Meters read `current` every
 * animation frame (Meter's levelRef), so audio never re-renders React.
 */
class LevelBuffer {
  private values = new Float32Array(6);
  private next = 0;
  push(level: number) {
    this.values[this.next] = level;
    this.next = (this.next + 1) % this.values.length;
  }
  clear() {
    this.values.fill(0);
  }
  /** Mostly the latest peak, steadied by the recent average: lively without flicker. */
  get current(): number {
    const n = this.values.length;
    const last = this.values[(this.next + n - 1) % n];
    const before = this.values[(this.next + n - 2) % n];
    const mean = this.values.reduce((a, b) => a + b, 0) / n;
    return Math.max(last, before) * 0.65 + mean * 0.35;
  }
}

/** Your mic and the call, for `<Meter levelRef={levels.mic} />`. */
export const levels = { mic: new LevelBuffer(), call: new LevelBuffer() };

// ---------- what the app does when the recording changes ----------

export interface RecordingHandlers {
  /** A recording stopped, however it was stopped. Show its page. */
  onStopped?: (s: Stopped) => void;
  /** The floating recorder's "Open notes", or the menu bar's "Add a note…": show the live page. */
  onOpenLive?: () => void;
  /** "Open" on the Notes ready toast. */
  onOpenMeeting?: (id: string) => void;
}

let handlers: RecordingHandlers = {};

/** The main window registers what to do on these; one registration at a time. */
export function useRecordingEvents(h: RecordingHandlers) {
  const ref = useRef(h);
  ref.current = h;
  useEffect(() => {
    const live: RecordingHandlers = {
      onStopped: (s) => ref.current.onStopped?.(s),
      onOpenLive: () => ref.current.onOpenLive?.(),
      onOpenMeeting: (id) => ref.current.onOpenMeeting?.(id),
    };
    handlers = live;
    start();
    return () => {
      if (handlers === live) handlers = {};
    };
  }, []);
}

/** Asks the main window to open a meeting (the Notes ready toast). */
export const requestOpenMeeting = (id: string) => handlers.onOpenMeeting?.(id);

// ---------- the recorder's events (Mac app) ----------

let started = false;

function start() {
  if (started || !isDesktop) return;
  started = true;
  recorder.onLevels((l) => {
    if (!isLive() || state.phase === "paused") return;
    levels.mic.push(rmsToLevel(l.mic));
    levels.call.push(rmsToLevel(l.system));
    if (l.seconds !== state.seconds) set({ seconds: l.seconds });
  });
  recorder.onSilence((s) => {
    if (s.stem !== "system") return;
    set(s.silent ? { callSilent: true } : { callSilent: false, warningDismissed: false });
  });
  recorder.onState(applyStatus);
  recorder.onStopped((r) => void stopped(r));
  recorder.onOpenLive(() => handlers.onOpenLive?.());
  recorder
    .status()
    .then(applyStatus)
    .catch(() => {});
}

/** Unsaved notes when a recording stopped somewhere else; saved to the stopped recording. */
let orphanNotes: { id: string; text: string } | null = null;

function applyStatus(s: RecorderStatus | null) {
  if (!s) {
    if (state.phase === "idle" || state.phase === "starting") return;
    if (dirty && state.id) orphanNotes = { id: state.id, text: state.notes };
    dirty = false;
    window.clearTimeout(saveTimer);
    levels.mic.clear();
    levels.call.clear();
    set(idle());
    return;
  }
  const fresh = state.id !== s.id;
  if (s.paused) {
    levels.mic.clear();
    levels.call.clear();
  }
  set({
    phase: state.phase === "stopping" ? "stopping" : s.paused ? "paused" : "recording",
    id: s.id,
    project: s.project,
    startedAt: s.startedAt,
    seconds: Math.max(s.seconds, fresh ? 0 : state.seconds),
    microphone: s.microphone,
    systemAudio: s.systemAudio,
    ...(fresh
      ? {
          // The sheet's event when this window started it; otherwise looked up below.
          event: state.phase === "starting" ? state.event : null,
          eventIsSample: false,
          notes: s.yourNotes ?? "",
          notesSave: s.yourNotes ? "saved" : "idle",
          notesError: null,
          callSilent: false,
          warningDismissed: false,
        }
      : {}),
  });
  if (fresh && !state.event) {
    const id = s.id;
    calendar
      .eventFor({ startedAt: s.startedAt, seconds: Math.max(s.seconds, 60) })
      .then((event) => event && state.id === id && set({ event }))
      .catch(() => {});
  }
}

async function stopped(r: SavedRecording) {
  let saved = r;
  if (orphanNotes?.id === r.id) {
    const text = orphanNotes.text;
    orphanNotes = null;
    await recorder
      .saveYourNotes(r.id, text)
      .then(() => (saved = { ...r, yourNotes: text.trim() ? text : undefined }))
      .catch(() => {});
  }
  if (state.id === r.id) set(idle());
  autoProcess.add(r.id);
  handlers.onStopped?.({ saved, project: saved.project, seconds: saved.seconds });
}

/**
 * Recordings stopped with "Stop and make notes" in this session: their page starts
 * making notes as soon as it opens (when NEAR AI is connected).
 */
const autoProcess = new Set<string>();
export const takeAutoProcess = (id: string) => autoProcess.delete(id);

// ---------- actions ----------

/** Starts recording `project`. Consent is the sheet's job: it never calls this unticked. */
export async function startRecording(project: string, event: CalendarEvent | null, eventIsSample = false): Promise<void> {
  if (state.phase !== "idle") throw new Error("Already recording");
  set({ ...idle(), phase: "starting", project, event, eventIsSample });
  if (!isDesktop) {
    set({ phase: "recording", id: `preview-${Date.now()}`, startedAt: Math.floor(Date.now() / 1000), microphone: "Preview", systemAudio: true });
    simulate();
    return;
  }
  try {
    applyStatus(await recorder.start(project));
  } catch (e) {
    set(idle());
    throw e;
  }
}

export async function togglePause(): Promise<void> {
  if (state.phase !== "recording" && state.phase !== "paused") return;
  const paused = state.phase === "recording";
  set({ phase: paused ? "paused" : "recording" });
  if (paused) {
    levels.mic.clear();
    levels.call.clear();
  }
  if (!isDesktop) return;
  try {
    await recorder.pause(paused);
  } catch (e) {
    set({ phase: paused ? "recording" : "paused" });
    throw e;
  }
}

/** Stops and saves the recording. Its page then opens (useRecordingEvents' onStopped). */
export async function stopRecording(): Promise<void> {
  if (state.phase !== "recording" && state.phase !== "paused") return;
  const was = state.phase;
  set({ phase: "stopping", drawerOpen: false });
  await flushNotes();
  if (!isDesktop) {
    const done: Stopped = { saved: null, project: state.project, seconds: state.seconds };
    stopSimulation();
    set(idle());
    handlers.onStopped?.(done);
    return;
  }
  try {
    // The recorder:stopped event that follows opens the recording (see `stopped`).
    await recorder.stop();
  } catch (e) {
    // Rust ends the recording even when saving it fails; only a refusal leaves it running.
    if (getSession().phase === "stopping") set({ phase: was });
    throw e;
  }
}

// ---------- your notes ----------

let saveTimer = 0;
let dirty = false;
let saving: Promise<void> = Promise.resolve();

/** Your notes, saved 600 ms after the last keystroke (sealed on this Mac). */
export function setNotes(text: string) {
  if (!isLive()) return;
  dirty = true;
  set({ notes: text, notesSave: "saving", notesError: null });
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void flushNotes(), 600);
}

/** Saves now what's waiting. Saves run one after another, so an older one never lands last. */
export function flushNotes(): Promise<void> {
  window.clearTimeout(saveTimer);
  if (!dirty) return saving;
  dirty = false;
  const { id, notes } = state;
  saving = saving.then(async () => {
    try {
      if (isDesktop) await recorder.saveLiveNotes(notes);
      if (state.id === id && state.notes === notes) set({ notesSave: "saved", notesError: null });
    } catch (e) {
      if (state.id === id) {
        dirty = true;
        set({ notesSave: "error", notesError: e instanceof Error ? e.message : String(e) });
      }
    }
  });
  return saving;
}

/** ⌘⇧R and the pill's Note: the cursor goes into your notes, on the live page or in the drawer. */
export function openNotes() {
  if (!isLive()) return;
  if (state.onLivePage) set({ focusNotes: state.focusNotes + 1 });
  else set({ drawerOpen: true });
}

export const closeNotes = () => set({ drawerOpen: false });
export const dismissSilentWarning = () => set({ warningDismissed: true });

/** The live page tells the store while it's on screen (it has the notes; the pill drops its Note). */
export function useLivePage() {
  useEffect(() => {
    set({ onLivePage: true, drawerOpen: false });
    return () => set({ onLivePage: false });
  }, []);
}

// ---------- the browser preview ----------

let sim: number[] = [];

/** pnpm dev:ui has no recorder: a ticking clock and two voices taking turns. */
function simulate() {
  stopSimulation();
  const t0 = performance.now();
  // ?simulate=silent previews the silent-call warning (V2Silent) after three seconds.
  if (new URLSearchParams(window.location.search).get("simulate") === "silent") {
    sim.push(window.setTimeout(() => isLive() && set({ callSilent: true }), 3000));
  }
  sim.push(
    window.setInterval(() => state.phase === "recording" && set({ seconds: state.seconds + 1 }), 1000),
    window.setInterval(() => {
      if (state.phase !== "recording") return;
      const turn = Math.sin((performance.now() - t0) / 2400);
      const voice = () => 0.25 + Math.random() * 0.55;
      levels.mic.push(turn > 0.1 ? voice() : Math.random() * 0.08);
      levels.call.push(turn < -0.1 && !state.callSilent ? voice() : 0);
    }, 80),
  );
}

function stopSimulation() {
  sim.forEach((t) => (window.clearInterval(t), window.clearTimeout(t)));
  sim = [];
  levels.mic.clear();
  levels.call.clear();
}
