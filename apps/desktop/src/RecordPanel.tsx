import { useEffect, useState, type ReactNode } from "react";
import { Square } from "lucide-react";
import { formatClock } from "@aftercall/core";
import { projects } from "./sample";
import { Button } from "./ui";

const NOTICE = "Heads up: I'm recording this call with Aftercall to take private notes. The audio is deleted after transcription.";

/** The menu bar panel: pick a project, confirm consent, record, stop. */
export function RecordPanel({ onClose, onStop }: { onClose: () => void; onStop: (project: string, seconds: number) => void }) {
  const [project, setProject] = useState(projects[0].name);
  // Consent is asked every time; it never defaults to ticked.
  const [consent, setConsent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!recording || paused) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording, paused]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !recording && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recording, onClose]);

  const copyNotice = async () => {
    await navigator.clipboard.writeText(NOTICE);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/30 p-3 pt-10" onClick={() => !recording && onClose()}>
      <div
        role="dialog"
        aria-label={recording ? "Recording" : "Start recording"}
        onClick={(e) => e.stopPropagation()}
        className="flex w-[360px] flex-col gap-4 rounded-lg bg-elevated p-4 shadow-float"
      >
        <div className="flex items-baseline justify-between">
          <span className="font-serif text-lg leading-[22px] font-medium">Aftercall</span>
          {recording ? (
            <span className="t-label inline-flex items-center gap-1.5 text-record">
              <span
                aria-hidden="true"
                className="size-2 rounded-full bg-record"
                style={{ animation: paused ? undefined : "pulse-ring 1.6s ease-in-out infinite", boxShadow: "0 0 0 4px var(--record-tint)" }}
              />
              {paused ? "Paused" : "Recording"}
            </span>
          ) : (
            <span className="t-label text-muted">Ready</span>
          )}
        </div>

        {recording ? (
          <>
            <div className="flex flex-col gap-1 pt-2 pb-1">
              <span className="font-mono text-[44px] leading-[48px] tracking-[-0.03em] tabular-nums">{formatClock(seconds)}</span>
              <span className="text-muted">{project} · New meeting</span>
            </div>
            <Meter active={!paused} />
            <dl className="m-0 flex flex-col gap-2">
              <Stat label="System audio" value="Live" />
              <Stat label="Microphone" value="Live" />
              <Stat label="Saved so far" value={<span className="t-mono">{Math.floor(seconds / 300) + 1} chunk</span>} />
            </dl>
            <div className="mt-2 flex gap-2">
              <Button size="lg" className="flex-1" onClick={() => setPaused((p) => !p)}>
                {paused ? "Resume" : "Pause"}
              </Button>
              <Button size="lg" variant="danger" className="flex-[2]" onClick={() => onStop(project, seconds)}>
                <Square size={12} fill="currentColor" aria-hidden="true" />
                Stop and process
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="proj" className="t-label text-muted">
                Project
              </label>
              <select
                id="proj"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                className="h-[34px] rounded-sm border border-border bg-well px-2.5 text-ink"
              >
                {projects.map((p) => (
                  <option key={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between gap-2.5 border-y border-hairline py-2.5">
              <div className="flex items-center gap-2.5">
                <input type="checkbox" id="consent" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="size-[15px]" />
                <label htmlFor="consent">I've told everyone on the call</label>
              </div>
              <button onClick={copyNotice} className="shrink-0 text-xs font-semibold text-verdigris hover:text-verdigris-hover">
                {copied ? "Copied" : "Copy notice"}
              </button>
            </div>

            <Button size="lg" variant="primary" disabled={!consent} onClick={() => setRecording(true)}>
              <span aria-hidden="true" className="size-2 rounded-full bg-on-verdigris" />
              Start recording
            </Button>
            {!consent && <p className="-mt-2 m-0 text-caution">Tick the box once everyone knows you're recording.</p>}

            <dl className="m-0 flex flex-col gap-2">
              <Stat label="System audio" value={<span className="text-verdigris">Allowed</span>} />
              <Stat label="Microphone" value="MacBook Pro Microphone" />
            </dl>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="m-0">{value}</dd>
    </div>
  );
}

/** Placeholder level meter until the recorder streams real levels (M1 capture task). */
function Meter({ active }: { active: boolean }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), 140);
    return () => clearInterval(t);
  }, [active]);
  return (
    <div aria-hidden="true" className="flex h-10 items-center gap-[3px]">
      {Array.from({ length: 28 }, (_, i) => {
        const h = active ? 6 + Math.abs(Math.sin((i + tick) * 0.7) * Math.cos((i * 3 + tick) * 0.31)) * 32 : 4;
        const tone = h > 26 ? "bg-ink" : h > 14 ? "bg-muted" : "bg-faint";
        return <span key={i} className={`w-[3px] rounded-full transition-[height] duration-150 ${tone}`} style={{ height: h }} />;
      })}
    </div>
  );
}
