"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import l from "../landing.module.css";

/*
 * The landing's motion, in one place.
 *
 * Final state first: the server renders every moment finished. Motion is opt-in:
 * layout.tsx puts `motion` on <html> before paint (no reduced motion, no automation).
 * Only then does a moment "arm" (show its start state) once it has mounted below the
 * fold, and "play" when it scrolls into view. CSS does the moving, keyed on
 * data-state="armed" | "play"; a few parts (the recorder, countdowns, typing) are
 * small components that read the same state from PlayContext.
 *
 * Only transform and opacity animate. Entries 240–320 ms, exits faster, all on --ease.
 */

/** Every timing on the page, in ms. The CSS mirrors these where it does the moving. */
export const TIMING = {
  reveal: 320,
  /*
   * Moment 1, the live recorder (section 2):
   *   0      ⌘ ⇧ R keys press in turn, 90 apart
   *   420    record sheet in
   *   1000   "I've told everyone on the call" ticks; Start recording enables
   *   1400   Start recording pressed
   *   1560   sheet out
   *   1640   recorder drops in at 00:00; menu bar timer in; the dot breathes
   *   3200   "Two minutes in": the timer rolls to 02:11
   *   4000   your line is said, 30 ms a letter; your meter leads
   *   6900   the note on what happens to it after the call pops
   *   7600   Your notes in; line 2 types at 40 ms a letter
   *   loop   timer +1 s, meters at 12 Hz, tiles glow with their side
   */
  call: { keys: 0, sheetIn: 420, tick: 1000, start: 1400, sheetOut: 1560, recorder: 1640, jump: 3200, said: 4000, sayEvery: 30, heard: 6900, notes: 7600, typeEvery: 40, meterEvery: 83 },
  /*
   * Moment 3, approve (the hero, and section 3, step 4):
   *   +200   "fifty dollar" highlights in the quote (600 ms); +760 the Heard row pops
   *   +1400  Approve payment pressed by itself
   *   0–5 s  "Paying in 5…" with Undo, the bar empties, the digit rolls each second
   *   5 s    the amount slides into "✓ 50.00 USDC paid 14:07"; Pay → Paid Designer
   */
  approve: { autoStart: 1400, grace: 5000 },
  /* The Ask demo's question types at 35 ms a letter. */
  ask: { typeEvery: 35, startAfter: 260 },
  /* The tick demo ticks the first row 600 ms after its panel opens. */
  tick: { after: 600 },
} as const;

declare global {
  interface Window {
    __acMotion?: boolean;
  }
}

export function motionOn(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("motion");
}

// ---------- one shared IntersectionObserver per option set ----------

type Cb = (entry: IntersectionObserverEntry) => void;
const observers = new Map<string, { io: IntersectionObserver; cbs: Map<Element, Cb> }>();

export function watch(el: Element, cb: Cb, opts: { threshold?: number; rootMargin?: string } = {}): () => void {
  const threshold = opts.threshold ?? 0.25;
  const rootMargin = opts.rootMargin ?? "0px 0px -10% 0px";
  const key = `${threshold}|${rootMargin}`;
  let o = observers.get(key);
  if (!o) {
    const cbs = new Map<Element, Cb>();
    const io = new IntersectionObserver((entries) => entries.forEach((e) => cbs.get(e.target)?.(e)), { threshold, rootMargin });
    o = { io, cbs };
    observers.set(key, o);
  }
  o.cbs.set(el, cb);
  o.io.observe(el);
  const mine = o;
  return () => {
    mine.cbs.delete(el);
    mine.io.unobserve(el);
  };
}

/** True while `ref` is on screen and the tab is visible. For loops. */
export function useInView(ref: RefObject<Element | null>, threshold = 0): boolean {
  const [seen, setSeen] = useState(false);
  const [tabVisible, setTabVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = watch(el, (e) => setSeen(e.isIntersecting), { threshold, rootMargin: "0px" });
    const onVis = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ref, threshold]);
  return seen && tabVisible;
}

// ---------- reveals ----------

/**
 * Mounted once. Marks the page's script as running (so the gate in layout.tsx keeps
 * motion on) and reveals every [data-reveal] element the first time it enters view.
 */
