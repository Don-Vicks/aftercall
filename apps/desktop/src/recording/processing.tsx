import { useEffect, useState, type ReactNode } from "react";
import * as m from "motion/react-m";
import { Lock, ShieldAlert, X } from "lucide-react";
import type { TeeCheck } from "@aftercall/core";
import type { NotesDigest, TranscriptStats } from "../notesDigest";
import { Button, Pill, RollingNumber, StageList, anyLayerOpen, cx, springs, type Stage, type StageState } from "../ui";

/**
 * The processing page's parts, shared by the real pipeline (RecordingScreen) and the
 * browser preview's walk-through (ProcessingScreen): the steps as they tick in, the
 * Verified seal at the end, and where it stopped when it fails.
 */

/**
 * The steps, in the order they run: the pipeline's four stages, then the app deletes
 * the audio as soon as the notes are saved, then records the proof on NEAR.
 */
export type StepId = "attest" | "transcribe" | "summarise" | "signature" | "deleted" | "proof";
export const STEP_IDS: StepId[] = ["attest", "transcribe", "summarise", "signature", "deleted", "proof"];

export interface StepsView {
  /** Index of the step running, or where it stopped; STEP_IDS.length once finished. */
  at: number;
  failed?: boolean;
  /** Seconds each finished step took. */
  times: (number | undefined)[];
  /** "2 of 4" while transcribing: the part being sent, as the pipeline reports it. */
  part?: string;
  /** While transcribing: parts whose transcript is back, of all of them. */
  parts?: { done: number; total: number };
  /** Once transcribed: how long the transcript is and who spoke how much (counted on this Mac). */
  transcript?: TranscriptStats;
  /** When the running step started (Date.now()), for its time so far. */
  since?: number;
  /** Who was on the call, for "You and Ines kept apart". */
  others?: string;
  /** Known once finished: */
  checks?: TeeCheck[];
  /** False when no proof went on chain: NEAR isn't connected, or recording it failed. */
  onChain?: boolean;
  /** Why the proof isn't on NEAR, when it isn't ("Connect your NEAR account…", or the error). */
  proofNote?: string;
}

const label: Record<StepId, { done: string; doing: string }> = {
  attest: { done: "Secure hardware checked", doing: "Secure hardware checked" },
  transcribe: { done: "Transcribed", doing: "Transcribing" },
  summarise: { done: "Notes written", doing: "Writing the notes" },
  signature: { done: "Signature checked", doing: "Signature checked" },
  proof: { done: "Proof recorded on NEAR", doing: "Proof recorded on NEAR" },
  deleted: { done: "Audio deleted from this Mac", doing: "Audio deleted from this Mac" },
};

function detail(id: StepId, v: StepsView): string {
  switch (id) {
    case "attest":
      return "Gateway, Whisper and Qwen TEEs, each against a fresh nonce";
    case "transcribe":
      return `Whisper in secure hardware · You and ${v.others ?? "the call"} kept apart`;
    case "summarise":
      return "Transcript sealed on this Mac for the attested Qwen TEE; each item needs a quote from the call";
    case "signature":
      return "Signed over the exact request and response by the attested key";
    case "proof":
      return v.onChain === false ? (v.proofNote ?? "Record it on NEAR from Verify") : "A hash only; no meeting content goes on chain";
    case "deleted":
      return "Only the encrypted transcript and notes stay";
  }
}

