import type { ReactNode } from "react";
import { cx } from "./cx";

export type PillTone = "verdigris" | "caution" | "record" | "muted";

const tones: Record<PillTone, string> = {
  verdigris: "bg-verdigris-tint text-verdigris",
  caution: "bg-caution-tint text-caution",
  record: "bg-record-tint text-record",
  muted: "bg-elevated text-ink-2 shadow-1",
};

/**
 * Status pill, uppercase. Status colours always come with a word, never alone.
 * `live` adds the breathing dot (RECORDING).
 */
export function Pill({ tone, icon, live, className, children }: { tone: PillTone; icon?: ReactNode; live?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cx("t-label inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5", tones[tone], className)}>
      {live && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" style={{ animation: "ac-breathe 2s ease-in-out infinite" }} />}
      {icon}
      {children}
    </span>
  );
}

/** A section title in sentence case with a muted count after it: "Follow-ups 3". */
export function SectionTitle({ id, count, as: Tag = "h2", className, children }: { id?: string; count?: ReactNode; as?: "h2" | "h3"; className?: string; children: ReactNode }) {
  return (
    <Tag id={id} className={cx("t-section m-0 text-ink", className)}>
      {children}
      {count !== undefined && count !== null && <span className="ml-1.5 font-medium text-muted">{count}</span>}
    </Tag>
  );
}
