import type { CSSProperties, ReactNode } from "react";
import { ChevronLeft, Info, Lock, Search } from "lucide-react";
import { cx } from "./ui";

/**
 * The page frame the library screens share (People, Person, Ask, All meetings,
 * Action items, Privacy): flat raised paper under the title-bar strip, one column.
 */
export function Page({ width = 760, className, children }: { width?: number; className?: string; children: ReactNode }) {
  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
      <div className={cx("mx-auto flex flex-col gap-7 px-12 pt-5 pb-[72px]", className)} style={{ maxWidth: width + 96 }}>
        {children}
      </div>
    </main>
  );
}

/** Entries rise in 320 ms, 40 ms apart, as on the boards. Reduced motion turns ac-in into a fade. */
export const rise = (i: number): CSSProperties => ({ animation: `ac-in 320ms ${i * 40}ms var(--ease) both` });

export function PageHeader({ eyebrow, title, intro, back, index = 0 }: { eyebrow?: ReactNode; title: ReactNode; intro?: ReactNode; back?: { label: string; onClick: () => void }; index?: number }) {
  return (
    <header className="flex flex-col gap-1.5" style={rise(index)}>
      {back && (
        <button type="button" onClick={back.onClick} className="t-eyebrow mb-2 inline-flex items-center gap-1 self-start rounded-sm text-muted hover:text-ink">
          <ChevronLeft size={12} strokeWidth={2} aria-hidden="true" />
          {back.label}
        </button>
      )}
      {eyebrow && <span className="t-eyebrow text-muted">{eyebrow}</span>}
      <h1 className="t-display m-0 text-ink">{title}</h1>
      {intro && <p className="m-0 text-ink-2">{intro}</p>}
    </header>
  );
}

/** A search field with its icon; the label is for screen readers. */
export function SearchBox({
  label,
  placeholder,
  value,
  onChange,
  autoFocus,
  className,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <label className={cx("flex h-10 items-center gap-2.5 rounded-sm border border-border bg-well px-3 focus-within:border-verdigris", className)}>
      <Search size={15} strokeWidth={2} className="shrink-0 text-muted" aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="selectable min-w-0 flex-1 border-0 bg-transparent text-[14px] text-ink outline-none placeholder:text-muted"
      />
    </label>
  );
}

/** A one-line note with an info (or lock) icon. */
export function Footnote({ lock, className, style, children }: { lock?: boolean; className?: string; style?: CSSProperties; children: ReactNode }) {
  const Icon = lock ? Lock : Info;
  return (
    <p className={cx("m-0 flex items-center gap-2 text-[13px] leading-[18px] text-ink-2", className)} style={style}>
      <Icon size={14} strokeWidth={2} className="shrink-0 text-faint" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** "Why?" and the like: a disclosure whose text is still readable ink. */
export function Why({ summary = "Why?", children, className }: { summary?: string; children: ReactNode; className?: string }) {
  return (
    <details className={cx("text-[13px] leading-[19px]", className)}>
      <summary className="w-fit cursor-pointer rounded-sm font-semibold text-verdigris hover:text-verdigris-hover">{summary}</summary>
      <p className="m-0 mt-2 max-w-[640px] text-ink-2">{children}</p>
    </details>
  );
}

/** A muted, centred line for a list with nothing in it, with an optional action. */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md px-5 py-6 shadow-[inset_0_0_0_1px_var(--hairline)]">
      <span className="t-title text-ink">{title}</span>
      {children && <p className="m-0 max-w-[560px] text-ink-2">{children}</p>}
      {action}
    </div>
  );
}
