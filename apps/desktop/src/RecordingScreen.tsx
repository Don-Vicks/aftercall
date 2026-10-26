import { useEffect, useState } from "react";
import { Check, FolderOpen, KeyRound } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { formatDuration, processRecording, type Stage } from "@aftercall/core";
import type { SavedRecording } from "./recorder";
import { nearAiKey, nearAiTransport, recordingFiles, serializeNotes, transcriptCache, type SavedNotes } from "./nearai";
import { nearReady, recordProof } from "./proofs";
import type { Payee } from "@aftercall/core";
import { Button, Pill, Spinner, cx } from "./ui";

export function recordingTitle(r: SavedRecording): string {
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
 * A real recording that has no notes yet. With a NEAR AI key it runs the notes
 * pipeline; the proof on NEAR follows in M3.
 */
export function RecordingScreen({ recording, payees, onProcessed, onDelete }: { recording: SavedRecording; payees: Payee[]; onProcessed: (notes: string) => void; onDelete: () => void }) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [run, setRun] = useState<Run>({ state: "idle" });

  useEffect(() => {
    nearAiKey.has().then(setHasKey).catch(() => setHasKey(false));
  }, []);

  const makeNotes = async () => {
    const order = STAGES.map((s) => s.id);
    setRun({ state: "running", stage: 0 });
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
        (stage, detail) => setRun({ state: "running", stage: order.indexOf(stage), detail }),
      );
      let saved: SavedNotes = { ...result, processedAt: new Date().toISOString() };
      await recordingFiles.saveNotes(recording.id, serializeNotes(saved));

      setRun({ state: "running", stage: order.indexOf("proof") });
      if (await nearReady()) {
        // A failed proof doesn't lose the notes: it can be recorded later from the Verify sheet.
        saved = await recordProof(recording.id, saved).catch(() => saved);
      }

      setRun({ state: "running", stage: order.indexOf("deleted") });
      await recordingFiles.deleteAudio(recording.id);
      onProcessed(serializeNotes(saved));
    } catch (e) {
      setRun({ state: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
      <div className="mx-auto flex max-w-[680px] flex-col gap-8 px-12 pb-16">
        <header className="flex flex-col gap-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="t-label text-muted">
              {recording.project} · {recordingWhen(recording)} · {formatDuration(recording.seconds)}
            </span>
            {run.state === "failed" ? <Pill tone="record">Stopped</Pill> : <Pill tone="muted">Waiting for notes</Pill>}
          </div>
          <h1 className="t-display m-0">{recordingTitle(recording)}</h1>
          <p className="t-reading m-0 text-muted">
            {run.state === "running"
              ? "Your notes are being made inside NEAR AI's secure hardware. Nothing leaves it except the result."
              : "Your audio is saved on this Mac. Notes are made inside NEAR AI's secure hardware, then the audio is deleted."}
          </p>
        </header>

        {run.state === "idle" && hasKey === false && <KeyForm onSaved={() => setHasKey(true)} />}

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
            <Button onClick={() => revealItemInDir(`${recording.dir}/meeting.json`)}>
              <FolderOpen size={14} strokeWidth={1.75} aria-hidden="true" />
              Show in Finder
            </Button>
            {run.state !== "running" && (
              <button onClick={onDelete} className="font-semibold text-muted hover:text-record">
                Delete
              </button>
            )}
          </div>
          {hasKey && run.state !== "running" && (
            <Button variant="primary" onClick={makeNotes}>
              {run.state === "failed" ? "Try again" : "Make notes"}
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}

/** Saves the NEAR AI API key to the macOS Keychain. It never leaves the Rust side again. */
function KeyForm({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await nearAiKey.set(key);
      setKey("");
      onSaved();
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <section className="flex flex-col gap-3 rounded-md p-5 shadow-[inset_0_0_0_1px_var(--hairline)]">
      <div className="flex items-center gap-2.5">
        <KeyRound size={16} strokeWidth={1.5} className="text-muted" aria-hidden="true" />
        <span className="t-title">Connect NEAR AI</span>
      </div>
      <p className="m-0 text-muted">
        Paste an API key from cloud.near.ai (set a spend limit on it). It's stored in your macOS Keychain and only used to call NEAR AI's
        secure models.
      </p>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="nearai-key">
          NEAR AI API key
        </label>
        <input
          id="nearai-key"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-…"
          className="selectable h-8 flex-1 rounded-sm border border-border bg-well px-2.5 text-ink outline-none placeholder:text-muted"
        />
        <Button variant="primary" onClick={save} disabled={key.trim().length < 16}>
          Save key
        </Button>
      </div>
      {error && <p className="m-0 text-record">{error}</p>}
    </section>
  );
}