/** "0.8 s", "41 s", "2 min 5 s". */
export function stepTime(s: number | undefined): string {
  if (s === undefined) return "";
  if (s < 10) return `${s.toFixed(1)} s`;
  if (s < 60) return `${Math.round(s)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

// Chips: the checks a step ran, by kind, once the run has its results.
const chipKinds: Record<string, string> = {
  tdx: "Intel TDX quote",
  debug: "Debug off",
  "binds-key": "Key bound",
  "binds-nonce": "Nonce bound",
  rtmr3: "Software",
  compose: "Software",
  gpu: "NVIDIA GPUs",
  "gpu-nonce": "NVIDIA GPUs",
  "gpu-secure": "NVIDIA GPUs",
  request: "Request hash",
  response: "Response hash",
  model: "Model named",
  signer: "Attested signer",
};

/** "model-openai/whisper-large-v3-binds-key-2" → "binds-key". */
function kindOf(c: TeeCheck): string {
  const prefix = c.scope === "gateway" ? "gateway-" : c.scope === "model" ? `model-${c.model}-` : "response-";
  return c.id.startsWith(prefix) ? c.id.slice(prefix.length).replace(/-\d+$/, "") : "";
}

function chips(id: StepId, checks: TeeCheck[] | undefined): ReactNode {
  if (!checks || (id !== "attest" && id !== "signature")) return null;
  const scope = id === "attest" ? (c: TeeCheck) => c.scope !== "response" : (c: TeeCheck) => c.scope === "response" && c.id !== "response-e2ee";
  const kinds = new Map<string, boolean>();
  for (const c of checks.filter(scope)) {
    const name = chipKinds[kindOf(c)];
    if (name) kinds.set(name, (kinds.get(name) ?? true) && c.ok);
  }
  if (kinds.size === 0) return null;
  return (
    <span className="mt-0.5 flex flex-wrap gap-1.5">
      {[...kinds].map(([name, ok], i) => (
        <span
          key={name}
          className={cx(
            "inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium",
            ok ? "bg-verdigris-tint text-verdigris" : "bg-record-tint text-record",
          )}
          style={{ animation: `ac-pop 240ms ${i * 60}ms var(--ease) both` }}
        >
          {ok ? <TinyCheck /> : <X size={11} strokeWidth={3} aria-hidden="true" />}
          {name}
          {!ok && <span className="sr-only"> failed</span>}
        </span>
      ))}
    </span>
  );
}

const TinyCheck = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

/** "3 of 8" from the pipeline's "3 of 8", or from the parts done. */
function partOf(v: StepsView): { at: number; total: number } | null {
  const said = v.part?.match(/^(\d+) of (\d+)$/);
  if (said) return { at: Number(said[1]), total: Number(said[2]) };
  return v.parts ? { at: Math.min(v.parts.done + 1, v.parts.total), total: v.parts.total } : null;
}

/** Transcribing: a bar that fills as each part's transcript comes back. */
function PartsBar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <span className="mt-1 flex items-center gap-3">
      <span
        role="progressbar"
        aria-label="Audio transcribed"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={`${done} of ${total} parts transcribed`}
        className="relative h-1.5 max-w-[360px] flex-1 overflow-hidden rounded-full bg-well shadow-[inset_0_0_0_1px_var(--hairline)]"
      >
        <span className="absolute inset-y-0 left-0 rounded-full bg-verdigris transition-[width] duration-500 ease-calm" style={{ width: `${pct}%` }} />
      </span>
      <span aria-hidden="true" className="t-mono shrink-0 text-[12px] text-muted">
        {done} of {total} done
      </span>
    </span>
  );
}

/** "Transcript: 1,214 words in 38 turns · you 46%, the call 54%", with the split drawn. */
function TranscriptFacts({ stats, others }: { stats: TranscriptStats; others?: string }) {
  const you = Math.round(stats.you * 100);
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] leading-[18px] text-ink-2" style={{ animation: "ac-in 280ms var(--ease) both" }}>
      <span>
        Transcript: <span className="t-mono text-[13px] text-ink">{stats.words.toLocaleString()}</span> {stats.words === 1 ? "word" : "words"} in{" "}
        <span className="t-mono text-[13px] text-ink">{stats.turns.toLocaleString()}</span> {stats.turns === 1 ? "turn" : "turns"} · you {you}%, {others ?? "the call"}{" "}
        {100 - you}%
      </span>
      <span aria-hidden="true" className="flex h-1.5 w-[96px] overflow-hidden rounded-full bg-hairline">
        <span className="h-full bg-verdigris" style={{ width: `${you}%` }} />
      </span>
    </span>
  );
}

/** The running step's time so far, a second at a time. Not announced. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  // Whole seconds while it runs ("12 s"); the finished time keeps its tenths.
  return s < 1 ? null : <span aria-hidden="true">{s < 60 ? `${s} s` : stepTime(s)}</span>;
}

function extraFor(id: StepId, v: StepsView, state: StageState): ReactNode {
  if (id === "transcribe" && state === "active") {
    const p = partOf(v);
    return p ? <PartsBar done={v.parts?.done ?? p.at - 1} total={p.total} /> : null;
  }
  if (id === "summarise" && (state === "active" || state === "done") && v.transcript) return <TranscriptFacts stats={v.transcript} others={v.others} />;
  return chips(id, v.checks);
}

/** The steps as StageList rows: done ones with their time, the running one spinning. */
export function ProcessingSteps({ view, compact = false }: { view: StepsView; compact?: boolean }) {
  const stages: Stage[] = STEP_IDS.map((id, i) => {
    let state: StageState = i < view.at ? "done" : i === view.at ? (view.failed ? "failed" : "active") : "todo";
    // No proof on NEAR (no account, or it failed): the step is left undone, and says why.
    if (id === "proof" && view.onChain === false && state === "done") state = "todo";
    const p = id === "transcribe" && state === "active" ? partOf(view) : null;
    const title =
      id === "proof" && view.onChain === false
        ? "Proof not recorded on NEAR"
        : state === "done"
          ? label[id].done
          : p && p.total > 1
            ? `${label[id].doing} ${p.at} of ${p.total}`
            : label[id].doing;
    return {
      id,
      label: title,
      state,
      detail: compact ? state === "failed" ? <span className="text-[13px] leading-[18px] text-record">Stopped here</span> : undefined : detail(id, view),
      aside: state === "done" ? stepTime(view.times[i]) : state === "active" && view.since !== undefined && !compact ? <Elapsed since={view.since} /> : undefined,
      extra: compact ? undefined : extraFor(id, view, state),
    };
  });
  return (
    <div aria-live="polite">
      <StageList rows stages={stages} />
    </div>
  );
}

/** The page header: eyebrow, title, one line, and a pill on the right. */
export function ProcessHeader({ eyebrow, title, lede, pill }: { eyebrow: ReactNode; title: ReactNode; lede?: ReactNode; pill?: ReactNode }) {
  return (
    <header className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span className="t-eyebrow text-muted">{eyebrow}</span>
        {pill}
      </div>
      <h1 className="t-display m-0 text-ink">{title}</h1>
      {lede && <p className="m-0 text-ink-2">{lede}</p>}
    </header>
  );
}

/** The ↵ hint inside a button. */
const Enter = () => (
  <kbd
    aria-hidden="true"
    className="ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-[color-mix(in_srgb,var(--on-verdigris)_18%,transparent)] px-1 font-mono text-[11px]"
  >
    ↵
  </kbd>
);

/** One figure of the digest: it counts up from 0 once the seal has landed. */
function Figure({ n, one, many, delay, tone }: { n: number; one: string; many: string; delay: number; tone?: "caution" }) {
  return (
    <span className="flex items-baseline gap-2" style={{ animation: `ac-in 280ms ${delay - 120}ms var(--ease) both` }}>
      <span className={cx("t-figure", tone === "caution" ? "text-caution" : "text-ink")}>
        <RollingNumber value={n} from={0} delay={delay} duration={620} />
      </span>
      <span className="text-ink-2">{n === 1 ? one : many}</span>
    </span>
  );
}

/**
 * The end of a run: the seal lands with the tick's spring, then what the notes hold counts
 * up from the saved notes ("2 decisions · 3 action items · 2 need you"). Nothing moves on
 * by itself: Open notes, or ↵, opens them. Verified when every attestation and signature
 * check passed (end-to-end encryption is reported on its own line, as on Verify).
 */
export function NotesReady({
  checks,
  onChain,
  proofFailed,
  preview,
  digest,
  onOpen,
}: {
  checks?: TeeCheck[];
  onChain?: boolean;
  /** Connected, but recording the proof on NEAR failed (the proof step says why). */
  proofFailed?: boolean;
  preview?: boolean;
  /** Counted from the notes as saved. */
  digest: NotesDigest;
  onOpen: () => void;
}) {
  const counted = (checks ?? []).filter((c) => c.id !== "response-e2ee");
  const failed = counted.filter((c) => !c.ok).length;
  const verified = preview || (counted.length > 0 && failed === 0);
  const line = preview
    ? "Simulated in the browser preview. In the Mac app every check runs for real."
    : !verified
      ? `${failed} of ${counted.length} checks didn't pass. Verify shows which.`
      : `${counted.length} checks passed. ${
          onChain
            ? "Proof recorded on NEAR; the audio is gone from this Mac."
            : proofFailed
              ? "The audio is gone from this Mac. The proof didn't go on NEAR; try again from Verify."
              : "The audio is gone from this Mac; record the proof on NEAR from Verify."
        }`;

  // ↵ opens the notes, unless you're typing, a sheet is open, or focus is on another control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || anyLayerOpen()) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t?.closest("input, textarea, select, button, a, [contenteditable], [role='button'], [role='checkbox'], [role='tab'], [role='menuitem'], [role='option']")) return;
      e.preventDefault();
      onOpen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);

  return (
    <m.section
      aria-labelledby="notes-ready"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: springs.gentle }}
      className={cx("flex flex-col gap-4 rounded-md px-5 pt-4.5 pb-4", verified ? "bg-verdigris-tint" : "bg-caution-tint")}
    >
      <div className="flex items-center gap-4.5">
        <m.span
          aria-hidden="true"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1, transition: { ...springs.bouncy, delay: 0.08 } }}
          className={cx("inline-flex size-12 shrink-0 items-center justify-center rounded-full", verified ? "bg-verdigris text-on-verdigris" : "bg-caution text-elevated")}
        >
          {verified ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
              <path d="m9 12 2 2 4-4" strokeDasharray="14" style={{ animation: "ac-draw 260ms 240ms var(--ease) both" }} />
            </svg>
          ) : (
            <ShieldAlert size={24} strokeWidth={2} />
          )}
        </m.span>
        <span role="status" className="flex min-w-[220px] flex-1 flex-col gap-0.5">
          <h2 id="notes-ready" className="t-heading m-0 text-ink">
            {preview ? (
              <>
                Your notes are ready <span className="text-muted">(simulated)</span>
              </>
            ) : verified ? (
              "Your notes are ready"
            ) : (
              "Notes ready, not fully verified"
            )}
          </h2>
          <span className="text-ink-2">
            {verified && !preview && <span className="font-semibold text-verdigris">Verified. </span>}
            {line}
          </span>
        </span>
      </div>
      <div
        className={cx(
          "flex flex-wrap items-center gap-x-7 gap-y-3 border-t pt-3.5",
          verified ? "border-[color-mix(in_srgb,var(--verdigris)_22%,transparent)]" : "border-[color-mix(in_srgb,var(--caution)_22%,transparent)]",
        )}
      >
        <Figure n={digest.decisions} one="decision" many="decisions" delay={480} />
        <Figure n={digest.actionItems} one="action item" many="action items" delay={600} />
        <Figure n={digest.needYou} one="needs you" many="need you" delay={720} tone={digest.needYou > 0 ? "caution" : undefined} />
        <span className="ml-auto" style={{ animation: "ac-in 280ms 760ms var(--ease) both" }}>
          <Button variant="primary" className="rounded-[10px]" onClick={onOpen} aria-keyshortcuts="Enter">
            Open notes <Enter />
          </Button>
        </span>
      </div>
    </m.section>
  );
}

