import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { cx } from "./cx";
import { dur, ease } from "./motion";

type Side = "top" | "bottom";

/**
 * A short label for what's under the pointer: after 400 ms of hover, or at once on
 * keyboard focus. Supplementary only: what it says must also be the control's
 * accessible name (IconButton passes its aria-label). Rendered in a portal, so a
 * scrolling sidebar can't clip it.
 */
export function Tooltip({
  content,
  shortcut,
  side = "top",
  delay = 400,
  className,
  children,
}: {
  content: ReactNode;
  /** Shown after the text in mono, as in "Search ⌘K". */
  shortcut?: string;
  side?: Side;
  delay?: number;
  /** On the wrapper, an inline-flex span around the trigger. */
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef(0);
  const id = useId();

  const show = (now: boolean) => {
    window.clearTimeout(timer.current);
    if (now) setOpen(true);
    else timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <span
      ref={anchor}
      className={cx("inline-flex", className)}
      onPointerEnter={(e) => e.pointerType === "mouse" && show(false)}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => e.target.matches(":focus-visible") && show(true)}
      onBlur={hide}
    >
      {children}
      {createPortal(
        <AnimatePresence>{open && content ? <Bubble key={id} id={id} anchor={anchor} side={side} content={content} shortcut={shortcut} /> : null}</AnimatePresence>,
        document.body,
      )}
    </span>
  );
}

function Bubble({ id, anchor, side, content, shortcut }: { id: string; anchor: RefObject<HTMLSpanElement | null>; side: Side; content: ReactNode; shortcut?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; side: Side } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.current?.getBoundingClientRect();
    const b = ref.current?.getBoundingClientRect();
    if (!a || !b) return;
    const gap = 6;
    // Flip when there's no room on the asked side.
    const s: Side = side === "top" && a.top - b.height - gap < 8 ? "bottom" : side === "bottom" && a.bottom + b.height + gap > window.innerHeight - 8 ? "top" : side;
    const top = s === "top" ? a.top - b.height - gap : a.bottom + gap;
    const left = Math.min(Math.max(8, a.left + a.width / 2 - b.width / 2), window.innerWidth - b.width - 8);
    setPos({ left, top, side: s });
  }, [anchor, side]);
  return (
    <m.div
      ref={ref}
      id={id}
      role="tooltip"
      initial={{ opacity: 0, scale: 0.96, y: side === "top" ? 2 : -2 }}
      animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: dur[1], ease } }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }}
      className="pointer-events-none fixed z-[100] flex items-center gap-2 rounded-sm bg-elevated px-2 py-1 text-[12px] leading-4 font-medium whitespace-nowrap text-ink shadow-2"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, transformOrigin: pos?.side === "bottom" ? "top center" : "bottom center" }}
    >
      {content}
      {shortcut && <span className="font-mono text-[11px] font-normal text-muted">{shortcut}</span>}
    </m.div>
  );
}