export function MotionRoot() {
  // The header's Download button stays hidden while the hero's own is on screen.
  useEffect(() => {
    const cta = document.getElementById("hero-cta");
    if (!cta) return;
    const html = document.documentElement;
    const stop = watch(cta, (e) => (html.dataset.heroCta = e.isIntersecting ? "in" : "out"), { threshold: 0, rootMargin: "-64px 0px 0px 0px" });
    return () => {
      stop();
      delete html.dataset.heroCta;
    };
  }, []);
  useEffect(() => {
    window.__acMotion = true;
    if (!motionOn()) return;
    const stops: (() => void)[] = [];
    document.querySelectorAll("[data-reveal]").forEach((el) => {
      const stop = watch(el, (e) => {
        if (!e.isIntersecting) return;
        el.setAttribute("data-in", "");
        stop();
      });
      stops.push(stop);
    });
    return () => stops.forEach((s) => s());
  }, []);
  return null;
}

// ---------- moments ----------

export type PlayState = "final" | "armed" | "play";
export const PlayContext = createContext<{ state: PlayState; run: number }>({ state: "final", run: 0 });
export const usePlay = () => useContext(PlayContext);

/**
 * A moment: arms on mount (motion only), plays once when `threshold` of it is in view.
 * `replay` adds a small Replay button; `loop` keeps data-visible current so CSS loops pause off screen.
 */
export function Moment({
  children,
  className,
  style,
  threshold = 0.25,
  replay,
  replayLabel = "Replay",
  loop,
  role,
  as: Tag = "div",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  threshold?: number;
  replay?: boolean;
  replayLabel?: string;
  loop?: boolean;
  role?: string;
  as?: "div" | "section" | "figure" | "ol" | "ul" | "article";
} & Record<`data-${string}` | `aria-${string}`, string | undefined>) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PlayState>("final");
  const [run, setRun] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || !motionOn()) return;
    setState("armed");
    const stop = watch(
      el,
      (e) => {
        if (!e.isIntersecting) return;
        setState("play");
        setRun((r) => r + 1);
        stop();
      },
      { threshold },
    );
    let stopVis = () => {};
    if (loop) stopVis = watch(el, (e) => setVisible(e.isIntersecting), { threshold: 0, rootMargin: "0px" });
    return () => {
      stop();
      stopVis();
    };
  }, [threshold, loop]);

  const again = useCallback(() => {
    setState("armed");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setState("play");
        setRun((r) => r + 1);
      }),
    );
  }, []);

  const Any = Tag as "div";
  return (
    <PlayContext.Provider value={{ state, run }}>
      <Any ref={ref} className={className} style={style} role={role} data-state={state} data-visible={visible ? "" : undefined} {...rest}>
        {children}
        {replay && state !== "final" ? <ReplayButton onClick={again} label={replayLabel} /> : null}
      </Any>
    </PlayContext.Provider>
  );
}

export function ReplayButton({ onClick, label = "Replay" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className={`${l.replay} press`} onClick={onClick}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" />
        <path d="M3 3v5h5" />
      </svg>
      {label}
    </button>
  );
}

// ---------- a digit that rolls ----------

/**
 * Text whose digits roll to their new value (translateY, 280 ms). Other characters
 * are fixed. Each digit column is 1ch wide, so nothing shifts. The 0–9 strips are CSS
 * generated content (.digitCol::before), so text extraction and screen readers get the
 * value once, as plain text.
 */
export function Rolling({ value, className, still }: { value: string; className?: string; still?: boolean }) {
  return (
    <span className={`${l.rolling}${className ? ` ${className}` : ""}`} data-still={still ? "" : undefined}>
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" className={l.rollingChars}>
        {value.split("").map((c, i) =>
          /\d/.test(c) ? (
            <span key={i} className={l.digit}>
              <span className={l.digitCol} style={{ transform: `translateY(${-Number(c) * 10}%)` }} />
              <span className={l.digitSizer} />
            </span>
          ) : (
            <span key={i}>{c}</span>
          ),
        )}
      </span>
    </span>
  );
}
