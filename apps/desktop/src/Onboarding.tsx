import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Mic, MonitorSpeaker } from "lucide-react";
import { isDesktop, recorder } from "./recorder";
import { deleteRecording } from "./projects";
import { nearAiKey } from "./nearai";
import { Button, Spinner, cx } from "./ui";
import { NearAiConnect } from "./NearAiConnect";

const KEY = "aftercall.onboarded";

export function needsOnboarding(): boolean {
  try {
    return localStorage.getItem(KEY) !== "1";
  } catch {
    return false;
  }
}

function markOnboarded() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // Storage blocked: onboarding shows again next time, which is harmless.
  }
}

const STEPS = 4;

/**
 * First run: what Aftercall is, a real audio check (which also triggers macOS's
 * permission prompts), the NEAR AI key, then the first recording. NEAR and the
 * agent wallet come later, from Settings, when payments matter.
 */
export function Onboarding({ onDone }: { onDone: (startRecording: boolean) => void }) {
  const [step, setStep] = useState(0);
  const finish = (record: boolean) => {
    markOnboarded();
    onDone(record);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ground">
      <div data-tauri-drag-region className="h-9 shrink-0" />
      <div className="flex flex-1 items-center justify-center overflow-y-auto px-8 pb-12">
        <div className="flex w-full max-w-[560px] flex-col gap-8">
          <div className="flex items-center justify-between">
            <span className="t-label text-muted">
              Step {step + 1} of {STEPS}
            </span>
            <div aria-hidden="true" className="flex gap-1.5">
              {Array.from({ length: STEPS }, (_, i) => (
                <span key={i} className={cx("h-1 w-8 rounded-full", i <= step ? "bg-verdigris" : "bg-hairline")} />
              ))}
            </div>
          </div>
          {step === 0 && <Welcome onNext={() => setStep(1)} onSkip={() => finish(false)} />}
          {step === 1 && <AudioCheck onNext={() => setStep(2)} />}
          {step === 2 && <NearAiStep onNext={() => setStep(3)} />}
          {step === 3 && <Ready onRecord={() => finish(true)} onLater={() => finish(false)} />}
        </div>
      </div>
    </div>
  );
}

function Title({ children, intro }: { children: string; intro: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="t-display m-0">{children}</h1>
      <p className="t-reading m-0 text-muted">{intro}</p>
    </div>
  );
}

