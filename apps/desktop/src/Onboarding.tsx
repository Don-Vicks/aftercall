import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { ArrowRight, AudioLines, Check, FileDown, KeyRound, Laptop, Mic, MonitorSpeaker, Send, ShieldCheck, Trash2 } from "lucide-react";
import { isDesktop, recorder } from "./recorder";
import { useShortcutEverywhere } from "./recording/session";
import { deleteRecording } from "./projects";
import { restoredSummary } from "./recovery";
import { CheckCircle } from "./primitives/Check";
import { Button, Dialog, Meter, Pill, cx, enter, exit, rmsToLevel, springs } from "./ui";
import { NearAiConnect } from "./NearAiConnect";
import { ImportBackup, RestorePhrase } from "./RecoveryPhrase";
import { IconDisc, errorText, rise } from "./SettingsParts";
import { QuietAction, StepActions, StepHeading, StepPage, StepProgress } from "./Flow";

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

type Step = "welcome" | "restore" | "audio" | "nearai" | "ready";
/** Restore is the other way through step 1. */
const POSITION: Record<Step, number> = { welcome: 0, restore: 0, audio: 1, nearai: 2, ready: 3 };

/**
 * First run, full screen: what Aftercall is, a real audio check (which also triggers
 * macOS's permission prompts), the NEAR AI key, then the first recording. Or, on a
 * new Mac, restore the key from a recovery phrase and import a backup first. NEAR
 * and the agent wallet come later, from Settings, when payments matter.
 */
export function Onboarding({ onDone }: { onDone: (startRecording: boolean) => void }) {
  const [step, setStep] = useState<Step>("welcome");
  const go = (s: Step) => setStep(s);
  /** A backup was imported: the app reloads at the end to show it. */
  const [imported, setImported] = useState(false);
  const finish = (record: boolean) => {
    markOnboarded();
    if (imported) return window.location.reload();
    onDone(record);
  };

  return (
    <Dialog placement="full" aria-label="Set up Aftercall" dismissible={false} onClose={() => {}}>
      <AnimatePresence initial={false}>
        {step === "welcome" && (
          <m.div
            key="skip"
            className="absolute top-3.5 right-[18px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: enter }}
            exit={{ opacity: 0, transition: exit }}
          >
            <Button variant="quiet" size="sm" onClick={() => finish(false)}>
              Skip setup
            </Button>
          </m.div>
        )}
      </AnimatePresence>
      <StepProgress step={POSITION[step]} total={4} />
      <AnimatePresence mode="wait" initial={false}>
        {step === "welcome" && (
          <StepPage key="welcome" className="gap-8">
            <Welcome onNext={() => go("audio")} onRestore={() => go("restore")} />
          </StepPage>
        )}
        {step === "restore" && (
          <StepPage key="restore">
            <Restore onBack={() => go("welcome")} onImported={() => setImported(true)} onNext={() => go("audio")} />
          </StepPage>
        )}
        {step === "audio" && (
          <StepPage key="audio">
            <AudioCheck onNext={() => go("nearai")} />
          </StepPage>
        )}
        {step === "nearai" && (
          <StepPage key="nearai">
            <NearAiStep onNext={() => go("ready")} />
          </StepPage>
        )}
        {step === "ready" && (
          <StepPage key="ready">
            <Ready onRecord={() => finish(true)} onLater={() => finish(false)} />
          </StepPage>
        )}
      </AnimatePresence>
    </Dialog>
  );
}

const POINTS: [string, string, ReactNode][] = [
  ["Private", "Made inside NEAR AI's secure hardware, and anyone can check it.", <ShieldCheck size={18} strokeWidth={1.75} />],
  ["Yours", "Notes stay on this Mac. The audio is deleted once it's transcribed.", <Laptop size={18} strokeWidth={1.75} />],
  ["Done", "Recaps and payments go out after one approval, under your limits.", <Send size={18} strokeWidth={1.75} />],
];

function Welcome({ onNext, onRestore }: { onNext: () => void; onRestore: () => void }) {
  return (
    <>
      <header className="flex flex-col gap-2.5" style={rise(1)}>
        <h1 tabIndex={-1} className="m-0 font-serif text-[52px] leading-[56px] font-medium tracking-[-0.025em] text-ink outline-none">
          Aftercall
        </h1>
        <p className="m-0 font-serif text-[20px] leading-7 text-ink-2">Private meeting notes that do the follow-ups.</p>
      </header>
      <ul className="m-0 flex list-none flex-col gap-[22px] p-0">
        {POINTS.map(([title, text, icon], i) => (
          <li key={title} className="flex items-start gap-4" style={rise(i + 2)}>
            <IconDisc tone="raised" size={40}>
              {icon}
            </IconDisc>
            <span className="flex flex-col gap-0.5 pt-px">
              <span className="t-title text-ink">{title}</span>
              <span className="text-ink-2">{text}</span>
            </span>
          </li>
        ))}
      </ul>
      <StepActions style={rise(5)}>
        <QuietAction onClick={onRestore}>Restore from a recovery phrase</QuietAction>
        <Button variant="primary" size="lg" onClick={onNext}>
          Get started
          <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
        </Button>
      </StepActions>
    </>
  );
}

