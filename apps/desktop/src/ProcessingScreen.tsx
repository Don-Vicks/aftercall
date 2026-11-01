import { useEffect, useState } from "react";
import { formatDuration } from "@aftercall/core";
import { ProcessHeader, ProcessingSteps, STEP_IDS, VerifiedSeal } from "./recording/processing";

/** How long each step takes in the walk-through, in ms. */
const PACE = [900, 2200, 2600, 700, 400, 1200];

/**
 * The browser preview's stand-in for processing (pnpm dev:ui has no recorder and no
 * NEAR AI): the same steps as the Mac app, advancing on timers, then the sample
 * meeting. It says it's simulated; the real run is RecordingScreen.
 */
export function ProcessingScreen({ project, seconds, onDone }: { project: string; seconds: number; onDone: () => void }) {
  const [at, setAt] = useState(0);
  const [times, setTimes] = useState<number[]>([]);
  const finished = at >= STEP_IDS.length;

  useEffect(() => {
    if (finished) {
      const t = setTimeout(onDone, 1600);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setTimes((x) => [...x, PACE[at] / 1000]);
      setAt((a) => a + 1);
    }, PACE[at]);
    return () => clearTimeout(t);
  }, [at, finished, onDone]);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
      <div className="mx-auto flex max-w-[680px] flex-col gap-8 px-12 pt-5 pb-16">
        <ProcessHeader
          eyebrow={`${project} · Today · ${formatDuration(seconds)}`}
          title="New meeting"
          lede={
            finished
              ? "Your notes are ready."
              : "Browser preview: these steps are simulated on timers. In the Mac app each one runs for real, in NEAR AI secure hardware."
          }
        />
        {finished && <VerifiedSeal preview onOpen={onDone} />}
        <ProcessingSteps view={{ at, times }} />
        {!finished && <p className="m-0 text-ink-2">You can leave this page. Aftercall tells you when your notes are ready.</p>}
      </div>
    </main>
  );
}
