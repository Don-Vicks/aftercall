import { useCallback, useEffect, useState } from "react";
import { formatDuration } from "@aftercall/core";
import { NotesReady, ProcessHeader, ProcessingSteps, STEP_IDS } from "./recording/processing";
import { notesDigest, transcriptStats } from "./notesDigest";
import { markFresh } from "./freshItems";
import { syncWithAda } from "./sample";

/** How long each step takes in the walk-through, in ms. */
const PACE = [900, 2200, 2600, 700, 400, 1200];
const TRANSCRIBE = STEP_IDS.indexOf("transcribe");
const SUMMARISE = STEP_IDS.indexOf("summarise");

/**
 * The browser preview's stand-in for processing (pnpm dev:ui has no recorder and no
 * NEAR AI): the same steps as the Mac app, advancing on timers, then the sample
 * meeting. It says it's simulated; the real run is RecordingScreen. The parts, the
 * transcript counts and the digest are the sample meeting's own, which is what opens.
 */
export function ProcessingScreen({ project, seconds, onDone }: { project: string; seconds: number; onDone: () => void }) {
  const [at, setAt] = useState(0);
  const [times, setTimes] = useState<number[]>([]);
  const [since, setSince] = useState(() => Date.now());
  const [partsDone, setPartsDone] = useState(0);
  const finished = at >= STEP_IDS.length;
  // As the Mac app splits audio: each side on its own, in parts of up to 5 minutes.
  const total = 2 * Math.max(1, Math.ceil(syncWithAda.durationSec / 300));

  useEffect(() => {
    if (finished) {
      // Everything in the sample's notes is new until its page has shown it. No jump: Open notes or ↵.
      markFresh(syncWithAda);
      return;
    }
    const timers: number[] = [];
    if (at === TRANSCRIBE) {
      setPartsDone(0);
      for (let i = 1; i <= total; i++) timers.push(window.setTimeout(() => setPartsDone(i), (PACE[at] / total) * i - 60));
    }
    timers.push(
      window.setTimeout(() => {
        setTimes((x) => [...x, PACE[at] / 1000]);
        setSince(Date.now());
        setAt((a) => a + 1);
      }, PACE[at]),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [at, finished, total]);

  const open = useCallback(() => onDone(), [onDone]);
  const transcript = at >= SUMMARISE ? transcriptStats(syncWithAda.transcript) : undefined;

  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
      <div className="mx-auto flex max-w-[680px] flex-col gap-8 px-12 pt-5 pb-16">
        <ProcessHeader
          eyebrow={`${project} · Today · ${formatDuration(seconds)}`}
          title="New meeting"
          lede={finished ? undefined : "Browser preview: these steps are simulated on timers. In the Mac app each one runs for real, in NEAR AI secure hardware."}
        />
        {finished && <NotesReady preview digest={notesDigest(syncWithAda)} onOpen={open} />}
        <ProcessingSteps
          view={{
            at,
            times,
            since,
            part: at === TRANSCRIBE ? `${Math.min(partsDone + 1, total)} of ${total}` : undefined,
            parts: at === TRANSCRIBE ? { done: partsDone, total } : undefined,
            transcript,
            others: "Ada",
          }}
        />
        {!finished && <p className="m-0 text-ink-2">You can leave this page. Aftercall tells you when your notes are ready.</p>}
      </div>
    </main>
  );
}
