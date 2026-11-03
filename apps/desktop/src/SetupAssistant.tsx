import type { CSSProperties, ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { Check, ChevronLeft, ExternalLink, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Dialog, IconButton, cx } from "./ui";
import { StepPage } from "./Flow";
import { IconDisc, rise } from "./SettingsParts";

/**
 * The frame for Set up payments, in the manner of a Mac setup assistant: one sheet
 * over the window at a fixed size, so steps swap in place instead of the page
 * jumping. The stage rail and the close button stay put; each step brings its
 * icon, serif title, one paragraph, its content, and a footer with Back on the left
 * and the one primary action on the right.
 */
export function AssistantSheet({
  label,
  phase,
  dismissible,
  busy,
  onClose,
  children,
}: {
  label: string;
  /** The stages, and where you are: -1 before the first, names.length when all are done. */
  phase: { index: number; names: readonly string[] } | null;
  /** Escape and a click outside leave. False while a phrase is on screen: only the close button does then. */
  dismissible: boolean;
  /** Something is being saved: the close button waits. */
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      aria-label={label}
      onClose={onClose}
      dismissible={dismissible}
      width={680}
      className="h-[min(720px,calc(100vh-56px))] gap-0! overflow-hidden bg-raised! p-0!"
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 pr-3 pl-6">
        {phase ? <AssistantProgress index={phase.index} names={phase.names} /> : <span className="t-eyebrow text-muted">{label}</span>}
        <IconButton aria-label="Set up later" tooltipSide="bottom" size="sm" onClick={onClose} disabled={busy}>
          <X size={15} strokeWidth={2} />
        </IconButton>
      </header>
      <AnimatePresence mode="wait" initial={false}>
        {children}
      </AnimatePresence>
    </Dialog>
  );
}

/**
 * The rail: every stage by name, always in view, so the whole job reads at a glance. A
 * stage done gets a tick, the current one a filled dot and its name in ink. `index` -1
 * is before the first (the welcome), names.length is all done.
 */
function AssistantProgress({ index, names }: { index: number; names: readonly string[] }) {
  return (
    <ol aria-label="Setup stages" className="m-0 flex min-w-0 list-none items-center gap-2 p-0">
      {names.map((n, i) => {
        const done = i < index;
        const now = i === index;
        return (
          <li key={n} className="flex min-w-0 items-center gap-2" aria-current={now ? "step" : undefined}>
            {i > 0 && <span aria-hidden="true" className={cx("h-px w-5 shrink-0 transition-colors duration-[var(--dur-2)]", done || now ? "bg-verdigris" : "bg-hairline")} />}
            <span
              aria-hidden="true"
              className={cx(
                "inline-flex size-[18px] shrink-0 items-center justify-center rounded-full transition-colors duration-[var(--dur-2)]",
                done ? "bg-verdigris text-on-verdigris" : now ? "shadow-[inset_0_0_0_1.5px_var(--verdigris)]" : "shadow-[inset_0_0_0_1.5px_var(--border)]",
              )}
            >
              {done ? <Check size={11} strokeWidth={3} /> : now ? <span className="size-2 rounded-full bg-verdigris" /> : null}
            </span>
            <span className={cx("truncate text-[13px] leading-[18px]", now ? "font-semibold text-ink" : done ? "text-ink-2" : "text-muted")}>
              {n}
              <span className="sr-only">{done ? ", done" : now ? ", now" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One step: put it straight inside AssistantSheet with a `key`. The body scrolls if
 * it must; the footer never moves. The title takes focus on arrival (StepPage).
 */
export function AssistantStep({
  icon,
  tone = "verdigris",
  title,
  intro,
  back,
  primary,
  children,
}: {
  icon: ReactNode;
  tone?: "verdigris" | "well";
  title: ReactNode;
  intro?: ReactNode;
  /** The left of the footer: usually <BackButton>, or a quiet way out. */
  back?: ReactNode;
  /** The right of the footer: the step's one primary button. */
  primary?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <StepPage className="min-h-0 flex-1 gap-0!">
      <div className="min-h-0 flex-1 overflow-y-auto px-14 pt-1 pb-8">
        <div className="mx-auto flex max-w-[520px] flex-col gap-5">
          <header className="flex flex-col items-center gap-3.5 text-center" style={rise(0)}>
            <IconDisc tone={tone} size={44}>
              {icon}
            </IconDisc>
            <div className="flex flex-col gap-2">
              <h1 tabIndex={-1} className="m-0 font-serif text-[28px] leading-[34px] font-medium tracking-[-0.02em] text-balance text-ink outline-none">
                {title}
              </h1>
              {intro && <p className="m-0 text-[14px] leading-[21px] text-pretty text-ink-2">{intro}</p>}
            </div>
          </header>
          {children}
        </div>
      </div>
      <footer className="flex h-[68px] shrink-0 items-center justify-between gap-3 border-t border-hairline px-6">
        {back ?? <span />}
        <span className="flex items-center gap-2">{primary}</span>
      </footer>
    </StepPage>
  );
}

export function BackButton({ onClick, children = "Back", disabled }: { onClick: () => void; children?: ReactNode; disabled?: boolean }) {
  return (
    <Button variant="ghost" onClick={onClick} disabled={disabled} className="-ml-2 pl-2" icon={<ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />}>
      {children}
    </Button>
  );
}

/** A quiet text action for the left of the footer ("Not now"). */
export function LaterButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="quiet" onClick={onClick} className="-ml-2 px-2">
      {children}
    </Button>
  );
}

/** An inset group on the sheet: rows with hairlines between them. */
export function Inset({ as: Tag = "div", className, style, children }: { as?: "div" | "ol" | "ul" | "dl"; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <Tag className={cx("m-0 flex list-none flex-col rounded-md bg-elevated p-0 shadow-1 [&>*+*]:border-t [&>*+*]:border-hairline", className)} style={style}>
      {children}
    </Tag>
  );
}

/** Label and value, as the wallet will show them: the value in mono when it's a name or an amount. */
export function DetailRow({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-4 px-4 py-2.5">
      <dt className="w-[112px] shrink-0 text-[13px] leading-[19px] text-muted">{label}</dt>
      <dd className={cx("m-0 min-w-0 flex-1 text-ink", mono ? "t-mono selectable break-all" : "text-[13px] leading-[19px] break-words")}>{children}</dd>
    </div>
  );
}

/** Opens a page in the browser; in the browser preview, a new tab. */
export const openLink = (url: string) => openUrl(url).catch(() => window.open(url, "_blank", "noopener"));

/** A link out of the app, drawn as a small secondary button with the external mark. */
export function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button size="sm" onClick={() => openLink(href)} className="w-fit">
      {children}
      <ExternalLink size={13} strokeWidth={2} aria-hidden="true" className="text-muted" />
    </Button>
  );
}

/** A numbered step in a guide: the number in a verdigris ring, a title, an optional link out, and a line or two. */
export function GuideRow({ n, title, action, dense, children }: { n: number; title: string; action?: ReactNode; dense?: boolean; children: ReactNode }) {
  return (
    <li className={cx("flex gap-3.5 px-4", dense ? "py-3" : "py-4")}>
      <span
        aria-hidden="true"
        className="mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[12px] font-medium text-verdigris shadow-[inset_0_0_0_1.5px_var(--verdigris)]"
      >
        {n}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cx("flex items-center justify-between gap-3", dense ? "min-h-7" : "min-h-8")}>
          <span className="text-[15px] leading-6 font-semibold text-ink">{title}</span>
          {action}
        </span>
        <span className="text-[13px] leading-[19px] text-ink-2">{children}</span>
      </span>
    </li>
  );
}
