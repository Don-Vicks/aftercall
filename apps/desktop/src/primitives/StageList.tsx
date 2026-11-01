import type { ReactNode } from "react";
import { CheckCircle, EmptyCircle, useChanged } from "./Check";
import { cx } from "./cx";
import { Spinner } from "./Spinner";

export type StageState = "done" | "active" | "todo";

export interface Stage {
  id: string;
  label: ReactNode;
  /** One line under the label: a timing, a model name. */
  detail?: ReactNode;
  state: StageState;
}

const said: Record<StageState, string> = { done: "done", active: "in progress", todo: "not started" };

/**
 * Steps that tick off in order, as processing does: done ones show a check that
 * draws itself when it lands (not when the list first appears), the active one
 * spins, the rest wait as empty circles. Stagger the states yourself (90 ms apart).
 */
export function StageList({ stages, className }: { stages: Stage[]; className?: string }) {
  return (
    <ol className={cx("m-0 flex list-none flex-col gap-3 p-0", className)}>
      {stages.map((s) => (
        <li key={s.id} className="flex items-start gap-3">
          <Mark state={s.state} />
          <span className="flex min-w-0 flex-col">
            <span className={s.state === "todo" ? "text-muted" : "text-ink"}>
              {s.label}
              <span className="sr-only">, {said[s.state]}</span>
            </span>
            {s.detail && <span className="text-[13px] leading-[18px] text-ink-2">{s.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Mark({ state }: { state: StageState }) {
  const play = useChanged(state);
  return (
    <span className="inline-flex size-5 shrink-0 items-center justify-center pt-px">
      {state === "done" ? <CheckCircle size={20} play={play} /> : state === "active" ? <Spinner size={16} /> : <EmptyCircle size={20} stroke="var(--hairline)" />}
    </span>
  );
}
