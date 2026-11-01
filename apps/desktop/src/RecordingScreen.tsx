import { useEffect, useRef, useState } from "react";
import { FolderOpen, KeyRound } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  applyCalendarEvent,
  dayWord,
  formatClock,
  formatDuration,
  meetingLabel,
  plainNearAiError,
  processRecording,
  type CalendarEvent,
  type Stage as PipelineStage,
  type TeeCheck,
} from "@aftercall/core";
import { isDesktop, recorder, type SavedRecording } from "./recorder";
import { nearAiKey, nearAiTransport, recordingFiles, serializeNotes, transcriptCache, type SavedNotes } from "./nearai";
import { nearReady, recordProof } from "./proofs";
import type { Payee } from "@aftercall/core";
import { Button, Pill, SectionTitle } from "./ui";
import { NearAiConnect } from "./NearAiConnect";
import { calendar } from "./calendar";
import { sampleScriptFor } from "./sampleRecordings";
import { FailedPanel, ProcessHeader, ProcessingSteps, STEP_IDS, StoppedPill, VerifiedSeal, type StepId } from "./recording/processing";
import { notesReady, showingRecording } from "./recording/notify";
import { forgetAutoProcess, wantsAutoProcess } from "./recording/session";
import { NotesArea, SavedLabel } from "./recording/YourNotes";

