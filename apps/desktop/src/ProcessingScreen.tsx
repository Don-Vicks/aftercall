import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { formatDuration } from "@aftercall/core";
import { Spinner, cx } from "./ui";

const STAGES = [
  { title: "Secure hardware checked", detail: "Whisper and Qwen3.8-27B attested, fresh nonce", ms: 900 },
  { title: "Transcribed", detail: "Audio deleted from this Mac", ms: 2200 },
  { title: "Writing the summary", detail: "Decisions, action items and follow-ups, each with a quote", ms: 2600 },
  { title: "Signature checked", detail: "Summary signed by the attested model", ms: 700 },
  { title: "Proof recorded on NEAR", detail: "record_proof from your limited key", ms: 1200 },
];

/**
 * Live stages while a meeting is processed. Until the pipeline exists (M2–M3) the
 * stages advance on timers so the flow can be designed and tested end to end.
 */
export function ProcessingScreen({ project, seconds, onDone }: { project: string; seconds: number; onDone: () => void }) {
  const [current, setCurrent] = useState(0);
  const [elapsed, setElapsed] = useState<number[]>([]);

  useEffect(() => {
    if (current >= STAGES.length) {
      const t = setTimeout(onDone, 600);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setElapsed((e) => [...e, STAGES[current].ms / 1000]);
      setCurrent((c) => c + 1);
    }, STAGES[current].ms);
    return () => clearTimeout(t);
  }, [current, onDone]);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="h-9" />
      <div className="mx-auto flex max-w-[680px] flex-col gap-8 px-12 pb-16">
        <header className="flex flex-col gap-3">
          <span className="t-label text-muted">
            {project} · Today · {formatDuration(seconds)}
          </span>
          <h1 className="t-display m-0">New meeting</h1>
          <p className="t-reading m-0 text-muted">Your notes are being made inside NEAR AI's secure hardware. Nothing leaves it except the result.</p>
        </header>

        <ol className="m-0 flex list-none flex-col p-0" aria-live="polite">
          {STAGES.map((stage, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li
                key={stage.title}
                className={cx("grid grid-cols-[28px_minmax(0,1fr)_auto] items-baseline gap-3 border-t border-hairline py-3.5", i === STAGES.length - 1 && "border-b")}
              >
                <span className="self-center">
                  {done ? (
                    <Check size={16} strokeWidth={1.75} className="text-verdigris" aria-label="Done" />
                  ) : active ? (
                    <Spinner />
                  ) : (
                    <span aria-hidden="true" className="block size-3.5 rounded-full border-[1.5px] border-faint" />
                  )}
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className={cx("t-title", !done && !active && "text-muted")}>{stage.title}</span>
                  <span className="text-muted">{stage.detail}</span>
                </div>
                <span className="t-mono text-muted">{done ? `${elapsed[i].toFixed(1)} s` : ""}</span>
              </li>
            );
          })}
        </ol>

        <p className="m-0 text-muted">You can close this window; Aftercall will tell you when your notes are ready.</p>
      </div>
    </main>
  );
}
