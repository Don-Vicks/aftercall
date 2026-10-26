import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Square } from "lucide-react";
import { formatClock } from "@aftercall/core";
import { isDesktop, recorder, type RecordingInfo, type SavedRecording } from "./recorder";
import type { Project } from "./projects";
import { Button } from "./ui";

const NOTICE = "Heads up: I'm recording this call with Aftercall to take private notes. The audio is deleted after transcription.";
const METER_BARS = 28;

/** The recording panel: pick a project, confirm consent, record, stop. */
export function RecordPanel({
  projects,
  selectProject,
  onNewProject,
  onClose,
  onStop,
}: {
  projects: Project[];
  /** A project just created from this panel; it becomes the selection. */
  selectProject?: string;
  onNewProject: () => void;
  onClose: () => void;
  onStop: (project: string, seconds: number, saved?: SavedRecording) => void;
}) {
  const [project, setProject] = useState(selectProject ?? projects[0]?.name ?? "General");
  useEffect(() => {
    if (selectProject) setProject(selectProject);
  }, [selectProject]);
  // Projects load after the panel can open; keep the selection valid.
  useEffect(() => {
    if (projects.length && !projects.some((p) => p.name === project)) setProject(projects[0].name);
  }, [projects, project]);
  // Consent is asked every time; it never defaults to ticked.
  const [consent, setConsent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<RecordingInfo | null>(null);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(METER_BARS).fill(0));
  const [silentSystem, setSilentSystem] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const pushLevel = (value: number) => setLevels((l) => [...l.slice(1), value]);

  // In the app, the recorder drives the timer, meter and silence warning.
  useEffect(() => {
    if (!recording || !isDesktop) return;
    const offLevels = recorder.onLevels((l) => {
      setSeconds(l.seconds);
      if (!pausedRef.current) pushLevel(Math.max(l.mic, l.system));
    });
    const offSilence = recorder.onSilence((s) => s.stem === "system" && setSilentSystem(s.silent));
    return () => {
      offLevels.then((f) => f());
      offSilence.then((f) => f());
    };
  }, [recording]);

  // In a plain browser (pnpm dev:ui) there is no recorder: simulate it.
  useEffect(() => {
    if (!recording || isDesktop || paused) return;
    const clock = setInterval(() => setSeconds((s) => s + 1), 1000);
    const meter = setInterval(() => pushLevel(0.05 + Math.random() * 0.25), 120);
    return () => {
      clearInterval(clock);
      clearInterval(meter);
    };
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

  const start = async () => {
    setError(null);
    if (!isDesktop) {
      setRecording(true);
      return;
    }
    setStarting(true);
    try {
      setInfo(await recorder.start(project));
      setRecording(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setStarting(false);
    }
  };

  const togglePause = async () => {
    const next = !paused;
    if (isDesktop) await recorder.pause(next);
    setPaused(next);
  };

  const stop = async () => {
    if (!isDesktop) return onStop(project, seconds);
    try {
      const saved = await recorder.stop();
      onStop(project, saved.seconds, saved);
    } catch (e) {
      setError(String(e));
    }
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
            <Meter levels={levels} />
            {silentSystem && (
              <div role="status" className="flex gap-2.5 rounded-sm bg-caution-tint p-3 text-caution">
                <AlertTriangle size={16} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  No sound from the call for 30 seconds. If others are talking, allow Aftercall in System Settings → Privacy &amp; Security →
                  Screen &amp; System Audio Recording.
                </span>
              </div>
            )}
            <dl className="m-0 flex flex-col gap-2">
              <Stat
                label="System audio"
                value={info && !info.systemAudio ? <span className="text-caution">Unavailable</span> : silentSystem ? <span className="text-caution">Silent</span> : "Live"}
              />
              <Stat label="Microphone" value={paused ? "Paused" : "Live"} />
              <Stat label="Saved so far" value={<span className="t-mono">{Math.floor(seconds / 300) + 1} chunk</span>} />
            </dl>
            {error && <p className="m-0 text-record">{error}</p>}
            <div className="mt-2 flex gap-2">
              <Button size="lg" className="flex-1" onClick={togglePause}>
                {paused ? "Resume" : "Pause"}
              </Button>
              <Button size="lg" variant="danger" className="flex-[2]" onClick={stop}>
                <Square size={12} fill="currentColor" aria-hidden="true" />
                Stop and process
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <label htmlFor="proj" className="t-label text-muted">
                  Project
                </label>
                <button onClick={onNewProject} className="text-xs font-semibold text-verdigris hover:text-verdigris-hover">
                  New project
                </button>
              </div>
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

            <Button size="lg" variant="primary" disabled={!consent || starting} onClick={start}>
              <span aria-hidden="true" className="size-2 rounded-full bg-on-verdigris" />
              {starting ? "Starting…" : "Start recording"}
            </Button>
            {!consent && <p className="-mt-2 m-0 text-caution">Tick the box once everyone knows you're recording.</p>}
            {error && <p className="-mt-2 m-0 text-record">{error}</p>}

            <p className="m-0 text-muted">
              {isDesktop
                ? "Records the call's audio and your microphone on this Mac. macOS asks for permission the first time."
                : "Preview in a browser: recording is simulated. Run the desktop app to record."}
            </p>
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

/** Recent input level, newest on the right. Speech RMS sits around 0.02–0.3. */
function Meter({ levels }: { levels: number[] }) {
  return (
    <div aria-hidden="true" className="flex h-10 items-center gap-[3px]">
      {levels.map((level, i) => {
        const h = 4 + Math.min(1, Math.sqrt(level / 0.3)) * 34;
        const tone = h > 26 ? "bg-ink" : h > 14 ? "bg-muted" : "bg-faint";
        return <span key={i} className={`w-[3px] rounded-full transition-[height] duration-100 ${tone}`} style={{ height: h }} />;
      })}
    </div>
  );
}