/**
 * A new Mac: the phrase brings back the NEAR key the contract already knows, then an
 * optional backup file brings back notes, projects and settings. Audio check and the
 * NEAR AI key follow as usual, since neither is in a backup.
 */
function Restore({ onBack, onImported, onNext }: { onBack: () => void; onImported: () => void; onNext: () => void }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  return (
    <>
      <StepHeading
        title={publicKey ? "Key restored" : "Restore from a recovery phrase"}
        intro={
          publicKey
            ? "If you authorised it on your old Mac, payments and proofs work again without signing anything."
            : "Type your 12 words in order. They stay on this Mac."
        }
        style={rise(1)}
      />
      <AnimatePresence mode="wait" initial={false}>
        {publicKey ? (
          <m.div
            key="key"
            role="status"
            className="flex items-center gap-3.5 rounded-md bg-raised px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--hairline)]"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: enter }}
          >
            <CheckCircle size={22} play />
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="t-section text-ink">This Mac's key is back</span>
              <span className="selectable truncate font-mono text-[12px] text-muted">{publicKey}</span>
            </span>
          </m.div>
        ) : (
          <m.div key="words" exit={{ opacity: 0, transition: exit }} style={rise(2)}>
            <RestorePhrase onDone={setPublicKey} onCancel={onBack} cancelLabel="Start fresh instead" />
          </m.div>
        )}
      </AnimatePresence>
      <div className="flex flex-wrap items-center gap-3.5 border-t border-hairline pt-5" style={rise(3)}>
        <IconDisc tone="raised" size={36}>
          <FileDown size={16} strokeWidth={1.75} />
        </IconDisc>
        <span className="flex min-w-0 flex-[1_1_240px] flex-col gap-px">
          <span className="t-section text-ink">Import a backup file</span>
          <span className="text-[13px] leading-[18px] text-ink-2">
            {summary ?? "Notes, projects, NEAR settings and autopilot rules. Audio isn't in backups."}
          </span>
        </span>
        {summary ? (
          <Pill tone="verdigris" icon={<Check size={12} strokeWidth={2.5} aria-hidden="true" />}>
            Imported
          </Pill>
        ) : publicKey ? (
          <ImportBackup
            label="Import"
            onRestored={(r) => {
              setSummary(restoredSummary(r));
              onImported();
            }}
          />
        ) : (
          <Pill tone="muted">Next</Pill>
        )}
      </div>
      {publicKey && (
        <StepActions>
          <span />
          <Button variant="primary" size="lg" onClick={onNext}>
            {summary ? "Continue" : "Continue without a backup"}
            <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
          </Button>
        </StepActions>
      )}
    </>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Records five seconds to trigger macOS's prompts and prove both sources have sound.
 * The meters follow the real mic and call levels; the test recording is deleted.
 */