export function recordingTitle(r: SavedRecording): string {
  if (r.eventTitle) return r.eventTitle;
  if (r.title) return r.title;
  const d = new Date(r.startedAt * 1000);
  return `Recording ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/** "Today", "Yesterday", "Monday" within the week, then "28 Oct", as meetings say it. */
export function recordingWhen(r: SavedRecording): string {
  return dayWord(r.startedAt * 1000);
}

/** "Yesterday 14:02": the same words the meeting page uses for this recording's meeting. */
export function recordingStartedAt(r: SavedRecording): string {
  return meetingLabel({ id: r.id, startedAt: new Date(r.startedAt * 1000).toISOString() });
}

/** How long the Verified seal shows before the meeting opens by itself. */
const SEAL_MS = 1600;

type Run =
  | { state: "idle" }
  | { state: "running"; at: number; part?: string; times: number[] }
  | { state: "done"; times: number[]; checks: TeeCheck[]; e2ee: boolean; onChain: boolean }
  | { state: "failed"; at: number; error: string; times: number[] };

/**
 * Runs live outside the screen, so leaving the page doesn't stop processing or
 * lose its progress, and coming back can't start a second, paid run.
 */
const runs = new Map<string, Run>();
const listeners = new Map<string, Set<(r: Run) => void>>();
/** Opens the meeting now instead of after the seal, once per run. */
const finishers = new Map<string, () => void>();

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
  const id = recording.id;
  const current = runs.get(id)?.state;
  if (current === "running" || current === "done") return;
  // Seconds each step took, measured here as the pipeline reports moving on.
  const times: number[] = [];
  let at = 0;
  let since = performance.now();
  const moveTo = (step: StepId, part?: string) => {
    for (const next = STEP_IDS.indexOf(step); at < next; at++) {
      times[at] = (performance.now() - since) / 1000;
      since = performance.now();
    }
    report(id, { state: "running", at, part, times: [...times] });
  };
  report(id, { state: "running", at: 0, times: [] });
  try {
    const chunks = await recordingFiles.chunks(id);
    if (chunks.length === 0) throw new Error("This recording has no audio left to transcribe.");
    const result = await processRecording(
      nearAiTransport,
      {
        id,
        project: recording.project,
        // The real time, as ISO: every page formats it when it shows it, so it never goes stale.
        startedAt: new Date(recording.startedAt * 1000).toISOString(),
        durationSec: recording.seconds,
        chunkSeconds: 300,
        chunks,
        payees,
        vocabulary: [recording.project, ...payees.map((p) => p.name)],
        transcriptCache: transcriptCache(id),
        // What you typed during the call: context for the model, covered by the proof's salted hash.
        yourNotes: recording.yourNotes,
        // Your "I've told everyone" tick goes into the proof as your statement. A sample is a made-up call: none.
        notice: recording.label ? undefined : recording.notice,
      },
      (stage: PipelineStage, detail?: string) => moveTo(stage, stage === "transcribe" ? detail : undefined),
    );
    // The calendar event names the meeting and fills recap addresses. The proof
    // doesn't cover either, so this changes nothing on the Verify page.
    // A sample is a made-up call: it never takes the name or guests of a real event.
    const event = recording.label ? null : await calendar.eventFor(recording);
    const meeting = event ? applyCalendarEvent(result.meeting, event) : result.meeting;
    let saved: SavedNotes = { ...result, meeting, processedAt: new Date().toISOString() };
    await recordingFiles.saveNotes(id, serializeNotes(saved));
    // The notes are saved, so the audio goes now, before the proof's NEAR transaction:
    // quitting during that step mustn't leave it behind (the app also sweeps at launch).
    moveTo("deleted");
    await recordingFiles.deleteAudio(id);

    moveTo("proof");
    // A failed proof doesn't lose the notes: it can be recorded later from the Verify sheet.
    if (await nearReady()) saved = await recordProof(id, saved).catch(() => saved);
    times[STEP_IDS.length - 1] = (performance.now() - since) / 1000;

    const notes = serializeNotes(saved);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      finishers.delete(id);
      report(id, { state: "idle" });
      onProcessed(id, notes);
    };
    finishers.set(id, finish);
    report(id, { state: "done", times: [...times], checks: result.checks, e2ee: result.proof.e2ee.used, onChain: Boolean(saved.onChain) });
    void notesReady(meeting);
    // The seal shows for a moment, then the meeting opens (Open notes skips the wait).
    window.setTimeout(finish, SEAL_MS);
  } catch (e) {
    report(id, { state: "failed", at, error: plainNearAiError(e), times: [...times] });
  }
}

/** True while a recording's notes are being made, wherever the user is in the app. */
export function isProcessing(id: string): boolean {
  return runs.get(id)?.state === "running";
}

/** Your notes typed on this page after the call, by recording, so they survive leaving it. */
const editedNotes = new Map<string, string>();

/**
 * A real recording that has no notes yet. With a NEAR AI key it runs the notes
 * pipeline (by itself after "Stop and make notes"), records the proof on NEAR and
 * deletes the audio: V2Processing while it runs, V2Failed if it stops.
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
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  // Stopped with "Stop and make notes": make them as soon as NEAR AI is there.
  const [auto] = useState(() => wantsAutoProcess(recording.id));
  const start = () => {
    forgetAutoProcess(recording.id);
    void makeNotes(recording, payees, onProcessed);
  };

  useEffect(() => {
    showingRecording(recording.id, true);
    return () => showingRecording(recording.id, false);
  }, [recording.id]);

  useEffect(() => {
    if (!isDesktop) return;
    nearAiKey
      .has()
      .then((has) => {
        setHasKey(has);
        if (has && auto && !runs.has(recording.id)) start();
      })
      .catch(() => setHasKey(false));
    if (!recording.label) calendar.eventFor(recording).then(setEvent);
  }, []);

  const others = (event?.attendees ?? []).map((a) => a.name || a.email.split("@")[0]).filter(Boolean);
  const eyebrow = [
    recording.project,
    recordingStartedAt(recording),
    formatDuration(recording.seconds),
    others.length === 1 ? `You and ${others[0]}` : others.length > 1 ? `You and ${others.length} others` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const title = recordingTitle(recording);
  const one = others.length === 1 ? others[0] : undefined;

  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
      <div className={`mx-auto flex flex-col gap-8 px-12 pt-5 pb-16 ${run.state === "failed" ? "max-w-[800px]" : "max-w-[680px]"}`}>
        {run.state === "failed" ? (
          <>
            <ProcessHeader eyebrow={eyebrow} title={title} lede="Processing stopped before your notes were written." pill={<StoppedPill />} />
            <FailedPanel view={{ at: run.at, times: run.times, others: one }} error={run.error} onRetry={hasKey ? start : undefined} />
            {isDesktop && hasKey === false && <KeyForm onSaved={() => setHasKey(true)} />}
          </>
        ) : run.state === "running" ? (
          <>
            <ProcessHeader eyebrow={eyebrow} title={title} lede="Making your notes in NEAR AI secure hardware. Every step is checked as it happens." />
            <ProcessingSteps view={{ at: run.at, times: run.times, part: run.part, others: one }} />
            <p className="m-0 text-ink-2">You can leave this page. Aftercall tells you when your notes are ready.</p>
          </>
        ) : run.state === "done" ? (
          <>
            <ProcessHeader eyebrow={eyebrow} title={title} lede="Your notes are ready." />
            <VerifiedSeal checks={run.checks} onChain={run.onChain} onOpen={() => finishers.get(recording.id)?.()} />
            <ProcessingSteps view={{ at: STEP_IDS.length, times: run.times, checks: run.checks, e2ee: run.e2ee, onChain: run.onChain, others: one }} />
          </>
        ) : (
          <>
            <ProcessHeader
              eyebrow={eyebrow}
              title={title}
              pill={
                <span className="flex items-center gap-2">
                  {recording.label && <Pill tone="muted">{recording.label}</Pill>}
                  <Pill tone="muted">Waiting for notes</Pill>
                </span>
              }
              lede={
                isDesktop
                  ? "Your audio is saved on this Mac, encrypted. Notes are made inside NEAR AI's secure hardware, then the audio is deleted."
                  : "This sample's audio is in the repo, in samples/. In the Mac app, notes are made inside NEAR AI's secure hardware."
              }
            />
            {!isDesktop && (
              <p role="note" className="m-0 rounded-sm bg-well p-4 text-ink-2">
                This is the browser preview, so there is no audio here to process. To make notes from this sample, open it in the Mac app (pnpm dev:desktop)
                with a NEAR AI key, or run <span className="t-mono">pnpm sample:notes</span> in the repo with <span className="t-mono">NEAR_AI_API_KEY</span> in
                .env.
              </p>
            )}
            {isDesktop && hasKey === false && (
              <KeyForm
                onSaved={() => {
                  setHasKey(true);
                  if (auto) start();
                }}
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {isDesktop && (
                  <Button
                    onClick={() => revealItemInDir(`${recording.dir}/meeting.json`)}
                    icon={<FolderOpen size={14} strokeWidth={1.75} aria-hidden="true" />}
                  >
                    Show in Finder
                  </Button>
                )}
                <Button variant="quiet" className="px-1 hover:text-record" onClick={onDelete}>
                  Delete
                </Button>
              </div>
              {hasKey && (
                <Button variant="primary" onClick={start}>
                  Make notes
                </Button>
              )}
            </div>
            {isDesktop && !recording.label && <WaitingNotes recording={recording} />}
          </>
        )}

        {script && run.state !== "done" && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <SectionTitle>What this sample call says</SectionTitle>
              <span className="text-ink-2">{script.fictional} Compare it with the notes once they're made.</span>
            </div>
            <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
              {script.lines.map((l) => (
                <li key={l.at} className="grid grid-cols-[44px_minmax(0,1fr)] gap-3">
                  <span className="t-mono text-muted">{formatClock(Math.floor(l.at))}</span>
                  <span>
                    <span className="font-semibold text-ink">{l.speaker === "you" ? "You" : l.name}</span>
                    <span className="text-muted"> · {l.speaker === "you" ? "microphone" : "call audio"}</span>
                    <span className="t-reading block text-ink">{l.text}</span>
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

/** Your notes from the call, still editable until the notes are made (save_your_notes). */
function WaitingNotes({ recording }: { recording: SavedRecording }) {
  const [text, setText] = useState(() => editedNotes.get(recording.id) ?? recording.yourNotes ?? "");
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef(0);
  const latest = useRef(text);
  const write = (value: string) =>
    recorder
      .saveYourNotes(recording.id, value)
      .then(() => latest.current === value && setSave("saved"))
      .catch((e) => {
        setSave("error");
        setError(e instanceof Error ? e.message : String(e));
      });
  // Leaving the page saves what's still waiting.
  useEffect(
    () => () => {
      if (!timer.current) return;
      window.clearTimeout(timer.current);
      void recorder.saveYourNotes(recording.id, latest.current).catch(() => {});
    },
    [],
  );
  return (
    <section aria-labelledby="waiting-notes" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <SectionTitle id="waiting-notes">
          Your notes <span className="font-medium text-muted">only you write here</span>
        </SectionTitle>
        <SavedLabel save={save} error={error} />
      </div>
      <NotesArea
        aria-labelledby="waiting-notes"
        value={text}
        rows={5}
        className="min-h-[160px]"
        placeholder="Anything to add before the notes are made…"
        onChange={(e) => {
          const value = e.target.value;
          setText(value);
          latest.current = value;
          editedNotes.set(recording.id, value);
          setSave("saving");
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => {
            timer.current = 0;
            void write(value);
          }, 600);
        }}
      />
    </section>
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
