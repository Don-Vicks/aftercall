import { useCallback, useEffect, useRef, useState } from "react";
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
  YourNotesDrafts,
  type AudioChunk,
  type CalendarEvent,
  type Stage as PipelineStage,
  type TeeCheck,
  type TranscribedChunk,
  type TranscriptCache,
  type WritingProgress,
} from "@aftercall/core";
import { isDesktop, recorder, type SavedRecording } from "./recorder";
import { nearAiKey, nearAiTransport, recordingFiles, serializeNotes, transcriptCache, type SavedNotes } from "./nearai";
import { proofErrorLine, proofMissLine, tryRecordProof } from "./proofs";
import { isFirstProof } from "./firstProof";
import { FirstTransaction } from "./FirstTransaction";
import type { ProofOnChain } from "./near";
import type { Payee } from "@aftercall/core";
import { Button, Pill, SectionTitle } from "./ui";
import { NearAiConnect } from "./NearAiConnect";
import { calendar } from "./calendar";
import { sampleScriptFor } from "./sampleRecordings";
import { FailedPanel, NotesReady, ProcessHeader, ProcessingSteps, STEP_IDS, StoppedPill, type StepId } from "./recording/processing";
import { notesDigest, statsFromChunks, type NotesDigest, type TranscriptStats } from "./notesDigest";
import { markFresh } from "./freshItems";
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

type Run =
  | { state: "idle" }
  | {
      state: "running";
      at: number;
      part?: string;
      times: number[];
      /** When the running step started (Date.now()). */
      since: number;
      /** Audio parts whose transcript is back, of all of them. */
      parts?: { done: number; total: number };
      /** Counted on this Mac once Whisper is done. */
      transcript?: TranscriptStats;
      /** While the notes are written: parts and tokens received so far. */
      writing?: WritingProgress;
    }
  | {
      state: "done";
      times: number[];
      checks: TeeCheck[];
      onChain: boolean;
      proofNote?: string;
      proofFailed?: boolean;
      /** Set when this proof was this Mac's first on NEAR: the page says what happened. */
      firstTx?: ProofOnChain;
      /** What the notes hold, counted from them as saved. */
      digest: NotesDigest;
      transcript?: TranscriptStats;
    }
  | { state: "failed"; at: number; error: string; times: number[] };

/**
 * Runs live outside the screen, so leaving the page doesn't stop processing or
 * lose its progress, and coming back can't start a second, paid run.
 */
const runs = new Map<string, Run>();
const listeners = new Map<string, Set<(r: Run) => void>>();
/** Hands the notes over and opens the meeting, once per run: Open notes, ↵, or leaving the page. */
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

/** Called once the notes are saved; `proofError` says why the proof didn't go on NEAR when that was an error, not a missing account. */
type OnProcessed = (id: string, notes: string, proofError?: string) => void;
/** Open notes (or ↵, or leaving the done page): show the meeting. */
type OnOpenNotes = (id: string) => void;

