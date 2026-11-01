import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { ArrowUpRight, Pause, PenLine, Play, VolumeX, X } from "lucide-react";
import { formatClock } from "@aftercall/core";
import { isDesktop, recorder } from "../recorder";
import { Button, IconButton, Meter, RollingNumber, cx, enter, exit, springs, toast, useLayer } from "../ui";
import { NOTES_HELP, NotesArea, SavedLabel } from "./YourNotes";
import {
  closeNotes,
  dismissSilentWarning,
  isLive,
  levels,
  openNotes,
  setNotes,
  stopRecording,
  togglePause,
  useRecordingSession,
  type RecordingSession,
} from "./session";

const fail = (what: string) => (e: unknown) => toast({ text: `Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}`, tone: "record" });

export const stop = () => stopRecording().catch(fail("stop the recording"));
export const pause = () => togglePause().catch(fail("pause"));

/**
 * The live pill: floats at the bottom of the window while a recording runs, on every
 * page. Your mic and the call as two meters, the time, Pause and Stop. On the
 * recording's own page it says "Stop and make notes"; elsewhere it adds Note, which
 * opens your notes in a drawer above it, and the time opens the recording's page.
 * When the call goes silent it grows a warning (V2Silent).
 */
export function LivePill({ onOpenLive }: { onOpenLive: () => void }) {
  const s = useRecordingSession();
  const live = isLive(s);
  const pill = useRef<HTMLDivElement>(null);

  // Toasts sit above the pill while it's there.
  useLayoutEffect(() => {
    const el = pill.current;
    const root = document.documentElement;
    if (!live || !el) {
      root.style.removeProperty("--toast-lift");
      return;
    }
    const set = () => root.style.setProperty("--toast-lift", `${el.offsetHeight + 16}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--toast-lift");
    };
  }, [live]);

  const warning = live && !s.warningDismissed && (s.callSilent || !s.systemAudio) ? (s.systemAudio ? "silent" : "unavailable") : null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-8 z-40 flex flex-col items-center gap-3 px-6">
      <AnimatePresence>{live && s.drawerOpen && !s.onLivePage && <NotesDrawer key="drawer" s={s} />}</AnimatePresence>
      <AnimatePresence>
        {live && (
          <m.div
            key="pill"
            ref={pill}
            role="group"
            aria-label="Recording controls"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: { ...enter, duration: 0.36 } }}
            exit={{ opacity: 0, y: 8, transition: exit }}
            className="pointer-events-auto flex max-w-full flex-col rounded-[26px] bg-elevated shadow-pill"
          >
            <PillRow s={s} onOpenLive={onOpenLive} />
            <AnimatePresence initial={false}>{warning && <SilentWarning key="warning" kind={warning} />}</AnimatePresence>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PillRow({ s, onOpenLive }: { s: RecordingSession; onOpenLive: () => void }) {
  const full = s.onLivePage;
  const paused = s.phase === "paused";
  const stopping = s.phase === "stopping";
  const callSilent = s.callSilent || !s.systemAudio;
  const status = (
    <>
      <span
        aria-hidden="true"
        className={cx("shrink-0 rounded-full", full ? "size-2.5" : "size-[9px]", paused ? "bg-faint" : "bg-record")}
        style={{ animation: paused ? undefined : "ac-breathe 2s ease-in-out infinite" }}
      />
      <span
        role="timer"
        aria-label={`${paused ? "Paused at" : "Recording"} ${formatClock(s.seconds)}`}
        className={cx(
          "font-mono font-medium tracking-[-0.01em]",
          full ? "min-w-[52px] text-[16px]" : "min-w-12 text-[15px]",
          paused ? "text-muted" : "text-ink",
        )}
      >
        <RollingNumber value={formatClock(s.seconds)} />
      </span>
      <Meter levelRef={levels.mic} bars={full ? 6 : 5} height={full ? 24 : 22} tone="verdigris" label="Your mic" />
      {callSilent ? (
        <Meter level={0} bars={full ? 6 : 5} height={full ? 24 : 22} tone="caution" label="The call, silent" />
      ) : (
        <Meter levelRef={levels.call} bars={full ? 6 : 5} height={full ? 24 : 22} tone="ink" label="The call" />
      )}
    </>
  );
  return (
    <div className={cx("flex items-center", full ? "gap-3.5 py-2 pr-2 pl-[18px]" : "gap-3.5 py-2 pr-2 pl-4")}>
      {full ? (
        <span className="flex items-center gap-3.5">{status}</span>
      ) : (
        <button
          type="button"
          onClick={onOpenLive}
          aria-label="Open the recording"
          className="press -my-1 -ml-2 flex items-center gap-3.5 rounded-full py-1 pl-2"
        >
          {status}
        </button>
      )}
      {full && <span aria-hidden="true" className="h-6 w-px bg-hairline" />}
      {full ? (
        <>
          <Button variant="ghost" className="h-9 rounded-full! bg-well px-3.5 text-ink!" onClick={pause} disabled={stopping}>
            {paused ? <Play size={14} fill="currentColor" aria-hidden="true" /> : <Pause size={14} fill="currentColor" aria-hidden="true" />}
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button variant="record" className="h-9 rounded-full! px-4" onClick={stop} loading={stopping}>
            {!stopping && <span aria-hidden="true" className="size-2.5 rounded-[2px] bg-white" />}
            Stop and make notes
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full! bg-well text-[14px]"
            onClick={openNotes}
            aria-keyshortcuts="Meta+Shift+R"
            title="Your notes (⌘⇧R)"
          >
            <PenLine size={14} strokeWidth={2} aria-hidden="true" />
            Note
          </Button>
          <IconButton aria-label={paused ? "Resume" : "Pause"} className="rounded-full! bg-well text-ink!" onClick={pause} disabled={stopping}>
            {paused ? <Play size={14} fill="currentColor" aria-hidden="true" /> : <Pause size={14} fill="currentColor" aria-hidden="true" />}
          </IconButton>
          <Button variant="record" size="sm" className="rounded-full! px-3.5 text-[14px]" onClick={stop} loading={stopping} aria-label="Stop and make notes">
            {!stopping && <span aria-hidden="true" className="size-[9px] rounded-[2px] bg-white" />}
            Stop
          </Button>
        </>
      )}
    </div>
  );
}

/** V2Silent: no sound from the call (or no access to it at all), and how to allow it. */
function SilentWarning({ kind }: { kind: "silent" | "unavailable" }) {
  const openSettings = () =>
    isDesktop ? recorder.openAudioSettings().catch(fail("open System Settings")) : toast({ text: "System Settings opens from the Mac app", tone: "caution" });
  return (
    <m.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1, transition: springs.gentle }}
      exit={{ height: 0, opacity: 0, transition: exit }}
      className="overflow-hidden"
    >
      <div aria-hidden="true" className="mx-4 h-px bg-hairline" />
      <div role="alert" className="flex w-0 min-w-full flex-col gap-3.5 px-5 pt-[18px] pb-5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-caution-tint text-caution"
            style={{ animation: "ac-pop 320ms 160ms var(--ease) both" }}
          >
            <VolumeX size={18} strokeWidth={2} />
          </span>
          <span className="flex min-w-0 flex-col gap-px">
            <span className="t-title text-ink">{kind === "silent" ? "No sound from the call for 30 s" : "Aftercall can't hear the call"}</span>
            <span className="t-eyebrow text-muted">Your mic is still recording</span>
          </span>
        </div>
        <p className="m-0 text-ink-2">
          {kind === "silent"
            ? "If others are talking, macOS may be keeping the call's audio from Aftercall. Allow it here:"
            : "macOS didn't give Aftercall the call's audio, so only your side is recorded. Allow it here, then start a new recording:"}
        </p>
        <div className="rounded-[10px] px-3 py-2.5 text-[13px] leading-5 text-ink shadow-[inset_0_0_0_1px_var(--hairline)]">
          System Settings{" "}
          <span aria-hidden="true" className="text-muted">
            ›
          </span>{" "}
          Privacy &amp; Security{" "}
          <span aria-hidden="true" className="text-muted">
            ›
          </span>{" "}
          <span className="font-semibold">Screen &amp; System Audio Recording</span>
        </div>
        <div className="flex gap-5 text-[12px] leading-4 text-muted">
          <Legend tone="bg-verdigris">You (mic) · live</Legend>
          <Legend tone="bg-caution">{kind === "silent" ? "The call · silent" : "The call · not recorded"}</Legend>
        </div>
        <div className="mt-0.5 flex gap-2.5">
          <Button variant="primary" className="flex-1" onClick={openSettings}>
            Open System Settings
            <ArrowUpRight size={13} strokeWidth={2.2} aria-hidden="true" />
          </Button>
          <Button variant="secondary" onClick={dismissSilentWarning}>
            Keep recording
          </Button>
        </div>
      </div>
    </m.div>
  );
}

const Legend = ({ tone, children }: { tone: string; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1.5">
    <span aria-hidden="true" className={cx("size-2 rounded-[2px]", tone)} />
    {children}
  </span>
);

/** Your notes over whatever page you're on (the pill's Note, ⌘⇧R). Escape closes it. */
function NotesDrawer({ s }: { s: RecordingSession }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const [restoreTo] = useState(() => document.activeElement);
  useLayer(true, closeNotes);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    return () => {
      if (
        restoreTo instanceof HTMLElement &&
        restoreTo.isConnected &&
        (!document.activeElement || document.activeElement === document.body || el.contains(document.activeElement) || document.activeElement === el)
      ) {
        restoreTo.focus({ preventScroll: true });
      }
    };
  }, []);
  return (
    <m.section
      role="dialog"
      aria-labelledby={titleId}
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: enter }}
      exit={{ opacity: 0, y: 8, scale: 0.98, transition: exit }}
      className="pointer-events-auto flex w-[min(560px,100%)] flex-col gap-3 rounded-lg bg-elevated p-5 shadow-float"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="t-section m-0 text-ink">
          Your notes <span className="font-medium text-muted">only you write here</span>
        </h2>
        <span className="flex items-center gap-1">
          <SavedLabel save={s.notesSave} error={s.notesError} />
          <IconButton aria-label="Close your notes" tooltip="Close" shortcut="esc" size="sm" onClick={closeNotes}>
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </IconButton>
        </span>
      </div>
      <NotesArea
        ref={area}
        aria-labelledby={titleId}
        value={s.notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={6}
        className="min-h-[180px] py-4"
        placeholder="What matters in this call…"
      />
      <p className="m-0 text-[13px] leading-[18px] text-ink-2">{NOTES_HELP}</p>
    </m.section>
  );
}
