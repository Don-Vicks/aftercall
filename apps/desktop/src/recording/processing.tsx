import type { ReactNode } from "react";
import * as m from "motion/react-m";
import { Lock, ShieldAlert, X } from "lucide-react";
import type { TeeCheck } from "@aftercall/core";
import { Button, Pill, StageList, cx, enter, type Stage, type StageState } from "../ui";

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
  /** "2 of 4" while transcribing. */
  part?: string;
  /** Who was on the call, for "You and Ines kept apart". */
  others?: string;
  /** Known once finished: */
  checks?: TeeCheck[];
  /** False when NEAR isn't connected, so no proof went on chain. */
  onChain?: boolean;
}

const label: Record<StepId, { done: string; doing: string }> = {
  attest: { done: "Secure hardware checked", doing: "Secure hardware checked" },
  transcribe: { done: "Transcribed", doing: "Transcribed" },
  summarise: { done: "Notes written", doing: "Writing the notes" },
  signature: { done: "Signature checked", doing: "Signature checked" },
  proof: { done: "Proof recorded on NEAR", doing: "Proof recorded on NEAR" },
  deleted: { done: "Audio deleted from this Mac", doing: "Audio deleted from this Mac" },
};

function detail(id: StepId, v: StepsView, state: StageState): string {
  switch (id) {
    case "attest":
      return "Gateway, Whisper and Qwen TEEs, each against a fresh nonce";
    case "transcribe":
      return `Whisper in secure hardware · You and ${v.others ?? "the call"} kept apart${state === "active" && v.part ? ` · part ${v.part}` : ""}`;
    case "summarise":
      return "Transcript sealed on this Mac for the attested Qwen TEE; each item needs a quote from the call";
    case "signature":
      return "Signed over the exact request and response by the attested key";
    case "proof":
      return v.onChain === false ? "Connect your NEAR account, then record it from Verify" : "A hash only; no meeting content goes on chain";
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

/** The steps as StageList rows: done ones with their time, the running one spinning. */
export function ProcessingSteps({ view, compact = false }: { view: StepsView; compact?: boolean }) {
  const stages: Stage[] = STEP_IDS.map((id, i) => {
    let state: StageState = i < view.at ? "done" : i === view.at ? (view.failed ? "failed" : "active") : "todo";
    // No NEAR account: the proof step is left undone, and says so.
    if (id === "proof" && view.onChain === false && state === "done") state = "todo";
    const title = id === "proof" && view.onChain === false ? "Proof not recorded on NEAR" : state === "done" ? label[id].done : label[id].doing;
    return {
      id,
      label: title,
      state,
      detail: compact ? state === "failed" ? <span className="text-[13px] leading-[18px] text-record">Stopped here</span> : undefined : detail(id, view, state),
      aside: state === "done" ? stepTime(view.times[i]) : undefined,
      extra: compact ? undefined : chips(id, view.checks),
    };
  });
  return (
    <div aria-live="polite">
      <StageList rows stages={stages} />
    </div>
  );
}

/** The page header: eyebrow, title, one line, and a pill on the right. */
export function ProcessHeader({ eyebrow, title, lede, pill }: { eyebrow: ReactNode; title: ReactNode; lede: ReactNode; pill?: ReactNode }) {
  return (
    <header className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span className="t-eyebrow text-muted">{eyebrow}</span>
        {pill}
      </div>
      <h1 className="t-display m-0 text-ink">{title}</h1>
      <p className="m-0 text-ink-2">{lede}</p>
    </header>
  );
}

/**
 * The end of a run: Verified when every attestation and signature check passed
 * (end-to-end encryption is reported on its own line, as on Verify).
 */
export function VerifiedSeal({ checks, onChain, preview, onOpen }: { checks?: TeeCheck[]; onChain?: boolean; preview?: boolean; onOpen: () => void }) {
  const counted = (checks ?? []).filter((c) => c.id !== "response-e2ee");
  const failed = counted.filter((c) => !c.ok).length;
  const verified = preview || (counted.length > 0 && failed === 0);
  const line = preview
    ? "Simulated in the browser preview. In the Mac app every check runs for real."
    : !verified
      ? `${failed} of ${counted.length} checks didn't pass. Verify shows which.`
      : `${counted.length} checks passed. ${onChain ? "Proof recorded on NEAR; the audio is gone from this Mac." : "The audio is gone from this Mac; record the proof on NEAR from Verify."}`;
  return (
    <m.div
      role="status"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1, transition: enter }}
      className={cx("flex flex-wrap items-center gap-4.5 rounded-md px-5 py-4.5", verified ? "bg-verdigris-tint" : "bg-caution-tint")}
    >
      <span
        aria-hidden="true"
        className={cx(
          "inline-flex size-12 shrink-0 items-center justify-center rounded-full",
          verified ? "bg-verdigris text-on-verdigris" : "bg-caution text-elevated",
        )}
        style={{ animation: "ac-fill 420ms cubic-bezier(.3,1.5,.5,1) both" }}
      >
        {verified ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
            <path d="m9 12 2 2 4-4" strokeDasharray="14" style={{ animation: "ac-draw 260ms 200ms var(--ease) both" }} />
          </svg>
        ) : (
          <ShieldAlert size={24} strokeWidth={2} />
        )}
      </span>
      <span className="flex min-w-[220px] flex-1 flex-col gap-0.5">
        <span className="t-heading text-ink">
          {preview ? (
            <>
              Verified <span className="text-muted">(simulated)</span>
            </>
          ) : verified ? (
            "Verified"
          ) : (
            "Notes ready, not fully verified"
          )}
        </span>
        <span className="text-ink-2">{line}</span>
      </span>
      <Button variant="primary" className="rounded-[10px]" onClick={onOpen}>
        Open notes
      </Button>
    </m.div>
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