function Welcome({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <>
      <div className="flex flex-col gap-3">
        <span className="font-serif text-[40px] leading-[46px] font-medium tracking-[-0.02em]">Aftercall</span>
        <p className="t-reading m-0 text-muted">Private meeting notes that do the follow-ups.</p>
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {[
          ["Private", "Your meetings are transcribed and summarised inside NEAR AI's secure hardware, and anyone can check it."],
          ["Yours", "Recordings and notes stay on this Mac. The audio is deleted once it's transcribed."],
          ["Done", "Recaps and payments go out after one approval, under limits you set on NEAR."],
        ].map(([label, text], i) => (
          <li key={label} className={cx("grid grid-cols-[88px_minmax(0,1fr)] gap-4 py-3.5", i < 2 && "border-b border-hairline")}>
            <span className="t-label pt-0.5 text-verdigris">{label}</span>
            <span className="text-[15px] leading-[22px]">{text}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between">
        <button onClick={onSkip} className="font-semibold text-muted hover:text-ink">
          Skip setup
        </button>
        <Button variant="primary" size="lg" onClick={onNext}>Get started</Button>
      </div>
    </>
  );
}

/** Records five seconds to trigger macOS's prompts and prove both sources have sound. */
function AudioCheck({ onNext }: { onNext: () => void }) {
  const [state, setState] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [peak, setPeak] = useState({ mic: 0, system: 0 });
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(5);
  const peakRef = useRef(peak);
  peakRef.current = peak;

  useEffect(() => {
    if (state !== "running") return;
    const off = recorder.onLevels((l) => setPeak((p) => ({ mic: Math.max(p.mic, l.mic), system: Math.max(p.system, l.system) })));
    return () => {
      off.then((f) => f());
    };
  }, [state]);

  const run = async () => {
    setError(null);
    setPeak({ mic: 0, system: 0 });
    if (!isDesktop) return setState("done");
    try {
      await recorder.start("General");
      setState("running");
      for (let s = 5; s > 0; s--) {
        setLeft(s);
        await new Promise((r) => setTimeout(r, 1000));
      }
      const saved = await recorder.stop();
      await deleteRecording(saved.id).catch(() => {});
      setState("done");
    } catch (e) {
      setError(String(e));
      setState("failed");
    }
  };

  const heard = (v: number) => v > 0.002;

  return (
    <>
      <Title intro="Aftercall records your microphone (you) and the call's audio (everyone else), kept apart. macOS asks for permission the first time. Play something with sound, like a video, and say a few words.">
        Check your audio
      </Title>
      <div className="flex flex-col overflow-hidden rounded-md shadow-[inset_0_0_0_1px_var(--hairline)]">
        <Source icon={<Mic size={16} strokeWidth={1.5} />} name="Microphone" detail="Your side of the call" state={state} ok={heard(peak.mic)} level={peak.mic} />
        <Source icon={<MonitorSpeaker size={16} strokeWidth={1.5} />} name="Call audio" detail="System audio from any app" state={state} ok={heard(peak.system)} level={peak.system} last />
      </div>
      {state === "done" && !heard(peak.system) && isDesktop && (
        <p className="m-0 text-caution">
          No call audio came through. Play something with sound and check again. If it stays silent, allow Aftercall in System Settings → Privacy &amp; Security → Screen &amp; System Audio Recording.
        </p>
      )}
      {error && <p className="selectable m-0 text-record">{error}</p>}
      <p className="m-0 text-muted">The test recording is deleted straight away.</p>
      <div className="flex items-center justify-between">
        <button onClick={onNext} className="font-semibold text-muted hover:text-ink">
          {state === "done" ? "" : "Skip for now"}
        </button>
        <div className="flex gap-2">
          <Button size="lg" onClick={run} disabled={state === "running"}>
            {state === "running" ? (
              <>
                <Spinner size={12} /> Listening… {left}
              </>
            ) : state === "idle" ? (
              "Check audio"
            ) : (
              "Check again"
            )}
          </Button>
          {state === "done" && (
            <Button variant="primary" size="lg" onClick={onNext}>
              Continue
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function Source({
  icon,
  name,
  detail,
  state,
  ok,
  level,
  last,
}: {
  icon: ReactNode;
  name: string;
  detail: string;
  state: string;
  ok: boolean;
  level: number;
  last?: boolean;
}) {
  return (
    <div className={cx("flex items-center gap-4 px-5 py-4", !last && "border-b border-hairline")}>
      <span className="text-muted" aria-hidden="true">{icon}</span>
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="t-title">{name}</span>
        <span className="text-muted">{detail}</span>
      </span>
      {state === "running" && (
        <span aria-hidden="true" className="h-1 w-24 rounded-full bg-hairline">
          <span className="block h-1 rounded-full bg-verdigris transition-[width]" style={{ width: `${Math.min(100, Math.sqrt(level / 0.3) * 100)}%` }} />
        </span>
      )}
      {state === "done" &&
        (ok ? (
          <span className="flex items-center gap-1.5 font-semibold text-verdigris">
            <Check size={14} strokeWidth={2} aria-hidden="true" /> Heard
          </span>
        ) : (
          <span className="font-semibold text-caution">Silent</span>
        ))}
    </div>
  );
}

function NearAiStep({ onNext }: { onNext: () => void }) {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (isDesktop) nearAiKey.has().then(setConnected).catch(() => {});
  }, []);
  return (
    <>
      <Title intro="Your notes are made by NEAR AI's private models, which run in secure hardware. Paste an API key from cloud.near.ai; Aftercall checks it, then keeps it in your macOS Keychain.">
        Connect NEAR AI
      </Title>
      <NearAiConnect compact onConnected={() => setConnected(true)} />
      <div className="flex items-center justify-between">
        <span className="text-muted">{connected ? "" : "You can record without it; notes wait until you add a key."}</span>
        <Button variant={connected ? "primary" : "secondary"} size="lg" onClick={onNext}>{connected ? "Continue" : "Skip for now"}</Button>
      </div>
    </>
  );
}

function Ready({ onRecord, onLater }: { onRecord: () => void; onLater: () => void }) {
  return (
    <>
      <Title intro="Start a call in any app, then record. Tell everyone you're taking notes: Aftercall asks you to confirm it every time.">
        You're ready
      </Title>
      <ol className="m-0 flex list-none flex-col border-t border-hairline p-0">
        {[
          ["01", "Press ⌘⇧R, or use Aftercall in the menu bar"],
          ["02", "Stop when the call ends; notes appear in about a minute"],
          ["03", "Approve the recap and payments you want. Connect NEAR in Settings when you're ready to pay from your agent wallet"],
        ].map(([n, text]) => (
          <li key={n} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 border-b border-hairline py-3.5">
            <span className="font-mono text-xs leading-5 text-muted">{n}</span>
            <span className="text-[15px] leading-5">{text}</span>
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-between">
        <button onClick={onLater} className="font-semibold text-muted hover:text-ink">
          Go to Home
        </button>
        <Button variant="primary" size="lg" onClick={onRecord}>Record my first meeting</Button>
      </div>
    </>
  );
}
