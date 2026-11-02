import { useEffect, useLayoutEffect, useRef } from "react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { Flag } from "lucide-react";
import { formatClock } from "@aftercall/core";
import { Button, Meter, RollingNumber, cx, exit, springs } from "../ui";
import { findMoments, mark, type Moment } from "./marks";
import { getSession, isLive, levels, type RecordingSession } from "./session";

/*
 * The live page's timeline: a track across the top that fills as the call goes on,
 * with a quiet trace of who was talking (you above the line in verdigris, the call
 * below it in ink) and a tick for each mark in your notes. Everything here is local:
 * the time, the two levels the recorder already reports, and your notes.
 */

// ---------- the trace: one peak per recorded second, per side ----------

const trace = { id: null as string | null, mic: [] as number[], call: [] as number[], n: [] as number[] };
let sampler = 0;

/** Keeps the average level of each second, for both sides. Paused time isn't recorded, so it isn't drawn. */
function sample() {
  const s = getSession();
  if (!isLive(s)) return;
  if (s.id !== trace.id) {
    trace.id = s.id;
    trace.mic = [];
    trace.call = [];
    trace.n = [];
  }
  if (s.phase !== "recording") return;
  const i = s.seconds;
  // A running mean: speech then reads as a shape, not a solid bar.
  const n = (trace.n[i] ?? 0) + 1;
  trace.n[i] = n;
  trace.mic[i] = (trace.mic[i] ?? 0) + ((s.micSilent ? 0 : levels.mic.current) - (trace.mic[i] ?? 0)) / n;
  trace.call[i] = (trace.call[i] ?? 0) + ((s.callSilent || !s.systemAudio ? 0 : levels.call.current) - (trace.call[i] ?? 0)) / n;
}

/**
 * Samples the levels while a recording runs, on any page, so the timeline has the
 * whole call when you come back to it. The live pill turns it on and off. Levels only,
 * in memory: nothing is saved, and a reloaded window starts the trace from there.
 */
export function useTraceSampler(live: boolean) {
  useEffect(() => {
    if (!live) return;
    sampler = window.setInterval(sample, 100);
    return () => {
      window.clearInterval(sampler);
      sampler = 0;
    };
  }, [live]);
}

/** Lengths the track steps through, so it grows with the call while the first minutes still fill it. */
const STEPS = [2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480].map((m) => m * 60);

/** How long the track is: the shortest step that leaves room ahead of now. Steps, not a smooth stretch, so the trace doesn't shimmer. */
export function trackLength(seconds: number): number {
  return STEPS.find((s) => s >= seconds * 1.08 + 10) ?? Math.ceil((seconds * 1.25) / 3600) * 3600;
}

const BAR = 2;
const GAP = 1;
const HEIGHT = 44;

function draw(canvas: HTMLCanvasElement, seconds: number, span: number) {
  const width = canvas.clientWidth;
  if (!width) return;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
  if (canvas.height !== Math.round(HEIGHT * dpr)) canvas.height = Math.round(HEIGHT * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, HEIGHT);
  const css = getComputedStyle(canvas);
  const you = css.getPropertyValue("--verdigris").trim() || "#2d5e4f";
  const them = css.getPropertyValue("--ink-2").trim() || "#555";
  const rule = css.getPropertyValue("--hairline").trim() || "rgba(0,0,0,.1)";
  const mid = HEIGHT / 2;
  const reach = mid - 3;
  const cols = Math.floor(width / (BAR + GAP));
  const per = span / cols;
  const done = Math.min(cols, Math.ceil(seconds / per));

  // What's still ahead: a hairline.
  ctx.fillStyle = rule;
  ctx.fillRect(done * (BAR + GAP), mid - 0.5, width - done * (BAR + GAP), 1);

  const peak = (list: number[], c: number) => {
    let v = 0;
    const from = Math.floor(c * per);
    const to = Math.max(from + 1, Math.floor((c + 1) * per));
    for (let i = from; i < to && i <= seconds; i++) v = Math.max(v, list[i] ?? 0);
    return v;
  };
  for (let c = 0; c < done; c++) {
    const x = c * (BAR + GAP);
    const up = 1 + peak(trace.mic, c) * reach;
    const down = 1 + peak(trace.call, c) * reach;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = you;
    ctx.fillRect(x, mid - up, BAR, up);
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = them;
    ctx.fillRect(x, mid, BAR, down);
  }
  ctx.globalAlpha = 1;
}

/** "1 min in", "12 min in", "1 h 4 min in"; null in the first minute. */
function minutesIn(seconds: number): { n: number; lead?: string } | null {
  const min = Math.floor(seconds / 60);
  if (min < 1) return null;
  if (min < 60) return { n: min };
  return { n: min % 60, lead: `${Math.floor(min / 60)} h ` };
}

/**
 * The timeline card at the top of the live page. `onPickMark` puts the cursor on a
 * mark's "[12:40]" in your notes when you click its tick.
 */
