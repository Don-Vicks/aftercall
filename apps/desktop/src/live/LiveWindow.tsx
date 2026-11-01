import { Pause, Play } from "lucide-react";
import { formatClock } from "@aftercall/core";
import { liveWindow } from "../recorder";
import { Meter, RollingNumber, cx } from "../ui";
import { isLive, levels, stopRecording, togglePause, useRecordingSession } from "../recording/session";

/**
 * The floating recorder (V2Floating, "In a call"): a 320×64 pill on top of the call
 * while the main window is in the background. The time, your mic and the call,
 * Open notes, Pause and Stop. Drag it anywhere but the buttons.
 */
export function LiveWindow() {
  const s = useRecordingSession();
  if (!isLive(s)) return null;
  const paused = s.phase === "paused";
  const stopping = s.phase === "stopping";
  const callSilent = s.callSilent || !s.systemAudio;

  const stop = async () => {
    try {
      await stopRecording();
    } catch (e) {
      console.error(e);
    }
    // The main window shows the notes being made.
    await liveWindow.showMain().catch(() => {});
  };

  return (
    <div
      data-tauri-drag-region
      role="group"
      aria-label="Floating recorder"
      className="flex h-16 w-80 items-center gap-2 rounded-full bg-elevated pr-3.5 pl-5 shadow-[inset_0_0_0_1px_var(--hairline)]"
    >
      {/* Not a target, so a drag on the time or the bars moves the window. */}
      <span className="pointer-events-none flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cx("size-[9px] shrink-0 rounded-full", paused ? "bg-faint" : "bg-record")}
          style={{ animation: paused ? undefined : "ac-breathe 2s ease-in-out infinite" }}
        />
        <span role="timer" className={cx("min-w-[46px] shrink-0 font-mono text-[15px] font-medium tracking-[-0.01em]", paused ? "text-muted" : "text-ink")}>
          <RollingNumber value={formatClock(s.seconds)} />
        </span>
        <Meter levelRef={levels.mic} bars={5} tone="verdigris" label="Your mic" />
        {callSilent ? (
          <Meter level={0} bars={5} tone="caution" label="The call, silent" className="-ml-0.5" />
        ) : (
          <Meter levelRef={levels.call} bars={5} tone="ink" label="The call" className="-ml-0.5" />
        )}
      </span>
      <button
        type="button"
        onClick={() => liveWindow.openNotes()}
        className="press ml-auto shrink-0 px-0.5 text-[13px] font-semibold whitespace-nowrap text-verdigris hover:text-verdigris-hover"
      >
        Open notes
      </button>
      <button
        type="button"
        onClick={() => togglePause().catch(console.error)}
        disabled={stopping}
        aria-label={paused ? "Resume" : "Pause"}
        title={paused ? "Resume" : "Pause"}
        className="press inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-well text-ink disabled:opacity-40"
      >
        {paused ? <Play size={14} fill="currentColor" aria-hidden="true" /> : <Pause size={14} fill="currentColor" aria-hidden="true" />}
      </button>
      <button
        type="button"
        onClick={stop}
        disabled={stopping}
        aria-label="Stop and make notes"
        title="Stop and make notes"
        className="press -ml-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-record disabled:opacity-40"
      >
        <span aria-hidden="true" className="size-2.5 rounded-[2px] bg-white" />
      </button>
    </div>
  );
}
