import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, useReducedMotion, type Transition } from "motion/react";
import * as m from "motion/react-m";
import { Check, Copy } from "lucide-react";
import { Button, cx, enter, exit, springs, toast } from "./ui";

/** An error as a person reads it: Tauri rejects with a string, the browser preview with an Error. */
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** For a part that opens and closes: the height springs, the content fades in alongside. */
export const grow: Transition = { height: springs.gentle, opacity: enter };

/** The boards' entrance: rise 8px and fade in over 320 ms, `i` steps of 40 ms after the first. */
export function rise(i: number, step = 40): CSSProperties {
  return { animation: `ac-in 320ms ${i * step}ms var(--ease) both` };
}

/**
 * A "Why?" disclosure: one line of copy stays on screen, the rest opens under it.
 * The height animates open and closed; with reduced motion it only fades.
 */
export function Why({
  label = "Why?",
  defaultOpen = false,
  className,
  children,
}: {
  label?: string;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const still = useReducedMotion();
  return (
    <div className={cx("flex flex-col", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        className="press w-fit rounded-sm text-[13px] leading-[19px] font-semibold text-verdigris hover:text-verdigris-hover"
      >
        {label}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <m.div
            key="why"
            id={id}
            initial={still ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto", transition: still ? enter : grow }}
            exit={still ? { opacity: 0, transition: exit } : { opacity: 0, height: 0, transition: exit }}
            className="overflow-hidden"
          >
            <div className="pt-2 text-[13px] leading-[19px] text-ink-2">{children}</div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const discTones = {
  verdigris: "bg-verdigris-tint text-verdigris",
  well: "bg-well text-ink-2",
  raised: "bg-raised text-ink shadow-[inset_0_0_0_1px_var(--hairline)]",
  elevated: "bg-elevated text-ink-2 shadow-1",
};

/** The round icon at the start of a settings row or an onboarding item. Decorative. */
export function IconDisc({ tone = "well", size = 34, children }: { tone?: keyof typeof discTones; size?: number; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={cx("inline-flex shrink-0 items-center justify-center rounded-full", discTones[tone])}
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  );
}

/** A row inside a settings card: icon, a title with one line under it, then actions. */
export function CardRow({
  icon,
  title,
  detail,
  divider,
  className,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  divider?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cx("flex flex-wrap items-center gap-3.5 px-5 py-4", divider && "border-b border-hairline", className)}>
      {icon}
      <span className="flex min-w-0 flex-[1_1_220px] flex-col gap-px">
        <span className="t-title text-ink">{title}</span>
        {detail && <span className="text-[13px] leading-[19px] text-ink-2">{detail}</span>}
      </span>
      {children}
    </div>
  );
}

/** Pops in when it appears after the page has opened (a state change), not on first paint. */
export function Pop({ show, delay = 0, children }: { show: boolean; delay?: number; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <m.span
          key="pop"
          className="inline-flex"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1, transition: { ...springs.bouncy, delay } }}
          exit={{ opacity: 0, scale: 0.9, transition: exit }}
        >
          {children}
        </m.span>
      )}
    </AnimatePresence>
  );
}

/**
 * Copies `text` and flips to "Copied" (a tick pops in) for 1.6 s. `label` names
 * what it copies for screen readers: "Copy the Claude Code command".
 */
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast({ text: "Couldn't copy. Select the text and copy it instead.", tone: "caution" });
      return;
    }
    window.clearTimeout(timer.current);
    setCopied(true);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <>
      <Button size="sm" aria-label={copied ? "Copied" : label} onClick={copy} className={cx("min-w-[86px]", className)}>
        <AnimatePresence mode="wait" initial={false}>
          {copied ? (
            <m.span
              key="copied"
              className="inline-flex items-center gap-1.5 text-verdigris"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1, transition: springs.bouncy }}
              exit={{ opacity: 0, transition: exit }}
            >
              <Check size={13} strokeWidth={2.5} aria-hidden="true" />
              Copied
            </m.span>
          ) : (
            <m.span
              key="copy"
              className="inline-flex items-center gap-1.5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: enter }}
              exit={{ opacity: 0, transition: exit }}
            >
              <Copy size={13} strokeWidth={1.75} aria-hidden="true" />
              Copy
            </m.span>
          )}
        </AnimatePresence>
      </Button>
      <span role="status" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </>
  );
}

/** A command or config block on the well, with its copy button. */
export function Snippet({ text, label }: { text: string; label: string }) {
  return (
    <div className="flex items-start gap-3 rounded-[12px] bg-well py-3.5 pr-3.5 pl-4 shadow-[inset_0_0_0_1px_var(--hairline)]">
      <code className="t-mono selectable min-w-0 flex-1 leading-5 break-all whitespace-pre-wrap text-ink">{text}</code>
      <CopyButton text={text} label={label} />
    </div>
  );
}
