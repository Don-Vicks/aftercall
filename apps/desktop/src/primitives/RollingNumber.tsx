import { useEffect, useRef, useState } from "react";
import { cx } from "./cx";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** How long after a change a figure that mounts still rolls from the value before it. */
const RECENT_MS = 15_000;

/**
 * What each remembered figure last showed, by key, and what it showed before its last
 * change. In memory for this window only. A figure that mounts after a change it didn't
 * see (the wallet opened just after a payment) rolls from the old value, once.
 */
const memory = new Map<string, { text: string; prev?: string; at: number; replayed?: boolean }>();

function note(key: string, text: string) {
  const e = memory.get(key);
  if (!e) memory.set(key, { text, at: Date.now() });
  else if (e.text !== text) memory.set(key, { text, prev: e.text, at: Date.now() });
}

function recall(key: string, text: string, now: number): string | undefined {
  const e = memory.get(key);
  if (!e) return undefined;
  // It changed while nothing showing it was on screen: roll from what was last seen.
  if (e.text !== text) return e.text;
  // Another copy (the sidebar's) rolled it a moment ago: roll here too, once.
  return e.prev !== undefined && !e.replayed && now - e.at < RECENT_MS ? e.prev : undefined;
}

/**
 * The text a remembered figure starts from when it mounts, or undefined when it should
 * just show its value. Read once per mount; a replay is used up once it has played.
 */
export function useRecalledFigure(key: string | undefined, text: string): string | undefined {
  const [start] = useState(() => (key ? recall(key, text, Date.now()) : undefined));
  useEffect(() => {
    if (!key || start === undefined) return;
    const e = memory.get(key);
    if (e && e.text === text) e.replayed = true;
    // Only the mount's own value counts (so `text` isn't a dependency); a later change is an ordinary roll.
  }, [key, start]);
  return start;
}

/**
 * A number whose digits roll, each in its own column, when it changes. Nothing moves on
 * first render, unless `from` is given (or `remember` recalls a value): then it shows that
 * first and rolls to `value` after `delay` ms. `remember` keys a figure shown in more than
 * one place ("wallet-balance"), so a copy that mounts just after a change still rolls.
 * Screen readers get the final value once, not the columns. Inherits the font: use it
 * inside t-figure, t-figure-xl or t-mono. With reduced motion the digits change at once.
 */
export function RollingNumber({
  value,
  format,
  from,
  remember,
  delay = 0,
  duration,
  className,
}: {
  value: number | string;
  format?: (n: number) => string;
  /** Show this first and roll from it to `value` on mount. */
  from?: number | string;
  /** Remember what this figure shows under a key, and recall it on mount (unless `from` is given). */
  remember?: string;
  /** With `from` or a recalled value: how long to wait before rolling, so the page has arrived. */
  delay?: number;
  /** The roll's length in ms (default --dur-3). */
  duration?: number;
  className?: string;
}) {
  const asText = (v: number | string) => (typeof v === "number" ? (format ? format(v) : String(v)) : v);
  const text = asText(value);
  const recalled = useRecalledFigure(from === undefined ? remember : undefined, text);
  const start = from !== undefined ? asText(from) : recalled;
  const [arrived, setArrived] = useState(start === undefined || start === text);
  useEffect(() => {
    if (arrived) return;
    // Two frames at least, so the old digits are painted before they roll.
    const t = setTimeout(() => setArrived(true), Math.max(delay, 34));
    return () => clearTimeout(t);
  }, [arrived, delay]);
  useEffect(() => {
    if (remember && arrived) note(remember, text);
  }, [remember, text, arrived]);

  const shown = arrived ? text : (start ?? text);
  const chars = Array.from(shown);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  return (
    <span className={cx("inline-flex tabular-nums", className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="inline-flex">
        {chars.map((c, i) => {
          // Keyed from the right, so "99.00" -> "100.00" keeps the cents' columns.
          const fromRight = chars.length - i;
          return /\d/.test(c) ? (
            <Digit key={`d${fromRight}`} digit={Number(c)} arrive={mounted.current} duration={duration} />
          ) : (
            <span key={`c${fromRight}-${c}`}>{c}</span>
          );
        })}
      </span>
    </span>
  );
}

function Digit({ digit, arrive, duration }: { digit: number; arrive: boolean; duration?: number }) {
  // A column added after the first render (99 -> 100) rolls in; the rest just roll.
  const [rollIn] = useState(arrive);
  const ms = duration ? `${duration}ms` : "var(--dur-3)";
  return (
    <span className="relative inline-block h-[1lh] overflow-hidden" style={{ animation: rollIn ? `ac-roll ${ms} var(--ease)` : undefined }}>
      <span className="invisible">0</span>
      <span className="absolute inset-x-0 top-0 flex flex-col transition-transform ease-calm" style={{ transform: `translateY(-${digit * 10}%)`, transitionDuration: ms }}>
        {DIGITS.map((n) => (
          <span key={n} className="block h-[1lh] text-center">
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}