async function makeNotes(recording: SavedRecording, payees: Payee[], onProcessed: OnProcessed, onOpenNotes: OnOpenNotes) {
  const id = recording.id;
  const current = runs.get(id)?.state;
  if (current === "running" || current === "done") return;
  // Seconds each step took, measured here as the pipeline reports moving on.
  const times: number[] = [];
  let at = 0;
  let since = performance.now();
  let startedAt = Date.now();
  let part: string | undefined;
  let parts: { done: number; total: number } | undefined;
  let transcript: TranscriptStats | undefined;
  let writing: WritingProgress | undefined;
  const show = () => report(id, { state: "running", at, part, times: [...times], since: startedAt, parts, transcript, writing });
  const moveTo = (step: StepId, detail?: string) => {
    for (const next = STEP_IDS.indexOf(step); at < next; at++) {
      times[at] = (performance.now() - since) / 1000;
      since = performance.now();
      startedAt = Date.now();
    }
    part = step === "transcribe" ? detail : undefined;
    show();
  };
  // Each part's transcript as it comes back (from Whisper or this Mac's cache), so the bar
  // fills and the transcript can be counted here. Counts only leave this function.
  const heard: TranscribedChunk[] = [];
  const keep = (c: AudioChunk, raw: string) => {
    try {
      heard.push({ speaker: c.speaker, index: c.index, result: JSON.parse(raw) });
    } catch {
      // The pipeline reads it too, and stops with the error if it's broken.
    }
    if (parts) parts = { ...parts, done: Math.min(parts.done + 1, parts.total) };
    show();
  };
  const cache = transcriptCache(id);
  const watched: TranscriptCache = {
    get: async (c) => {
      const raw = await cache.get(c);
      if (raw !== null) keep(c, raw);
      return raw;
    },
    set: async (c, raw) => {
      keep(c, raw);
      await cache.set(c, raw);
    },
  };
  show();
  try {
    // Exactly what you last typed, saved to your-notes.json first, so the model, the
    // proof's salted hash and the file agree. The list's copy can be older.
    const yourNotes = await drafts.forRun(id, recording.yourNotes).catch((e) => {
      throw new Error(`Couldn't save your notes, so nothing was sent: ${e instanceof Error ? e.message : String(e)}`);
    });
    const chunks = await recordingFiles.chunks(id);
    if (chunks.length === 0) throw new Error("This recording has no audio left to transcribe.");
    parts = { done: 0, total: chunks.length };
    // The calendar event names the meeting and fills recap addresses afterwards; its
    // guests' names (never their emails) also help the model spell who spoke, inside the
    // encrypted request. A sample is a made-up call: it never takes a real event's guests.
    const event = recording.label ? null : await calendar.eventFor(recording);
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
        transcriptCache: watched,
        // What you typed during the call: context for the model, covered by the proof's salted hash.
        yourNotes,
        // Your "I've told everyone" tick goes into the proof as your statement. A sample is a made-up call: none.
        notice: recording.label ? undefined : recording.notice,
        participants: event?.attendees.map((a) => a.name).filter(Boolean),
      },
      (stage: PipelineStage, detail?: string, progress?: WritingProgress) => {
        if (stage === "summarise" && heard.length) {
          transcript = statsFromChunks(heard, 300);
          heard.length = 0;
        }
        if (stage === "summarise" && progress) writing = progress;
        // The notes report progress often; only a new step moves the list on.
        if (stage === "summarise" && at === STEP_IDS.indexOf("summarise")) return show();
        moveTo(stage, detail);
      },
    );
    heard.length = 0;
    // The calendar event names the meeting and fills recap addresses. The proof
    // doesn't cover either, so this changes nothing on the Verify page.
    const meeting = event ? applyCalendarEvent(result.meeting, event) : result.meeting;
    let saved: SavedNotes = { ...result, meeting, processedAt: new Date().toISOString() };
    await recordingFiles.saveNotes(id, serializeNotes(saved));
    // The notes are saved, so the audio goes now, before the proof's NEAR transaction:
    // quitting during that step mustn't leave it behind (the app also sweeps at launch).
    moveTo("deleted");
    await recordingFiles.deleteAudio(id);

    moveTo("proof");
    // A failed proof doesn't lose the notes: it can be recorded later from the Verify sheet,
    // and the step and the meeting say why it failed.
    const proof = await tryRecordProof(id, saved);
    saved = proof.saved;
    const proofNote = proof.missed ? proofMissLine(proof.missed) : undefined;
    const proofError = proof.missed?.why === "error" ? proofErrorLine(proof.missed.error) : undefined;
    times[STEP_IDS.length - 1] = (performance.now() - since) / 1000;

    const notes = serializeNotes(saved);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      finishers.delete(id);
      report(id, { state: "idle" });
      onOpenNotes(id);
    };
    finishers.set(id, finish);
    const firstTx = saved.onChain && isFirstProof(id) ? saved.onChain : undefined;
    report(id, {
      state: "done",
      times: [...times],
      checks: result.checks,
      onChain: Boolean(saved.onChain),
      proofNote,
      proofFailed: Boolean(proofError),
      firstTx,
      digest: notesDigest(meeting),
      transcript,
    });
    // The app has the notes at once (Today, the sidebar and autopilot see them); only the
    // move to the meeting page waits for Open notes.
    onProcessed(id, notes, proofError);
    // Everything in these notes is new until the meeting page has shown it.
    markFresh(meeting);
    void notesReady(meeting);
    // Nothing moves on by itself while this page is on screen: Open notes or ↵ opens the
    // notes. Away from the page (or once it's left), they're handed over at once.
    if (!listeners.get(id)?.size) finish();
  } catch (e) {
    report(id, { state: "failed", at, error: plainNearAiError(e), times: [...times] });
  }
}

/** True while a recording's notes are being made, wherever the user is in the app. */
export function isProcessing(id: string): boolean {
  return runs.get(id)?.state === "running";
}

/** Your notes typed on this page after the call, by recording, so they survive leaving it. */
const drafts = new YourNotesDrafts((id, text) => recorder.saveYourNotes(id, text));

/**
 * A real recording that has no notes yet. With a NEAR AI key it runs the notes
 * pipeline (by itself after "Stop and make notes"), records the proof on NEAR and
 * deletes the audio: V2Processing while it runs, V2Failed if it stops.
 */
export function RecordingScreen({
  recording,
  payees,
  onProcessed,
  onOpenNotes,
  onDelete,
}: {
  recording: SavedRecording;
  payees: Payee[];
  /** Called once the notes are saved, even if the user has left this screen. */
  onProcessed: OnProcessed;
  onOpenNotes: OnOpenNotes;
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
    void makeNotes(recording, payees, onProcessed, onOpenNotes);
  };

  useEffect(() => {
    showingRecording(recording.id, true);
    return () => {
      showingRecording(recording.id, false);
      // Done and waiting for Open notes, and the page is left: hand the notes over now.
      if (runs.get(recording.id)?.state === "done") finishers.get(recording.id)?.();
    };
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

  const openNotes = useCallback(() => finishers.get(recording.id)?.(), [recording.id]);

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
            <ProcessingSteps view={{ at: run.at, times: run.times, part: run.part, parts: run.parts, transcript: run.transcript, writing: run.writing, since: run.since, others: one }} />
            <p className="m-0 text-ink-2">You can leave this page. Aftercall tells you when your notes are ready.</p>
          </>
        ) : run.state === "done" ? (
          <>
            <ProcessHeader eyebrow={eyebrow} title={title} />
            <NotesReady checks={run.checks} onChain={run.onChain} proofFailed={run.proofFailed} digest={run.digest} onOpen={openNotes} />
            {run.firstTx && <FirstTransaction onChain={run.firstTx} delay={260} />}
            <ProcessingSteps
              view={{ at: STEP_IDS.length, times: run.times, checks: run.checks, onChain: run.onChain, proofNote: run.proofNote, transcript: run.transcript, others: one }}
            />
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
  const [text, setText] = useState(() => drafts.get(recording.id) ?? recording.yourNotes ?? "");
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(text);
  // Leaving the page saves what's still waiting.
  useEffect(() => () => void drafts.flush(recording.id).catch(() => {}), []);
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
          setSave("saving");
          drafts
            .edit(recording.id, value)
            .then(() => latest.current === value && setSave("saved"))
            .catch((e) => {
              if (latest.current !== value) return;
              setSave("error");
              setError(e instanceof Error ? e.message : String(e));
            });
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
