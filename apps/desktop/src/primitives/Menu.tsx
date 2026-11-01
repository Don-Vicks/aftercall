import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { cx } from "./cx";
import { dur, ease } from "./motion";
import { useLayer } from "./overlay";

export interface MenuItem {
  label: ReactNode;
  onSelect: () => void;
  /** "danger" for deletes: record text. */
  tone?: "default" | "danger";
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
}

/** Spread onto the element that opens the menu (usually an IconButton or Button). */
export interface MenuTriggerProps {
  ref: (el: HTMLElement | null) => void;
  onClick: () => void;
  onKeyDown: (e: ReactKeyboardEvent) => void;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls"?: string;
}

/**
 * A menu of actions. Arrow keys move between items (roving focus), Home and End
 * jump, typing a letter finds an item, Escape closes it and returns focus to the
 * trigger, and a click anywhere else closes it. Scales in from the trigger's corner.
 */
export function Menu({
  label,
  trigger,
  items,
  align = "start",
  width = 200,
}: {
  /** The menu's accessible name, as "Project options". */
  label: string;
  trigger: (props: MenuTriggerProps) => ReactNode;
  /** null draws a divider. */
  items: (MenuItem | null)[];
  /** Which edge of the trigger the menu lines up with. */
  align?: "start" | "end";
  width?: number;
}) {
  const [open, setOpen] = useState<false | "first" | "last">(false);
  const triggerEl = useRef<HTMLElement | null>(null);
  const id = useId();

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerEl.current?.focus();
  };

  return (
    <>
      {trigger({
        ref: (el) => {
          triggerEl.current = el;
        },
        onClick: () => setOpen((o) => (o ? false : "first")),
        onKeyDown: (e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(e.key === "ArrowDown" ? "first" : "last");
          }
        },
        "aria-haspopup": "menu",
        "aria-expanded": Boolean(open),
        "aria-controls": open ? id : undefined,
      })}
      {createPortal(
        <AnimatePresence>
          {open && <Panel key="menu" id={id} label={label} items={items} start={open} align={align} width={width} anchor={triggerEl.current} onClose={close} />}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function Panel({
  id,
  label,
  items,
  start,
  align,
  width,
  anchor,
  onClose,
}: {
  id: string;
  label: string;
  items: (MenuItem | null)[];
  start: "first" | "last";
  align: "start" | "end";
  width: number;
  anchor: HTMLElement | null;
  onClose: (returnFocus: boolean) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  useLayer(true, () => onClose(true));

  const enabled = items.flatMap((it, i) => (it && !it.disabled ? [i] : []));
  const [active, setActive] = useState(() => (start === "first" ? enabled[0] : enabled[enabled.length - 1]) ?? -1);

  useLayoutEffect(() => {
    const a = anchor?.getBoundingClientRect();
    const h = panel.current?.offsetHeight ?? 0;
    if (!a) return;
    const up = a.bottom + 6 + h > window.innerHeight - 8 && a.top - 6 - h > 8;
    const left = Math.min(Math.max(8, align === "end" ? a.right - width : a.left), window.innerWidth - width - 8);
    setPos({ left, top: up ? a.top - 6 - h : a.bottom + 6, up });
  }, [anchor, align, width]);

  useEffect(() => {
    if (active >= 0) buttons.current[active]?.focus();
  }, [active]);

  // A click anywhere else closes it, leaving focus where the click put it; so does
  // scrolling or resizing, which would leave it floating away from its trigger.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor?.contains(t)) return;
      onClose(false);
    };
    const onMove = (e: Event) => !panel.current?.contains(e.target as Node) && onClose(false);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [anchor, onClose]);

  const move = (to: number) => enabled.length && setActive(enabled[(to + enabled.length) % enabled.length]);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const at = enabled.indexOf(active);
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(enabled.length - 1);
    else if (e.key === "Tab") onClose(true);
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Type-ahead: the next item starting with that letter.
      const ch = e.key.toLowerCase();
      const order = [...enabled.slice(at + 1), ...enabled.slice(0, at + 1)];
      const hit = order.find((i) => buttons.current[i]?.textContent?.trim().toLowerCase().startsWith(ch));
      if (hit === undefined) return;
      setActive(hit);
    } else return;
    e.preventDefault();
  };

  return (
    <m.div
      ref={panel}
      id={id}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1, transition: { duration: 0.16, ease } }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: dur[1], ease } }}
      className="fixed z-[80] flex flex-col gap-0.5 rounded-[12px] bg-elevated p-1.5 shadow-2"
      style={{
        width,
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        transformOrigin: `${pos?.up ? "bottom" : "top"} ${align === "end" ? "right" : "left"}`,
      }}
    >
      {items.map((it, i) =>
        it ? (
          <button
            key={i}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="menuitem"
            tabIndex={i === active ? 0 : -1}
            disabled={it.disabled}
            onPointerMove={() => !it.disabled && i !== active && setActive(i)}
            onClick={() => {
              onClose(true);
              it.onSelect();
            }}
            className={cx(
              "flex items-center gap-2.5 rounded-sm px-2.5 py-[7px] text-left outline-none focus:bg-well disabled:cursor-not-allowed disabled:opacity-40",
              it.tone === "danger" ? "text-record" : "text-ink",
            )}
          >
            {it.icon && <span className="inline-flex shrink-0 text-faint">{it.icon}</span>}
            <span className="flex-1">{it.label}</span>
            {it.shortcut && <span className="font-mono text-[11px] text-muted">{it.shortcut}</span>}
          </button>
        ) : (
          <div key={i} role="separator" className="mx-1 my-1 h-px bg-hairline" />
        ),
      )}
    </m.div>
  );
}
