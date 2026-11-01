import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import * as m from "motion/react-m";
import { Button, cx, enter, exit } from "./ui";

/**
 * Pieces shared by the full-screen step flows (first run, Set up payments): the
 * step counter with its bars, a page per step that fades between steps, the big
 * heading, and the footer row of actions.
 */

/** "Step 2 of 4 · Set up payments", with a bar per step; the current one fills as you arrive. */
export function StepProgress({ step, total, label }: { step: number; total: number; label?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="t-eyebrow text-muted">
        Step {step + 1} of {total}
        {label ? ` · ${label}` : ""}
      </span>
      <span aria-hidden="true" className="flex gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="relative h-1 w-8 overflow-hidden rounded-full bg-hairline">
            {i <= step && (
              <span
                // A new key per step replays the fill on the bar you just reached.
                key={i === step ? `now-${step}` : "done"}
                className="absolute inset-0 origin-left rounded-full bg-verdigris"
                style={i === step ? { animation: "ac-strike 520ms 240ms var(--ease) both" } : undefined}
              />
            )}
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * One step's page. Put it directly inside `<AnimatePresence mode="wait">` with a
 * `key`: the old step fades out quickly, then this one fades in and its parts rise
 * in turn (use `rise(i)` on them). The heading takes focus on arrival, so a screen
 * reader starts at the new step and no button shows a focus ring unasked.
 */
export function StepPage({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }, []);
  return (
    <m.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: enter }}
      exit={{ opacity: 0, transition: exit }}
      className={cx("flex flex-col gap-7", className)}
    >
      {children}
    </m.div>
  );
}

/** The step's title (36 px serif, focusable for screen readers) and its one line. */
export function StepHeading({ title, intro, style }: { title: ReactNode; intro?: ReactNode; style?: CSSProperties }) {
  return (
    <header className="flex flex-col gap-2" style={style}>
      <h1 tabIndex={-1} className="t-display m-0 text-ink outline-none">
        {title}
      </h1>
      {intro && <p className="m-0 text-ink-2">{intro}</p>}
    </header>
  );
}

/** The footer: a quiet way out on the left, the step's one primary action on the right. */
export function StepActions({ style, children }: { style?: CSSProperties; children: ReactNode }) {
  return (
    <div className="mt-1 flex items-center justify-between gap-3" style={style}>
      {children}
    </div>
  );
}

/** A quiet text action for the left of StepActions ("Skip for now", "Set up later"). */
export function QuietAction({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <Button variant="quiet" size="lg" onClick={onClick} disabled={disabled} className="-ml-5">
      {children}
    </Button>
  );
}
