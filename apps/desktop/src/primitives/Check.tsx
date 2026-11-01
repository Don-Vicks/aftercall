import { useState } from "react";

/**
 * True from the first time `value` changes after mount: the cue to play an
 * entrance. Things that are already done when a page opens don't animate.
 */
export function useChanged<T>(value: T): boolean {
  const [first, setFirst] = useState(value);
  const [changed, setChanged] = useState(false);
  if (!changed && value !== first) {
    setFirst(value);
    setChanged(true);
  }
  return changed;
}

/** The filled verdigris circle with its check, as the tick and finished stages draw it. */
export function CheckCircle({ size = 22, play }: { size?: number; play: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
      <circle
        cx="11"
        cy="11"
        r="10"
        fill="var(--verdigris)"
        style={{ transformBox: "fill-box", transformOrigin: "center", animation: play ? "ac-fill 320ms cubic-bezier(.3,1.5,.5,1)" : undefined }}
      />
      <path
        d="M6.5 11.5l3 3 6-6.5"
        fill="none"
        stroke="var(--on-verdigris)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="14"
        style={{ animation: play ? "ac-draw 220ms 120ms var(--ease) both" : undefined }}
      />
    </svg>
  );
}

export function EmptyCircle({ size = 22, stroke = "var(--border)" }: { size?: number; stroke?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
      <circle cx="11" cy="11" r="9.25" fill="none" strokeWidth="1.5" stroke={stroke} />
    </svg>
  );
}
