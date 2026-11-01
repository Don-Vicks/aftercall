import { useEffect, useRef, useState } from "react";
import { cx } from "./cx";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * A number whose digits roll, each in its own column, when it changes. Nothing
 * moves on first render. Screen readers get the final value once, not the columns.
 * Inherits the font: use it inside t-figure, t-figure-xl or t-mono.
 */
export function RollingNumber({ value, format, className }: { value: number | string; format?: (n: number) => string; className?: string }) {
  const text = typeof value === "number" ? (format ? format(value) : String(value)) : value;
  const chars = Array.from(text);
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
          return /\d/.test(c) ? <Digit key={`d${fromRight}`} digit={Number(c)} arrive={mounted.current} /> : <span key={`c${fromRight}-${c}`}>{c}</span>;
        })}
      </span>
    </span>
  );
}

function Digit({ digit, arrive }: { digit: number; arrive: boolean }) {
  // A column added after the first render (99 -> 100) rolls in; the rest just roll.
  const [rollIn] = useState(arrive);
  return (
    <span className="relative inline-block h-[1lh] overflow-hidden" style={{ animation: rollIn ? "ac-roll var(--dur-3) var(--ease)" : undefined }}>
      <span className="invisible">0</span>
      <span className="absolute inset-x-0 top-0 flex flex-col transition-transform duration-(--dur-3) ease-calm" style={{ transform: `translateY(-${digit * 10}%)` }}>
        {DIGITS.map((n) => (
          <span key={n} className="block h-[1lh] text-center">
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}
