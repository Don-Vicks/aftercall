import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { Meeting } from "@aftercall/core";
import { isDesktop } from "../recorder";
import { toast } from "../primitives";
import { requestOpenMeeting, type RecordingWarning } from "./session";

/** Recording pages on screen right now, by id: their notes open there, so no toast. */
const onScreen = new Set<string>();
export const showingRecording = (id: string, shown: boolean) => void (shown ? onScreen.add(id) : onScreen.delete(id));

/** Told by a notification while away; repeated as a toast on return. */
let missed: { id: string; title: string; detail: string } | null = null;

const toApprove = (m: Meeting) => m.followUps.filter((f) => f.status === "proposed").length;

function detailFor(m: Meeting): string {
  const n = toApprove(m);
  return n === 0 ? "No follow-ups to approve" : `${n} ${n === 1 ? "follow-up" : "follow-ups"} to approve`;
}

async function appFocused(): Promise<boolean> {
  if (!isDesktop) return document.hasFocus();
  return getCurrentWindow()
    .isFocused()
    .catch(() => document.hasFocus());
}

function showToast(id: string, title: string) {
  toast({
    id: `notes-ready:${id}`,
    text: (
      <span>
        <span className="font-semibold">Notes ready</span> <span className="text-muted">·</span> {title}
      </span>
    ),
    announce: `Notes ready: ${title}`,
    tone: "verdigris",
    action: { label: "Open", onClick: () => requestOpenMeeting(id) },
    duration: 8000,
  });
}

/**
 * The notes for a meeting are saved. Away from Aftercall: a macOS notification with
 * the meeting's title and how many follow-ups wait, never its content; the same line
 * comes back as a toast on return. In Aftercall on another page: the toast now.
 */
export async function notesReady(meeting: Meeting) {
  const title = meeting.title;
  if (await appFocused()) {
    if (!onScreen.has(meeting.id)) showToast(meeting.id, title);
    return;
  }
  missed = { id: meeting.id, title, detail: detailFor(meeting) };
  await notify(`Notes ready: ${title}`, missed.detail);
}

/** A macOS notification, asking for permission the first time. Off or refused: nothing. */
async function notify(title: string, body: string) {
  if (!isDesktop) return;
  try {
    const granted = (await isPermissionGranted()) || (await requestPermission()) === "granted";
    if (granted) sendNotification({ title, body });
  } catch {
    // Notifications off: what they'd say is on screen when you come back.
  }
}

/** What a recording warning says in a notification: which side, and that recording goes on. */
export function warningText(w: RecordingWarning): { title: string; body: string } {
  switch (w.kind) {
    case "mic":
      return {
        title: "Your mic has gone silent",
        body: w.stopped ? "No audio from your mic for 10 s. Aftercall is still recording." : "Only silence from your mic for 30 s. Aftercall is still recording.",
      };
    case "call":
      return { title: "No sound from the call", body: "Nothing from the call's audio for 30 s. Your mic is still recording." };
    case "ended":
      return { title: "Call ended?", body: "No sound from either side for 2 minutes. Aftercall is still recording until you stop it." };
  }
}

/**
 * A recording warning while you're in another app (most likely the call): a macOS
 * notification saying which side went silent. In Aftercall the pill already shows it.
 */
export async function warnAway(w: RecordingWarning) {
  if (await appFocused()) return;
  const { title, body } = warningText(w);
  await notify(title, body);
}

if (typeof window !== "undefined") {
  window.addEventListener("focus", () => {
    if (!missed) return;
    const { id, title } = missed;
    missed = null;
    // A beat after the window settles, so it reads as the app answering.
    window.setTimeout(() => showToast(id, title), 240);
  });
}
