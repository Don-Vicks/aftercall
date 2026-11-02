import { useEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { ArrowLeft } from "lucide-react";
import { formatClock, type Evidence } from "@aftercall/core";
import { CheckCircle } from "./primitives/Check";
import { cx, ease, springs } from "./ui";

/*
 * The words behind a decision or an action item. Hover a row (or focus it with the
 * keyboard) and its quote opens under it with the time it was said; the time jumps to
 * that line in the transcript. Meetings saved before quotes were kept have none, and
 * then nothing opens.
 */

/** How long the pointer rests on a row before its quote opens, so sweeping past a list doesn't open every row. */
const HOVER_MS = 200;
const open = { duration: 0.15, ease };
const close = { duration: 0.12, ease };

/** "Show 02:14 in the transcript". */
export const jumpLabel = (at: number) => `Show ${formatClock(at)} in the transcript`;

/**
 * Whether a row's quote is open: after a short rest of the mouse, or at once when
 * something in the row gets keyboard focus. Spread `bind` on the row.
 */
export function useQuoteReveal(enabled: boolean) {
  const [shown, setShown] = useState(false);
  const hovering = useRef(false);
  const focused = useRef(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const sync = () => setShown(hovering.current || focused.current);

  const bind = {
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      hovering.current = true;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(sync, HOVER_MS);
    },
    onPointerLeave: () => {
      hovering.current = false;
      window.clearTimeout(timer.current);
      sync();
    },
    onFocus: (e: FocusEvent) => {
      // A mouse click focuses the tick too; only keyboard focus opens the quote.
      if (!(e.target as HTMLElement).matches(":focus-visible")) return;
      focused.current = true;
      sync();
    },
    onBlur: (e: FocusEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      focused.current = false;
      sync();
    },
  };
  return { open: enabled && shown, bind: enabled ? bind : {} };
}

/** The time a quote was said, as a small mono chip that jumps to it in the transcript. */
export function TimeChip({ at, onJump, id, className }: { at: number; onJump: () => void; id?: string; className?: string }) {
  return (
    <button
      id={id}
      type="button"
      onClick={onJump}
      aria-label={jumpLabel(at)}
      className={cx(
        "press inline-flex h-5 items-center rounded-full bg-verdigris-tint px-[7px] align-[1px] font-mono text-[11.5px] leading-none font-normal text-verdigris not-italic transition-colors duration-(--dur-1) hover:text-verdigris-hover",
        className,
      )}
    >
      {formatClock(at)}
    </button>
  );
}

/**
 * The quote under a row: a hidden description for screen readers (point the row's
 * control at `descId` with aria-describedby), and the line that opens on hover or focus.
 */
export function QuoteReveal({ evidence, open: shown, descId, onJump, className }: { evidence: Evidence; open: boolean; descId: string; onJump: () => void; className?: string }) {
  const still = useReducedMotion();
  return (
    <>
      <span id={descId} hidden>
        Said at {formatClock(evidence.at)}: “{evidence.quote}”
      </span>
      <AnimatePresence initial={false}>
        {shown && (
          <m.div
            key="quote"
            initial={still ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto", transition: open }}
            exit={still ? { opacity: 0, transition: close } : { opacity: 0, height: 0, transition: close }}
            className={cx("overflow-hidden", className)}
          >
            <p className="t-quote selectable m-0 pt-1.5 text-[15px] leading-[22px] text-ink-2">
              <span aria-hidden="true">“{evidence.quote}”</span> <TimeChip at={evidence.at} onJump={onJump} />
            </p>
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * Highlights a transcript line you jumped to: a verdigris ring (and a tint on the quote)
 * that holds while the page scrolls there, then fades over about 1.5 s. A fade, so it
 * plays with reduced motion too. Returns a function that stops it.
 */
export function flashLine(line: HTMLElement): () => void {
  const css = getComputedStyle(line);
  const accent = css.getPropertyValue("--verdigris").trim() || "#2d5e4f";
  const base = css.boxShadow && css.boxShadow !== "none" ? `, ${css.boxShadow}` : "";
  const ring = (a: number) => `0 0 0 2px color-mix(in srgb, ${accent} ${a}%, transparent), 0 0 0 7px color-mix(in srgb, ${accent} ${Math.round(a * 0.18)}%, transparent)${base}`;
  const timing = { duration: 2100, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };
  const anims = [line.animate([{ boxShadow: ring(0) }, { boxShadow: ring(100), offset: 0.07 }, { boxShadow: ring(100), offset: 0.28 }, { boxShadow: ring(0) }], timing)];
  const mark = line.querySelector<HTMLElement>("[data-jump-quote]");
  if (mark) {
    const rest = getComputedStyle(mark).backgroundColor;
    const lit = `color-mix(in srgb, ${accent} 26%, transparent)`;
    anims.push(mark.animate([{ backgroundColor: rest }, { backgroundColor: lit, offset: 0.07 }, { backgroundColor: lit, offset: 0.28 }, { backgroundColor: rest }], timing));
  }
  return () => anims.forEach((a) => a.cancel());
}

/** "Back to notes", floating in the top bar of the transcript after a jump. */
export function BackPill({ show, onBack, children = "Back to notes" }: { show: boolean; onBack: () => void; children?: ReactNode }) {
  const still = useReducedMotion();
  return (
    <AnimatePresence>
      {show && (
        <m.div
          key="back"
          initial={still ? { opacity: 0 } : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease } }}
          exit={{ opacity: 0, transition: close }}
          className="pointer-events-none absolute inset-x-0 top-[5px] flex justify-center"
        >
          <button
            type="button"
            onClick={onBack}
            className="press pointer-events-auto inline-flex h-[26px] items-center gap-1.5 rounded-full bg-elevated pr-3 pl-2.5 text-[12.5px] font-semibold text-ink shadow-pill hover:text-verdigris"
          >
            <ArrowLeft size={13} strokeWidth={2.2} aria-hidden="true" />
            {children}
          </button>
        </m.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Tracks a list's open count and says when its last open item was just ticked: true
 * from that moment (once per visit), false again if something reopens.
 */
export function useAllDone(open: number, total: number, resetKey?: unknown) {
  const prev = useRef(open);
  const key = useRef(resetKey);
  const played = useRef(false);
  const [justNow, setJustNow] = useState(false);
  useEffect(() => {
    if (key.current !== resetKey) {
      key.current = resetKey;
      prev.current = open;
      setJustNow(false);
      return;
    }
    if (prev.current > 0 && open === 0 && total > 0) setJustNow(true);
    if (open > 0) setJustNow(false);
    prev.current = open;
  }, [open, total, resetKey]);
  const animate = justNow && !played.current;
  useEffect(() => {
    if (!justNow) return;
    const t = window.setTimeout(() => (played.current = true), 900);
    return () => window.clearTimeout(t);
  }, [justNow]);
  return { justNow, animate };
}

/**
 * "All done", folding in under a list when its last open item is ticked: the check pops
 * with the bouncy spring, once. Shown still (no animation) when the list opened all done.
 */
export function AllDone({ show, animate, children }: { show: boolean; animate: boolean; children: ReactNode }) {
  const still = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {show && (
        <m.div
          key="all-done"
          role="status"
          initial={!animate ? false : still ? { opacity: 0 } : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto", transition: { ...springs.gentle, opacity: { duration: 0.24, ease } } }}
          exit={{ opacity: 0, height: 0, transition: close }}
          className="overflow-hidden"
        >
          <m.p
            initial={!animate || still ? false : { opacity: 0, y: 8, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { ...springs.bouncy, delay: 0.08 } }}
            className="m-0 flex origin-left items-center gap-2.5 pt-3.5 text-[14px] leading-5 text-ink-2"
          >
            <CheckCircle size={20} play={animate} />
            <span>
              <span className="font-semibold text-ink">All done.</span> {children}
            </span>
          </m.p>
        </m.div>
      )}
    </AnimatePresence>
  );
}