function AudioCheck({ onNext }: { onNext: () => void }) {
  const [state, setState] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [left, setLeft] = useState(5);
  const [heard, setHeard] = useState({ mic: false, system: false });
  const [error, setError] = useState<string | null>(null);
  /** Live levels (0..1) the meters read every frame. */
  const mic = useRef(0);
  const system = useRef(0);
  /** Still on screen: a check that ends after the step is left doesn't touch its state. */
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const countdown = async () => {
    for (let s = 5; s > 0; s--) {
      if (live.current) setLeft(s);
      await sleep(1000);
    }
  };

  const run = async () => {
    setError(null);
    setHeard({ mic: false, system: false });
    setLeft(5);
    if (!isDesktop) {
      // Browser preview: nothing is recorded. The meters follow a made-up signal, and say so.
      setState("running");
      const t0 = performance.now();
      const fake = window.setInterval(() => {
        const t = (performance.now() - t0) / 1000;
        mic.current = 0.45 + 0.35 * Math.sin(t * 5.1);
        system.current = 0.4 + 0.3 * Math.sin(t * 3.7 + 1);
      }, 50);
      await countdown();
      window.clearInterval(fake);
      mic.current = system.current = 0;
      if (live.current) {
        setHeard({ mic: true, system: true });
        setState("done");
      }
      return;
    }
    const peak = { mic: 0, system: 0 };
    let off: (() => void) | null = null;
    try {
      off = await recorder.onLevels((l) => {
        mic.current = rmsToLevel(l.mic);
        system.current = rmsToLevel(l.system);
        peak.mic = Math.max(peak.mic, l.mic);
        peak.system = Math.max(peak.system, l.system);
      });
      await recorder.start("General");
      setState("running");
      await countdown();
      const saved = await recorder.stop();
      await deleteRecording(saved.id).catch(() => {});
      if (live.current) {
        setHeard({ mic: peak.mic > 0.002, system: peak.system > 0.002 });
        setState("done");
      }
    } catch (e) {
      if (live.current) {
        setError(errorText(e));
        setState("failed");
      }
    } finally {
      off?.();
      mic.current = system.current = 0;
    }
  };

  const done = state === "done";
  return (
    <>
      <StepHeading title="Check your audio" intro="Play a video and say a few words. macOS asks for permission first." style={rise(1)} />
      <div className="relative flex flex-col overflow-hidden rounded-md bg-raised shadow-[inset_0_0_0_1px_var(--hairline)]" style={rise(2)}>
        <Source
          icon={
            <IconDisc tone="verdigris" size={40}>
              <Mic size={18} strokeWidth={1.75} />
            </IconDisc>
          }
          name="Microphone"
          who="You"
          swatch="bg-verdigris"
          tone="verdigris"
          levelRef={mic}
          state={state}
          heard={heard.mic}
          divider
        />
        <Source
          icon={
            <IconDisc tone="elevated" size={40}>
              <MonitorSpeaker size={18} strokeWidth={1.75} />
            </IconDisc>
          }
          name="Call audio"
          who="The call, from any app"
          swatch="bg-ink-2"
          tone="ink"
          levelRef={system}
          state={state}
          heard={heard.system}
          delay={0.14}
        />
        {state === "running" && (
          <span
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-verdigris"
            style={{ animation: "ac-countdown 5000ms linear both" }}
          />
        )}
      </div>

      <div className="-mt-2 flex flex-col gap-2" style={rise(3)}>
        <p className="m-0 flex items-center gap-2 text-[13px] leading-[18px] text-ink-2">
          <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-muted" />
          The test recording is deleted straight away.
        </p>
        {!isDesktop && state !== "idle" && (
          <p className="m-0 text-[13px] leading-[18px] text-ink-2">Browser preview: nothing is recorded, and these levels are made up.</p>
        )}
        {done && isDesktop && !heard.mic && (
          <p className="m-0 text-[13px] leading-[19px] text-caution">
            No sound from your microphone. Say a few words and check again. If it stays silent, allow Aftercall in System Settings → Privacy &amp; Security →
            Microphone.
          </p>
        )}
        {done && isDesktop && !heard.system && (
          <p className="m-0 text-[13px] leading-[19px] text-caution">
            No call audio came through. Play something with sound and check again. If it stays silent, allow Aftercall in System Settings → Privacy &amp;
            Security → Screen &amp; System Audio Recording.
          </p>
        )}
        {error && <p className="selectable m-0 text-[13px] leading-[19px] text-record">{error}</p>}
        <span role="status" className="sr-only">
          {state === "running"
            ? "Listening for 5 seconds."
            : done
              ? `Microphone ${heard.mic ? "heard" : "silent"}. Call audio ${heard.system ? "heard" : "silent"}.`
              : ""}
        </span>
      </div>

      <StepActions style={rise(4)}>
        {done ? <QuietAction onClick={run}>Check again</QuietAction> : <QuietAction onClick={onNext}>Skip for now</QuietAction>}
        {done ? (
          <m.span
            className="inline-flex"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1, transition: { ...springs.bouncy, delay: 0.26 } }}
          >
            <Button variant="primary" size="lg" onClick={onNext}>
              Continue
              <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
            </Button>
          </m.span>
        ) : state === "running" ? (
          <Button variant="primary" size="lg" loading>
            Listening… <span className="min-w-[9px] font-mono font-medium">{left}</span>
          </Button>
        ) : (
          <Button variant="primary" size="lg" icon={<AudioLines size={16} strokeWidth={2} aria-hidden="true" />} onClick={run}>
            {state === "failed" ? "Check again" : "Check audio"}
          </Button>
        )}
      </StepActions>
    </>
  );
}

