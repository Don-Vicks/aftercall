import type { ReactNode } from "react";
import { CheckCircle, EmptyCircle, useChanged } from "./Check";
import { cx } from "./cx";

/**
 * The tick (role="checkbox"): the circle pops full and the check draws itself.
 * Only a change made while it's on screen animates. Name it with aria-label, or
 * aria-labelledby pointing at the row's text.
 */
export function Tick({
  checked,
  onChange,
  size = 22,
  disabled,
  working,
  className,
  ...aria
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  size?: number;
  disabled?: boolean;
  /** Someone (a connected agent) is on it: an arc turns round the empty circle. */
  working?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const play = useChanged(checked);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      {...aria}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx("press group inline-flex shrink-0 rounded-full disabled:cursor-not-allowed disabled:opacity-40", className)}
      style={{ width: size, height: size }}
    >
      {checked ? <CheckCircle size={size} play={play} /> : working ? <WorkingCircle size={size} /> : <EmptyCircle size={size} />}
    </button>
  );
}

/**
 * Text that gets struck through when `on`: the line draws left to right (across
 * every line of wrapped text) and the text settles to muted. Pairs with Tick.
 */
export function Strike({ on, className, children }: { on: boolean; className?: string; children: ReactNode }) {
  return (
    <span
      className={cx(on ? "text-muted" : undefined, className)}
      style={{
        backgroundImage: "linear-gradient(currentColor, currentColor)",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "0 55%",
        backgroundSize: on ? "100% 1.5px" : "0% 1.5px",
        transition: on ? "background-size 240ms var(--ease) 160ms, color 200ms var(--ease) 180ms" : "background-size 120ms var(--ease), color 120ms var(--ease)",
      }}
    >
      {children}
    </span>
  );
}

/** The empty circle with a verdigris arc going round it, like a spinner (it keeps turning with reduced motion: it says work is under way). */
function WorkingCircle({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
      <circle cx="11" cy="11" r="9.25" fill="none" strokeWidth="1.5" stroke="var(--border)" />
      <circle
        cx="11"
        cy="11"
        r="9.25"
        fill="none"
        strokeWidth="1.5"
        strokeDasharray="14 60"
        strokeLinecap="round"
        stroke="var(--verdigris)"
        style={{ transformBox: "fill-box", transformOrigin: "center", animation: "ac-spin 1400ms linear infinite" }}
      />
    </svg>
  );
}
