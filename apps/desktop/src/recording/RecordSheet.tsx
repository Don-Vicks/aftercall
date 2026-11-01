import { useEffect, useId, useState } from "react";
import { Copy, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { CalendarEvent, NoticeLog } from "@aftercall/core";
import { calendar } from "../calendar";
import type { Project } from "../projects";
import { isDesktop } from "../recorder";
import { sampleScripts } from "../sampleRecordings";
import { Avatar, Button, Dialog, IconButton, Menu, Select, Tick, cx, toast } from "../ui";
import { startRecording } from "./session";

const NOTICE = "Heads up: I'm recording this call with Aftercall to take private notes. The audio is deleted once the notes are made.";

/** Within this long before it starts, an event counts as the call you're about to record. */
const SOON_SECONDS = 15 * 60;

/** The event happening now, or the next one starting within 15 minutes. */
export async function currentEvent(now = Math.floor(Date.now() / 1000)): Promise<CalendarEvent | null> {
  if (!isDesktop || (await calendar.status().catch(() => "denied")) !== "granted") return null;
  const events = await invoke<CalendarEvent[]>("calendar_events_between", { start: now - 4 * 3600, end: now + SOON_SECONDS }).catch(() => []);
  const timed = events.filter((e) => !e.allDay && e.end > now && e.start <= now + SOON_SECONDS);
  // The one under way that started last, else the soonest to start.
  const running = timed.filter((e) => e.start <= now).sort((a, b) => b.start - a.start)[0];
  return running ?? timed.sort((a, b) => a.start - b.start)[0] ?? null;
}

/** The browser preview has no calendar: a made-up event, labelled as one. */
function previewEvent(now = Math.floor(Date.now() / 1000)): CalendarEvent {
  return {
    title: "Website kickoff with Ines",
    start: now + 120,
    end: now + 1920,
    allDay: false,
    attendees: [{ name: "Ines Rocha", email: "ines@example.com" }],
  };
}

/** The optional "How?" after the tick, in the words the sheet shows. */
const HOW: { value: NonNullable<NoticeLog["how"]>; label: string }[] = [
  { value: "aloud", label: "Said it" },
  { value: "chat", label: "In chat" },
  { value: "invite", label: "In the invite" },
];

const hhmm = (unix: number) => new Date(unix * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function whenText(e: CalendarEvent, now = Math.floor(Date.now() / 1000)): string {
  const min = Math.round((e.start - now) / 60);
  if (min > 0) return `Starts in ${min} min`;
  if (min === 0) return "Starting now";
  return `Started ${-min} min ago`;
}

/**
 * Start a recording: the project, the calendar event it's probably for, and consent,
 * asked every time (the box never starts ticked). Starting closes the sheet and the
 * live page takes over.
 */
export function RecordSheet({
  projects,
  selectProject,
  onNewProject,
  onClose,
  onOpenSample,
  onStarted,
}: {
  projects: Project[];
  /** A project just created from this sheet; it becomes the selection. */
  selectProject?: string;
  onNewProject: () => void;
  onClose: () => void;
  /** Opens a fictional sample call as a recording in the chosen project, instead of recording. */
  onOpenSample?: (sampleId: string, project: string) => void;
  onStarted: () => void;
}) {
  const [project, setProject] = useState(selectProject ?? projects[0]?.name ?? "General");
  useEffect(() => {
    if (selectProject) setProject(selectProject);
  }, [selectProject]);
  // Projects load after the sheet can open; keep the selection valid.
  useEffect(() => {
    if (projects.length && !projects.some((p) => p.name === project)) setProject(projects[0].name);
  }, [projects, project]);

  const [event, setEvent] = useState<CalendarEvent | null>(isDesktop ? null : previewEvent);
  useEffect(() => {
    if (isDesktop) currentEvent().then(setEvent);
  }, []);

  const [consent, setConsentState] = useState(false);
  /** When the box was ticked: the notice records when you said you'd told them, not when you pressed Start. */
  const [tickedAt, setTickedAt] = useState<string | null>(null);
  const [how, setHow] = useState<NoticeLog["how"]>(undefined);
  const setConsent = (on: boolean) => {
    setConsentState(on);
    setTickedAt(on ? new Date().toISOString() : null);
    if (!on) setHow(undefined);
  };
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const consentId = useId();

  const copyNotice = async () => {
    try {
      await navigator.clipboard.writeText(NOTICE);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast({ text: "Couldn't copy the notice", tone: "record" });
    }
  };

  const start = async () => {
    if (!consent || starting) return;
    setError(null);
    setStarting(true);
    try {
      const notice: NoticeLog = { by: "you", at: tickedAt ?? new Date().toISOString(), ...(how ? { how } : {}) };
      await startRecording(project, event, !isDesktop, notice);
      onStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStarting(false);
    }
  };

  // ⌘⇧R again starts it, once the box is ticked.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        e.stopImmediatePropagation();
        start();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const other = event?.attendees.find((a) => a.name || a.email);
  const otherName = other ? other.name || other.email.split("@")[0] : (event?.title ?? "");

  return (
    <Dialog onClose={() => !starting && onClose()} aria-label="Start a recording" width={472} className="gap-[22px]! p-7!" dismissible={!starting}>
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 id={titleId} className="m-0 font-serif text-[28px] leading-[34px] font-medium tracking-[-0.015em] text-ink">
            Start a recording
          </h2>
          <p className="m-0 text-ink-2">
            {isDesktop ? "Records the call and your microphone on this Mac." : "Browser preview: the recording is simulated. Run the Mac app to record."}
          </p>
        </div>
        <IconButton aria-label="Close" tooltip={false} className="-mt-0.5 -mr-2" onClick={onClose} disabled={starting}>
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </IconButton>
      </header>

      <div className="flex flex-col gap-2" style={{ animation: "ac-in 280ms 40ms var(--ease) both" }}>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={`${titleId}-project`} className="text-[13px] leading-[18px] font-semibold text-ink">
            Project
          </label>
          <button type="button" onClick={onNewProject} className="press text-[13px] leading-[18px] font-semibold text-verdigris hover:text-verdigris-hover">
            New project
          </button>
        </div>
        <Select id={`${titleId}-project`} value={project} onChange={(e) => setProject(e.target.value)} className="[&>select]:h-10 [&>select]:font-medium">
          {projects.map((p) => (
            <option key={p.id}>{p.name}</option>
          ))}
        </Select>
      </div>

      {event && (
        <div className="flex flex-col gap-2" style={{ animation: "ac-in 280ms 80ms var(--ease) both" }}>
          <span className="text-[13px] leading-[18px] font-semibold text-ink">
            From your calendar <span className="font-medium text-muted">{isDesktop ? "picked automatically" : "a sample, in the browser preview"}</span>
          </span>
          <div className="flex items-center gap-3 rounded-[12px] bg-well py-3 pr-3.5 pl-3.5 shadow-[inset_0_0_0_1px_var(--hairline)]">
            <Avatar name={otherName || "?"} size={32} decorative={!otherName} />
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="t-section truncate text-ink">{event.title || "Untitled event"}</span>
              <span className="text-[13px] leading-[18px] font-medium text-verdigris">
                {whenText(event)} · <span className="font-mono font-normal">{hhmm(event.start)}</span>
              </span>
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2.5 border-y border-hairline py-3.5" style={{ animation: "ac-in 280ms 120ms var(--ease) both" }}>
        <div className="flex items-center gap-3">
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <Tick checked={consent} onChange={setConsent} aria-labelledby={consentId} />
            <span id={consentId} onClick={() => setConsent(!consent)} className="cursor-pointer text-[15px] leading-[22px] text-ink">
              I've told everyone on the call
            </span>
          </span>
          <button
            type="button"
            onClick={copyNotice}
            title={NOTICE}
            className="press inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] px-1 text-[13px] font-semibold text-verdigris hover:text-verdigris-hover"
          >
            <Copy size={13} strokeWidth={2} aria-hidden="true" />
            {copied ? "Copied" : "Copy notice"}
          </button>
        </div>
        {consent && <HowPicker value={how} onChange={setHow} />}
      </div>

      <div className="flex flex-col gap-2.5" style={{ animation: "ac-in 280ms 160ms var(--ease) both" }}>
        <Button variant="record" size="lg" className="h-12 w-full gap-2.5" disabled={!consent} loading={starting} onClick={start}>
          {!starting && <span aria-hidden="true" className="size-[9px] rounded-full bg-white" />}
          {starting ? "Starting…" : "Start recording"}
          {consent && !starting && <span className="font-mono text-[11px] font-normal opacity-80">⌘⇧R</span>}
        </Button>
        {error ? (
          <span role="alert" className="selectable text-[13px] leading-[18px] text-record">
            {error}
          </span>
        ) : consent ? (
          <span className="text-[13px] leading-[18px] text-ink-2">
            {isDesktop ? "macOS asks for permission the first time." : "Nothing is recorded in the browser preview."}
          </span>
        ) : (
          <span className="text-[13px] leading-[18px] text-caution">Tick the box once everyone knows you're recording.</span>
        )}
      </div>

      {onOpenSample && (
        <p className="m-0 text-center text-[13px] leading-[18px] text-ink-2" style={{ animation: "ac-in 280ms 200ms var(--ease) both" }}>
          No call handy?{" "}
          <Menu
            label="Sample recordings"
            align="end"
            width={280}
            items={sampleScripts.map((s) => ({ label: s.title, onSelect: () => onOpenSample(s.id, project) }))}
            trigger={(p) => (
              <button {...p} type="button" className="font-medium text-verdigris hover:text-verdigris-hover">
                Open a sample recording
              </button>
            )}
          />
        </p>
      )}
    </Dialog>
  );
}

/**
 * How you told them, if you want to say: one tap picks, a second clears it. Optional,
 * so Start stays one tap away. It goes into the proof as part of your statement.
 */
function HowPicker({ value, onChange }: { value: NoticeLog["how"]; onChange: (how: NoticeLog["how"]) => void }) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-wrap items-center gap-1.5 pl-[34px]" style={{ animation: "ac-in 240ms var(--ease) both" }}>
      <span id={labelId} className="mr-1 text-[13px] leading-[18px] text-ink-2">
        How? <span className="text-muted">optional</span>
      </span>
      {HOW.map((h) => {
        const on = value === h.value;
        return (
          <button
            key={h.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? undefined : h.value)}
            className={cx(
              "press inline-flex h-7 items-center rounded-full px-2.5 text-[13px] font-medium transition-colors duration-(--dur-1)",
              on ? "bg-verdigris-tint text-verdigris" : "text-ink-2 shadow-[inset_0_0_0_1px_var(--hairline)] hover:text-ink",
            )}
          >
            {h.label}
          </button>
        );
      })}
    </div>
  );
}