export function CallTimeline({ s, onPickMark }: { s: RecordingSession; onPickMark: (m: Moment) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const still = useReducedMotion();
  const span = trackLength(s.seconds);
  const moments = findMoments(s.notes).filter((mo) => mo.at <= s.seconds + 1);
  const paused = s.phase === "paused";
  const micQuiet = s.micSilent;
  const callQuiet = s.callSilent || !s.systemAudio;

  // Redrawn four times a second (the current second keeps filling in), on resize and when the theme changes.
  const spanRef = useRef(span);
  spanRef.current = span;
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const paint = () => draw(el, getSession().seconds, spanRef.current);
    paint();
    const t = window.setInterval(paint, 250);
    const ro = new ResizeObserver(paint);
    ro.observe(el);
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    dark.addEventListener("change", paint);
    const mo = new MutationObserver(paint);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    return () => {
      window.clearInterval(t);
      ro.disconnect();
      dark.removeEventListener("change", paint);
      mo.disconnect();
    };
  }, []);

  const head = Math.min(1, s.seconds / span);
  const time = minutesIn(s.seconds);
  // A mark keeps its key while you type around it: its time and which of that time it is.
  const seen = new Map<number, number>();
  const keyed = moments.map((mo) => {
    const n = seen.get(mo.at) ?? 0;
    seen.set(mo.at, n + 1);
    return { mo, key: `${mo.at}:${n}` };
  });

  return (
    <section aria-label="The call so far" className="flex flex-col gap-3 rounded-md bg-elevated px-5 pt-4 pb-3 shadow-1">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="inline-flex items-center gap-2">
          <Meter levelRef={micQuiet ? undefined : levels.mic} level={0} bars={9} height={30} tone={micQuiet ? "caution" : "verdigris"} label={micQuiet ? "Your mic, silent" : "Your mic"} />
          <span aria-hidden="true" className={cx("text-[13px] font-medium", micQuiet ? "text-caution" : "text-ink")}>
            You
          </span>
        </span>
        <span className="inline-flex items-center gap-2">
          <Meter levelRef={callQuiet ? undefined : levels.call} level={0} bars={9} height={30} tone={callQuiet ? "caution" : "ink"} label={callQuiet ? "The call, silent" : "The call"} />
          <span aria-hidden="true" className={cx("text-[13px] font-medium", callQuiet ? "text-caution" : "text-ink")}>
            The call
          </span>
        </span>
        <span className="ml-auto inline-flex items-center gap-4">
          <span className="text-[13px] text-ink-2">
            {paused ? (
              "Paused"
            ) : time ? (
              <>
                {time.lead}
                <span className="font-mono">
                  <RollingNumber value={time.n} />
                </span>{" "}
                min in
              </>
            ) : (
              "Just started"
            )}
            {moments.length > 0 && (
              <>
                <span className="text-muted"> · </span>
                <span className="font-mono">
                  <RollingNumber value={moments.length} />
                </span>{" "}
                {moments.length === 1 ? "mark" : "marks"}
              </>
            )}
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="hover:bg-well"
            onMouseDown={(e) => e.preventDefault()}
            onClick={mark}
            disabled={s.phase === "stopping"}
            aria-keyshortcuts="Meta+Shift+M"
            icon={<Flag size={13} strokeWidth={2} aria-hidden="true" />}
          >
            Mark this moment <span className="font-mono text-[11px] font-normal text-muted">⌘⇧M</span>
          </Button>
        </span>
      </div>

      <div className="relative" style={{ height: HEIGHT }}>
        <canvas ref={canvas} aria-hidden="true" className="block h-full w-full" />
        {/* Where the call is now. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 z-10 w-[2px] -translate-x-1/2 rounded-full transition-[left] duration-1000 ease-linear"
          style={{ left: `${head * 100}%`, background: paused ? "var(--faint)" : "var(--record)" }}
        >
          <span
            className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full"
            style={{ background: paused ? "var(--faint)" : "var(--record)", animation: paused ? undefined : "ac-breathe 2s ease-in-out infinite" }}
          />
        </span>
        <AnimatePresence initial={false}>
          {keyed.map(({ mo, key }) => (
            <m.button
              key={key}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPickMark(mo)}
              aria-label={`Mark at ${formatClock(mo.at)}. Show it in your notes`}
              title={formatClock(mo.at)}
              initial={still ? { opacity: 0 } : { opacity: 0, scaleY: 0.2 }}
              animate={{ opacity: 1, scaleY: 1, transition: still ? { duration: 0.2 } : springs.bouncy }}
              exit={{ opacity: 0, transition: exit }}
              className="group absolute -top-3 -bottom-1 flex w-4 origin-bottom -translate-x-1/2 justify-center"
              style={{ left: `${Math.min(1, mo.at / span) * 100}%` }}
            >
              <span aria-hidden="true" className="h-full w-[2px] rounded-full bg-verdigris" />
              <span aria-hidden="true" className="absolute top-0 size-2.5 rounded-full bg-verdigris ring-2 ring-elevated transition-transform duration-(--dur-1) group-hover:scale-125" />
            </m.button>
          ))}
        </AnimatePresence>
      </div>

      <div aria-hidden="true" className="flex justify-between font-mono text-[11px] leading-4 text-muted">
        <span>00:00</span>
        <span>{formatClock(span)}</span>
      </div>
    </section>
  );
}
