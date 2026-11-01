import { useEffect, useRef, type RefObject } from "react";
import { cx } from "./cx";

/** Speech RMS from the recorder sits around 0.02–0.3; this maps it to 0..1 for a Meter. */
export const rmsToLevel = (rms: number) => Math.min(1, Math.sqrt(Math.max(0, rms) / 0.3));

const colours = { verdigris: "var(--verdigris)", ink: "var(--ink-2)", record: "var(--record)" };

/** Taller in the middle, like a voice. */
function profile(bars: number): number[] {
  return Array.from({ length: bars }, (_, i) => {
    const d = Math.abs(i - (bars - 1) / 2) / Math.max(1, (bars - 1) / 2);
    return 1 - d * 0.45;
  });
}

const scale = (level: number, weight: number) => 0.18 + 0.82 * Math.min(1, level * weight);

/**
 * Bars that show a sound level (0..1). Feed it `level` from state, or `levelRef`,
 * a ref you update as audio arrives: the bars then follow it every animation frame
 * without re-rendering. Under reduced motion the bars still show the level, without
 * the wobble.
 */
export function Meter({
  level = 0,
  levelRef,
  bars = 5,
  height = 22,
  tone = "verdigris",
  label,
  className,
}: {
  level?: number;
  levelRef?: RefObject<number>;
  bars?: number;
  height?: number;
  /** verdigris for your mic, ink for the call. */
  tone?: keyof typeof colours;
  /** "Your mic"; without it the meter is decorative. */
  label?: string;
  className?: string;
}) {
  const els = useRef<(HTMLSpanElement | null)[]>([]);
  const shape = profile(bars);

  useEffect(() => {
    if (!levelRef) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const frame = (t: number) => {
      const l = Math.max(0, Math.min(1, levelRef.current ?? 0));
      els.current.forEach((el, i) => {
        if (!el) return;
        const wobble = still ? 1 : 0.85 + 0.15 * Math.sin(t / 110 + i * 1.7);
        el.style.transform = `scaleY(${scale(l, shape[i] * wobble)})`;
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [levelRef, bars]);

  const l = Math.max(0, Math.min(1, level));
  return (
    <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cx("inline-flex items-center gap-[2px]", className)} style={{ height }}>
      {shape.map((w, i) => (
        <span
          key={i}
          ref={(el) => {
            els.current[i] = el;
          }}
          className="h-full w-[3px] rounded-[2px] transition-transform duration-75 ease-linear"
          style={{ background: colours[tone], transform: levelRef ? undefined : `scaleY(${scale(l, w)})` }}
        />
      ))}
    </span>
  );
}