function Source({
  icon,
  name,
  who,
  swatch,
  tone,
  levelRef,
  state,
  heard,
  delay = 0,
  divider,
}: {
  icon: ReactNode;
  name: string;
  who: string;
  swatch: string;
  tone: "verdigris" | "ink";
  levelRef: RefObject<number>;
  state: "idle" | "running" | "done" | "failed";
  heard: boolean;
  delay?: number;
  divider?: boolean;
}) {
  const running = state === "running";
  return (
    <div className={cx("flex items-center gap-4 px-5 py-[18px]", divider && "border-b border-hairline")}>
      {icon}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="t-title text-ink">{name}</span>
        <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-2">
          <span aria-hidden="true" className={cx("size-2 rounded-[2px]", swatch)} />
          {who}
        </span>
      </span>
      <AnimatePresence mode="wait" initial={false}>
        {state === "done" ? (
          <m.span
            key="result"
            className="inline-flex"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1, transition: { ...springs.bouncy, delay } }}
          >
            {heard ? (
              <Pill tone="verdigris" icon={<CheckCircle size={16} play />} className="h-[26px] pl-[5px]">
                Heard
              </Pill>
            ) : (
              <Pill tone="caution" className="h-[26px]">
                Silent
              </Pill>
            )}
          </m.span>
        ) : (
          <m.span key="meter" className={cx("inline-flex transition-opacity duration-200", !running && "opacity-40")} exit={{ opacity: 0, transition: exit }}>
            <Meter
              levelRef={running ? levelRef : undefined}
              level={0}
              bars={16}
              height={24}
              tone={tone}
              label={running ? `${name} level` : `${name}, not listening yet`}
            />
          </m.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function NearAiStep({ onNext }: { onNext: () => void }) {
  const [connected, setConnected] = useState(false);
  return (
    <>
      <StepHeading title="Connect NEAR AI" intro="Your notes are made by NEAR AI's private models, in secure hardware." style={rise(1)} />
      <div style={rise(2)}>
        <NearAiConnect compact onChange={setConnected} onConnected={() => setConnected(true)} />
      </div>
      <p className="-mt-1.5 flex items-center gap-2 text-[13px] leading-[18px] text-ink-2" style={rise(3)}>
        <KeyRound size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-muted" />
        {connected
          ? "Aftercall checks the key with NEAR AI, then keeps it in your macOS Keychain."
          : "You can record without it; notes wait until you add a key."}
      </p>
      <StepActions style={rise(4)}>
        {connected ? <span /> : <QuietAction onClick={onNext}>Skip for now</QuietAction>}
        <Button variant="primary" size="lg" disabled={!connected} onClick={onNext}>
          Continue
          <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
        </Button>
      </StepActions>
    </>
  );
}

function Ready({ onRecord, onLater }: { onRecord: () => void; onLater: () => void }) {
  const everywhere = useShortcutEverywhere();
  const steps: [string, ReactNode, ReactNode][] = [
    [
      "Press New recording",
      <>
        Or <kbd className="rounded-[4px] bg-well px-[5px] py-px font-mono text-[12px] text-ink shadow-[inset_0_0_0_1px_var(--hairline)]">⌘⇧R</kbd>{" "}
        {everywhere ? "from any app" : "in Aftercall"}, or use the menu bar.
      </>,
      <span className="inline-flex h-[30px] items-center gap-2 rounded-sm bg-elevated px-2.5 text-[13px] font-semibold whitespace-nowrap text-ink shadow-1">
        <span className="size-2 rounded-full bg-record" />
        New recording
        <span className="font-mono text-[11px] font-normal text-muted">⌘⇧R</span>
      </span>,
    ],
    [
      "Stop when the call ends",
      "Your notes appear in about a minute.",
      <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-record px-3 text-[13px] font-semibold text-white">
        <span className="size-2 rounded-[2px] bg-white" />
        Stop
      </span>,
    ],
    [
      "Approve what you want",
      "Recaps and payments go out after one approval.",
      <span className="inline-flex h-[30px] items-center rounded-sm bg-verdigris px-3 text-[13px] font-semibold text-on-verdigris">Approve</span>,
    ],
  ];
  return (
    <>
      <StepHeading title="You're ready" intro="Start a call in any app, then record. Tell everyone you're taking notes." style={rise(1)} />
      <ol className="m-0 flex list-none flex-col border-t border-hairline p-0">
        {steps.map(([title, text, picture], i) => (
          <li key={title} className="flex items-center gap-4 border-b border-hairline py-4" style={rise(i + 2)}>
            <span
              aria-hidden="true"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--border)]"
            >
              {i + 1}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="t-title text-ink">{title}</span>
              <span className="text-ink-2">{text}</span>
            </span>
            {/* A picture of the control, not the control. */}
            <span aria-hidden="true" className="shrink-0">
              {picture}
            </span>
          </li>
        ))}
      </ol>
      <StepActions style={rise(5)}>
        <QuietAction onClick={onLater}>Go to Today</QuietAction>
        <Button variant="record" size="lg" icon={<span aria-hidden="true" className="size-[9px] rounded-full bg-white" />} onClick={onRecord}>
          Record my first meeting
        </Button>
      </StepActions>
    </>
  );
}
