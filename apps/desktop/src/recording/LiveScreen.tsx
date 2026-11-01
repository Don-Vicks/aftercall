import { useEffect, useId, useRef } from "react";
import { Check, MicOff, Monitor, VolumeX } from "lucide-react";
import { isDesktop } from "../recorder";
import { AvatarStack, Pill, SectionTitle } from "../ui";
import { NOTES_HELP, NotesArea, SavedLabel } from "./YourNotes";
import { isLive, setNotes, useLivePage, useRecordingSession } from "./session";

const hhmm = (unix: number) => new Date(unix * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** "Ines Rocha", "Ines and Theo", "Ines, Theo and 2 others". */
function othersText(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} ${names.length - 2 === 1 ? "other" : "others"}`;
}

/**
 * The recording in progress (V2Recording): what it's for, and your notes, which you
 * type while the call runs. The live pill floats below with Pause and Stop.
 */
export function LiveScreen() {
  useLivePage();
  const s = useRecordingSession();
  const notes = useRef<HTMLTextAreaElement>(null);
  const notesId = useId();

  // ⌘⇧R (and the menu bar's Add a note…) put the cursor at the end of your notes.
  useEffect(() => {
    const el = notes.current;
    if (!el || s.focusNotes === 0) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [s.focusNotes]);

  if (!isLive(s) && s.phase !== "starting") {
    return (
      <main className="flex min-w-0 flex-1 flex-col border-l border-hairline bg-raised">
        <div data-tauri-drag-region className="h-9" />
        <p className="m-auto text-ink-2">Not recording.</p>
      </main>
    );
  }

  const event = s.event;
  const others = (event?.attendees ?? []).map((a) => a.name || a.email.split("@")[0]).filter(Boolean);
  const paused = s.phase === "paused";
  const eyebrow = [
    s.project,
    s.startedAt ? `started ${hhmm(s.startedAt)}` : null,
    event ? (s.eventIsSample ? "sample event, browser preview" : "from your calendar") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const title = event?.title || (s.startedAt ? `Recording ${hhmm(s.startedAt)}` : "New recording");

  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
      <div className="mx-auto flex max-w-[720px] flex-col gap-8 px-12 pt-5 pb-40">
        <header className="flex flex-col gap-2.5" style={{ animation: "ac-in 320ms var(--ease) both" }}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="t-eyebrow text-muted">{eyebrow}</span>
            <span className="flex flex-wrap items-center gap-2" role="status">
              {/* Which side went silent stays here after "Keep recording" hides the pill's warning. */}
              {s.micSilent && (
                <Pill tone="caution" icon={<MicOff size={12} strokeWidth={2.2} aria-hidden="true" />}>
                  {s.micStopped ? "Mic stopped" : "Mic silent"}
                </Pill>
              )}
              {(s.callSilent || !s.systemAudio) && (
                <Pill tone="caution" icon={<VolumeX size={12} strokeWidth={2.2} aria-hidden="true" />}>
                  {s.systemAudio ? "Call silent" : "Call not recorded"}
                </Pill>
              )}
              {paused ? (
                <Pill tone="record" icon={<span aria-hidden="true" className="size-1.5 rounded-full bg-current opacity-60" />}>
                  Paused
                </Pill>
              ) : (
                <Pill tone="record" live>
                  Recording
                </Pill>
              )}
            </span>
          </div>
          <h1 className="t-display m-0 text-ink">{title}</h1>
          <div className="flex flex-wrap items-center gap-2.5">
            {others.length > 0 && (
              <>
                <AvatarStack people={["You", ...others]} max={4} size={28} ring="raised" />
                <span className="text-ink-2">You and {othersText(others)}</span>
                <span aria-hidden="true" className="text-muted">
                  ·
                </span>
              </>
            )}
            <span className="inline-flex items-center gap-1.5 text-ink-2">
              <Check size={14} strokeWidth={2} className="text-verdigris" aria-hidden="true" />
              You told everyone it's recorded
            </span>
          </div>
        </header>

        <section aria-labelledby={notesId} className="flex flex-col gap-3" style={{ animation: "ac-in 320ms 60ms var(--ease) both" }}>
          <div className="flex items-baseline justify-between gap-3">
            <SectionTitle id={notesId}>
              Your notes <span className="font-medium text-muted">only you write here</span>
            </SectionTitle>
            <SavedLabel save={s.notesSave} error={s.notesError} />
          </div>
          <NotesArea
            ref={notes}
            aria-labelledby={notesId}
            aria-keyshortcuts="Meta+Shift+R"
            value={s.notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-[300px]"
            placeholder="Type what matters as it happens…"
          />
          <p className="m-0 text-ink-2">{NOTES_HELP}</p>
        </section>

        <section
          className="flex items-center gap-3.5 rounded-md px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--hairline)]"
          style={{ animation: "ac-in 320ms 120ms var(--ease) both" }}
        >
          <Monitor size={18} strokeWidth={1.75} className="shrink-0 text-faint" aria-hidden="true" />
          <span className="flex-1 text-ink-2">
            {isDesktop
              ? "Switch to your call: a small recorder stays on top, the menu bar shows the time, and ⌘⇧R from any app brings back your notes."
              : "In the Mac app, switching to your call shows a small recorder on top, and the menu bar shows the time."}
          </span>
        </section>
      </div>
    </main>
  );
}
