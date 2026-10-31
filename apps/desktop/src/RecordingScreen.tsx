import { useEffect, useState } from "react";
import { Check, FolderOpen, KeyRound } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { applyCalendarEvent, formatClock, formatDuration, processRecording, type Stage } from "@aftercall/core";
import type { SavedRecording } from "./recorder";
import { nearAiKey, nearAiTransport, recordingFiles, serializeNotes, transcriptCache, type SavedNotes } from "./nearai";
import { nearReady, recordProof } from "./proofs";
import type { Payee } from "@aftercall/core";
import { Button, Pill, Spinner, cx } from "./ui";
import { NearAiConnect } from "./NearAiConnect";
import { calendar } from "./calendar";
import { isDesktop } from "./recorder";
import { sampleScriptFor } from "./sampleRecordings";

export function recordingTitle(r: SavedRecording): string {
  if (r.eventTitle) return r.eventTitle;
  if (r.title) return r.title;
  const d = new Date(r.startedAt * 1000);
  return `Recording ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function recordingWhen(r: SavedRecording): string {
  const d = new Date(r.startedAt * 1000);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? "Today" : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

export function recordingStartedAt(r: SavedRecording): string {
  const d = new Date(r.startedAt * 1000);
  return `${recordingWhen(r)} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

const STAGES: { id: Stage | "proof" | "deleted"; title: string; detail: string }[] = [
  { id: "attest", title: "Secure hardware checked", detail: "Whisper and Qwen3.8-27B attested with a fresh nonce" },
  { id: "transcribe", title: "Transcribed", detail: "Whisper in NEAR AI secure hardware; You and Others kept apart" },
  { id: "summarise", title: "Writing the notes", detail: "Decisions, action items and follow-ups, each with an exact quote" },
  { id: "signature", title: "Signature checked", detail: "Summary signed by the attested model" },
  { id: "proof", title: "Proof recorded on NEAR", detail: "record_proof from this Mac's limited key" },
  { id: "deleted", title: "Audio deleted from this Mac", detail: "Only the transcript and notes are kept" },
];

type Run = { state: "idle" } | { state: "running"; stage: number; detail?: string } | { state: "failed"; error: string };

/**
 * Runs live outside the screen, so leaving the page doesn't stop processing or
 * lose its progress, and coming back can't start a second, paid run.
 */
const runs = new Map<string, Run>();
const listeners = new Map<string, Set<(r: Run) => void>>();

function report(id: string, r: Run) {
  if (r.state === "idle") runs.delete(id);
  else runs.set(id, r);
  listeners.get(id)?.forEach((l) => l(r));
}

function useRun(id: string): Run {
  const [run, setRun] = useState<Run>(runs.get(id) ?? { state: "idle" });
  useEffect(() => {
    const set = listeners.get(id) ?? new Set();
    listeners.set(id, set);
    set.add(setRun);
    setRun(runs.get(id) ?? { state: "idle" });
    return () => void set.delete(setRun);
  }, [id]);
  return run;
}

async function makeNotes(recording: SavedRecording, payees: Payee[], onProcessed: (id: string, notes: string) => void) {
  if (runs.get(recording.id)?.state === "running") return;
  const order = STAGES.map((s) => s.id);
  report(recording.id, { state: "running", stage: 0 });
  try {
    const chunks = await recordingFiles.chunks(recording.id);
    if (chunks.length === 0) throw new Error("This recording has no audio left to transcribe.");
    const result = await processRecording(
      nearAiTransport,
      {
        id: recording.id,
        project: recording.project,
        startedAt: recordingStartedAt(recording),
        durationSec: recording.seconds,
        chunkSeconds: 300,
        chunks,
        payees,
        vocabulary: [recording.project, ...payees.map((p) => p.name)],
        transcriptCache: transcriptCache(recording.id),
      },
      (stage, detail) => report(recording.id, { state: "running", stage: order.indexOf(stage), detail }),
    );
    // The calendar event names the meeting and fills recap addresses. The proof
    // doesn't cover either, so this changes nothing on the Verify page.
    // A sample is a made-up call: it never takes the name or guests of a real event.
    const event = recording.label ? null : await calendar.eventFor(recording);
    const meeting = event ? applyCalendarEvent(result.meeting, event) : result.meeting;
    let saved: SavedNotes = { ...result, meeting, processedAt: new Date().toISOString() };
    await recordingFiles.saveNotes(recording.id, serializeNotes(saved));

    report(recording.id, { state: "running", stage: order.indexOf("proof") });
    if (await nearReady()) {
      // A failed proof doesn't lose the notes: it can be recorded later from the Verify sheet.
      saved = await recordProof(recording.id, saved).catch(() => saved);
    }

    report(recording.id, { state: "running", stage: order.indexOf("deleted") });
    await recordingFiles.deleteAudio(recording.id);
    report(recording.id, { state: "idle" });
    onProcessed(recording.id, serializeNotes(saved));
  } catch (e) {
    report(recording.id, { state: "failed", error: e instanceof Error ? e.message : String(e) });
  }
}

/** True while a recording's notes are being made, wherever the user is in the app. */
export function isProcessing(id: string): boolean {
  return runs.get(id)?.state === "running";
}

/**
 * A real recording that has no notes yet. With a NEAR AI key it runs the notes
 * pipeline, records the proof on NEAR and deletes the audio.
 */
export function RecordingScreen({
  recording,
  payees,
  onProcessed,
  onDelete,
}: {
  recording: SavedRecording;
  payees: Payee[];
  /** Called once the notes are saved, even if the user has left this screen. */
  onProcessed: (id: string, notes: string) => void;
  onDelete: () => void;
}) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const run = useRun(recording.id);
  const script = sampleScriptFor(recording);

  useEffect(() => {
    if (isDesktop) nearAiKey.has().then(setHasKey).catch(() => setHasKey(false));
  }, []);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
      <div className="mx-auto flex max-w-[680px] flex-col gap-8 px-12 pb-16">
        <header className="flex flex-col gap-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="t-label text-muted">
              {recording.project} · {recordingWhen(recording)} · {formatDuration(recording.seconds)}
            </span>
            <span className="flex items-center gap-2">
              {recording.label && <Pill tone="muted">{recording.label}</Pill>}
              {run.state === "failed" ? <Pill tone="record">Stopped</Pill> : <Pill tone="muted">Waiting for notes</Pill>}
            </span>
          </div>
          <h1 className="t-display m-0">{recordingTitle(recording)}</h1>
          <p className="t-reading m-0 text-muted">
            {run.state === "running"
              ? "Your notes are being made inside NEAR AI's secure hardware. Nothing leaves it except the result."
              : isDesktop
                ? "Your audio is saved on this Mac. Notes are made inside NEAR AI's secure hardware, then the audio is deleted."
                : "This sample's audio is in the repo, in samples/. In the Mac app, notes are made inside NEAR AI's secure hardware."}
          </p>
        </header>

        {!isDesktop && (
          <p role="note" className="m-0 rounded-sm bg-well p-4 text-muted">
            This is the browser preview, so there is no audio here to process. To make notes from this sample, open it in the Mac app
            (pnpm dev:desktop) with a NEAR AI key, or run <span className="t-mono">pnpm sample:notes</span> in the repo with{" "}
            <span className="t-mono">NEAR_AI_API_KEY</span> in .env.
          </p>
        )}

        {isDesktop && run.state === "idle" && hasKey === false && <KeyForm onSaved={() => setHasKey(true)} />}

        {run.state !== "idle" && (
          <ol className="m-0 flex list-none flex-col p-0" aria-live="polite">
            {STAGES.map((s, i) => {
              const current = run.state === "running" ? run.stage : -1;
              const done = run.state === "running" && i < current;
              const active = run.state === "running" && i === current;
              return (
                <li
                  key={s.id}
                  className={cx("grid grid-cols-[28px_minmax(0,1fr)] items-baseline gap-3 border-t border-hairline py-3.5", i === STAGES.length - 1 && "border-b")}
                >
                  <span className="self-center">
                    {done ? (
                      <Check size={16} strokeWidth={1.75} className="text-verdigris" aria-label="Done" />
                    ) : active ? (
                      <Spinner />
                    ) : (
                      <span aria-hidden="true" className="block size-3.5 rounded-full border-[1.5px] border-faint" />
                    )}
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <span className={cx("t-title", !done && !active && "text-muted")}>
                      {s.title}
                      {active && run.state === "running" && run.detail ? ` · ${run.detail}` : ""}
                    </span>
                    <span className="text-muted">{s.detail}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {run.state === "failed" && (
          <div role="alert" className="flex flex-col gap-2 rounded-sm bg-record-tint p-4 text-record">
            <span className="t-title">Processing stopped</span>
            <span className="selectable break-words">{run.error}</span>
            <span className="text-muted">Your audio is still on this Mac. Nothing was sent anywhere else.</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {isDesktop && (
              <Button onClick={() => revealItemInDir(`${recording.dir}/meeting.json`)}>
                <FolderOpen size={14} strokeWidth={1.75} aria-hidden="true" />
                Show in Finder
              </Button>
            )}
            {run.state !== "running" && (
              <button onClick={onDelete} className="font-semibold text-muted hover:text-record">
                Delete
              </button>
            )}
          </div>
          {hasKey && run.state !== "running" && (
            <Button variant="primary" onClick={() => makeNotes(recording, payees, onProcessed)}>
              {run.state === "failed" ? "Try again" : "Make notes"}
            </Button>
          )}
        </div>

        {script && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="t-label text-muted">What this sample call says</span>
              <span className="text-muted">{script.fictional} Compare it with the notes once they're made.</span>
            </div>
            <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
              {script.lines.map((l) => (
                <li key={l.at} className="grid grid-cols-[44px_minmax(0,1fr)] gap-3">
                  <span className="t-mono text-faint">{formatClock(Math.floor(l.at))}</span>
                  <span>
                    <span className="font-semibold">{l.speaker === "you" ? "You" : l.name}</span>
                    <span className="text-muted"> · {l.speaker === "you" ? "microphone" : "call audio"}</span>
                    <span className="t-reading block">{l.text}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </main>
  );
}

/** Connects NEAR AI right where it's needed. */
function KeyForm({ onSaved }: { onSaved: () => void }) {
  return (
    <section className="flex flex-col gap-3 rounded-md p-5 shadow-[inset_0_0_0_1px_var(--hairline)]">
      <div className="flex items-center gap-2.5">
        <KeyRound size={16} strokeWidth={1.5} className="text-muted" aria-hidden="true" />
        <span className="t-title">Connect NEAR AI to make notes</span>
      </div>
      <NearAiConnect compact onConnected={onSaved} />
    </section>
  );
}
