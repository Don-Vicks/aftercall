import type { ReactNode } from "react";
import { CheckCircle, EmptyCircle, useChanged } from "./Check";
import { cx } from "./cx";
import { Spinner } from "./Spinner";

export type StageState = "done" | "active" | "todo" | "failed";

export interface Stage {
  id: string;
  label: ReactNode;
  /** One line under the label: a timing, a model name. */
  detail?: ReactNode;
  state: StageState;
  /** Right of the label, as the time a step took (`rows` only). */
  aside?: ReactNode;
  /** Under the detail, as chips of the checks a step ran. */
  extra?: ReactNode;
}

const said: Record<StageState, string> = { done: "done", active: "in progress", todo: "not started", failed: "failed" };

/**
 * Steps that tick off in order, as processing does: done ones show a check that
 * draws itself when it lands (not when the list first appears), the active one
 * spins, a failed one pops a cross, the rest wait as empty circles. Stagger the
 * states yourself (90 ms apart). `rows` is the processing page's layout: steps
 * between hairlines, titles at t-title, an `aside` on the right.
 */
export function StageList({ stages, rows = false, className }: { stages: Stage[]; rows?: boolean; className?: string }) {
  return (
    <ol className={cx("m-0 flex list-none flex-col p-0", rows ? "border-t border-hairline" : "gap-3", className)}>
      {stages.map((s) => (
        <li key={s.id} className={cx("flex items-start", rows ? "gap-3.5 border-b border-hairline py-3.5" : "gap-3")}>
          <Mark state={s.state} rows={rows} />
          <span className={cx("flex min-w-0 flex-1 flex-col", rows && "gap-1.5")}>
            <span className={cx(rows && "flex items-baseline justify-between gap-3")}>
              <span className={cx(rows && "t-title", s.state === "todo" ? "text-muted" : "text-ink")}>
                {s.label}
                <span className="sr-only">, {said[s.state]}</span>
              </span>
              {rows && s.aside ? <span className="t-mono shrink-0 text-[12px] text-muted">{s.aside}</span> : null}
            </span>
            {s.detail && <span className={rows ? (s.state === "todo" ? "text-muted" : "text-ink-2") : "text-[13px] leading-[18px] text-ink-2"}>{s.detail}</span>}
            {s.extra}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Mark({ state, rows }: { state: StageState; rows: boolean }) {
  const play = useChanged(state);
  return (
    <span className="inline-flex size-5 shrink-0 items-center justify-center pt-px">
      {state === "done" ? (
        <CheckCircle size={20} play={play} />
      ) : state === "active" ? (
        <Spinner size={16} />
      ) : state === "failed" ? (
        <FailedCircle play={play} />
      ) : (
        <EmptyCircle size={20} stroke={rows ? "var(--border)" : "var(--hairline)"} />
      )}
    </span>
  );
}

function FailedCircle({ play }: { play: boolean }) {
  return (
    <svg width={20} height={20} viewBox="0 0 22 22" aria-hidden="true" style={{ animation: play ? "ac-pop 320ms var(--ease) both" : undefined }}>
      <circle cx="11" cy="11" r="10" fill="var(--record)" />
      <path d="M7.6 7.6l6.8 6.8M14.4 7.6l-6.8 6.8" fill="none" stroke="var(--elevated)" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}