/** Plain words for why a run stopped, from the error the pipeline threw. */
export function explainFailure(error: string, step: StepId): { title: string; body: string } {
  const e = error.toLowerCase();
  if (/\b402\b|payment required|credit|insufficient/.test(e))
    return { title: "NEAR AI refused the key", body: "It has no credit left. Add credit, or connect another key in Settings." };
  if (/\b401\b|\b403\b|unauthori[sz]ed|forbidden|invalid api key|invalid key/.test(e))
    return { title: "NEAR AI refused the key", body: "The key isn't accepted any more. Connect a working key in Settings." };
  if (/secure hardware check failed|not every summary tee passed|didn't verify|attest/.test(e) && step === "attest")
    return { title: "A secure hardware check failed", body: "Aftercall stops before sending anything when a check fails. Try again in a while." };
  if (/no audio left/.test(e)) return { title: "No audio to transcribe", body: "This recording's audio is gone, so there is nothing to make notes from." };
  if (/network|fetch|timed? ?out|connect|dns|offline|error sending request/.test(e))
    return { title: "Couldn't reach NEAR AI", body: "Check the connection, then try again. Nothing is lost." };
  if (/signature/.test(e) && step === "signature")
    return { title: "The signature didn't check out", body: "The notes weren't kept, because the model's signature couldn't be confirmed." };
  return { title: "Processing stopped", body: "Something went wrong at this step. Trying again starts from the beginning." };
}

/** What's still true after a failure, in one line. */
function safeLine(step: StepId): string {
  if (step === "attest") return "Nothing left this Mac: the check failed before any audio was sent. Your audio is still here.";
  if (step === "deleted") return "Your notes are saved. Some audio may still be on this Mac until the delete finishes.";
  if (step === "proof") return "Your notes are saved and the audio is deleted. You can record the proof later from Verify.";
  return "Nothing ran after this step. Your audio is still on this Mac.";
}

/** Where a run stopped (V2Failed): why, the error as it came, and the steps up to it. */
export function FailedPanel({ view, error, onRetry }: { view: StepsView; error: string; onRetry?: () => void }) {
  const step = STEP_IDS[Math.min(view.at, STEP_IDS.length - 1)];
  const why = explainFailure(error, step);
  return (
    <div className="@container">
      <div className="grid grid-cols-1 items-start gap-12 @min-[640px]:grid-cols-[minmax(0,1fr)_300px]">
        <section role="alert" aria-labelledby="pf-why" className="flex flex-col gap-3.5" style={{ animation: "ac-in 320ms 40ms var(--ease) both" }}>
          <h2 id="pf-why" className="t-heading m-0 text-ink">
            {why.title}
          </h2>
          <p className="m-0 text-ink-2">{why.body}</p>
          <code className="selectable block rounded-sm bg-well px-3.5 py-3 font-mono text-[13px] leading-[19px] break-words text-ink shadow-[inset_0_0_0_1px_var(--hairline)]">
            {error}
          </code>
          <p className="m-0 grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 text-ink">
            <Lock size={16} strokeWidth={2} className="mt-0.5 text-verdigris" aria-hidden="true" />
            <span>{safeLine(step)}</span>
          </p>
          {onRetry && (
            <div className="mt-1.5 flex gap-2.5">
              <Button variant="primary" onClick={onRetry}>
                Try again
              </Button>
            </div>
          )}
        </section>
        <section aria-labelledby="pf-where" className="flex flex-col gap-2" style={{ animation: "ac-in 320ms 80ms var(--ease) both" }}>
          <h2 id="pf-where" className="t-section m-0 mb-1 text-ink">
            Where it stopped{" "}
            <span className="font-medium text-muted">
              step {Math.min(view.at, STEP_IDS.length - 1) + 1} of {STEP_IDS.length}
            </span>
          </h2>
          <ProcessingSteps view={{ ...view, failed: true }} compact />
        </section>
      </div>
    </div>
  );
}

/** The STOPPED pill on a failed run. */
export const StoppedPill = () => (
  <Pill tone="record" icon={<X size={11} strokeWidth={3} aria-hidden="true" />}>
    Stopped
  </Pill>
);
