import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { formatClock } from "@aftercall/core";
import { isDesktop } from "../recorder";
import { getSession, isLive, setNotes } from "./session";

/*
 * "Mark this moment": ⌘⇧M, or Mark on the live page and the pill, puts the time
 * ("[12:40] ") into your notes. A mark is only that text, so it goes where your notes go
 * (sealed on this Mac, then end-to-end encrypted to NEAR AI with the transcript) and
 * there's nothing else to keep. The live page's timeline draws a tick for each one,
 * and after the call the meeting page turns each into a chip that jumps to that moment.
 */

export { findMoments, type Moment } from "../moments";

/** What Mark writes: "[12:40] ". */
export const momentStamp = (seconds: number) => `[${formatClock(seconds)}] `;

/** Your notes' field (on the live page or in the drawer) carries this, so Mark can type at the cursor. */
export const NOTES_FIELD = "data-your-notes";

/** One press arriving twice (the key in the window and the global shortcut), or held down: one mark. */
const PRESS_GAP_MS = 400;
let lastPress = -Infinity;
let lastStamp = -1;

/**
 * Drops a mark at the current time. With your notes focused it types "[12:40] " at the
 * cursor (one ⌘Z takes it back); otherwise it starts a new line at the end. Returns the
 * second it marked, or null when nothing is recording.
 */
export function markMoment(): number | null {
  const s = getSession();
  if (!isLive(s) || s.phase === "stopping") return null;
  const now = performance.now();
  if (now - lastPress < PRESS_GAP_MS) return null;
  lastPress = now;
  const at = s.seconds;
  // Twice in the same second is still one moment.
  if (at === lastStamp && s.notes.includes(`[${formatClock(at)}]`)) return at;
  lastStamp = at;
  const stamp = momentStamp(at);

  const field = document.activeElement;
  if (field instanceof HTMLTextAreaElement && field.hasAttribute(NOTES_FIELD)) {
    const before = field.value.slice(0, field.selectionStart);
    // On a line of its own unless you're mid-sentence.
    const lead = before && !/\s$/.test(before) ? " " : "";
    // execCommand keeps the browser's undo; React sees an ordinary input event.
    if (document.execCommand("insertText", false, lead + stamp)) return at;
    const { selectionStart: a, selectionEnd: b, value } = field;
    setNotes(value.slice(0, a) + lead + stamp + value.slice(b));
    requestAnimationFrame(() => field.setSelectionRange(a + lead.length + stamp.length, a + lead.length + stamp.length));
    return at;
  }
  const text = s.notes;
  setNotes(text + (text && !text.endsWith("\n") ? "\n" : "") + stamp);
  return at;
}

const listeners = new Set<(at: number) => void>();

/** Hears each mark (the pill uses it to say where the mark went). */
export function onMark(fn: (at: number) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Mark, then tell whoever listens. The button and both shortcuts come here. */
export function mark(): void {
  const at = markMoment();
  if (at !== null) listeners.forEach((l) => l(at));
}

/**
 * ⌘⇧M while recording: a key press in Aftercall, or (Mac app) from any app, through the
 * global shortcut Aftercall holds only while a recording runs. That arrives as
 * shortcut:mark and doesn't bring Aftercall to the front, so marking never takes you
 * out of the call. Mount once (the live pill does).
 */
export function useMarkShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || !e.shiftKey || e.altKey || e.ctrlKey || e.key.toLowerCase() !== "m") return;
      if (!isLive()) return;
      e.preventDefault();
      if (!e.repeat) mark();
    };
    window.addEventListener("keydown", onKey);
    let off: (() => void) | null = null;
    let gone = false;
    if (isDesktop) {
      listen("shortcut:mark", () => mark())
        .then((un) => (gone ? un() : (off = un)))
        .catch(() => {});
    }
    return () => {
      gone = true;
      window.removeEventListener("keydown", onKey);
      off?.();
    };
  }, []);
}
