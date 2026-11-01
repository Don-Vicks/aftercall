import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, useIsPresent } from "motion/react";
import * as m from "motion/react-m";
import { Button } from "./Button";
import { cx } from "./cx";
import { enter, exit } from "./motion";
import { focusables, useLayer } from "./overlay";

export type DialogPlacement = "center" | "anchored" | "full";

export interface DialogProps {
  /** Defaults to true. Or render it conditionally inside <AnimatePresence> to animate out. */
  open?: boolean;
  onClose: () => void;
  /** The heading (t-heading); also names the dialog. */
  title?: ReactNode;
  /** One line under the title; also describes the dialog. */
  intro?: ReactNode;
  /** Names it when there is no visible title. */
  "aria-label"?: string;
  /** "center" (a sheet over a dimmed window), "anchored" (below an element, or the window's top-right), "full" (covers the window). */
  placement?: DialogPlacement;
  /** For "anchored": the element (or its rect) to sit under. */
  anchor?: HTMLElement | DOMRect | null;
  align?: "start" | "end";
  /** Panel width for "center" (560) and "anchored" (360). */
  width?: number;
  /** "alertdialog" for confirmations. */
  role?: "dialog" | "alertdialog";
  /** What gets focus on open. Default: an autoFocus element, else the first control. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Escape and a click outside close it. Default true; false while something mustn't be interrupted. */
  dismissible?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * A modal over the window. Escape closes only the topmost overlay, Tab stays inside,
 * and focus goes back where it was on close. Rises 8px and scales from 0.98 on the
 * way in; leaves faster. Rendered in a portal.
 */
export function Dialog({ open = true, ...props }: DialogProps) {
  return createPortal(<AnimatePresence propagate>{open && <Panel key="dialog" {...props} />}</AnimatePresence>, document.body);
}

function Panel({
  onClose,
  title,
  intro,
  "aria-label": ariaLabel,
  placement = "center",
  anchor,
  align = "end",
  width,
  role = "dialog",
  initialFocus,
  dismissible = true,
  className,
  children,
}: Omit<DialogProps, "open">) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<Element | null>(null);
  const titleId = useId();
  const introId = useId();
  const present = useIsPresent();
  const isTop = useLayer(present, () => dismissible && onClose());

  // Focus in on open; back to where it was on close, unless something else took it.
  useEffect(() => {
    restoreTo.current = document.activeElement;
    const el = panel.current;
    if (!el) return;
    if (initialFocus?.current) initialFocus.current.focus();
    else if (!el.contains(document.activeElement)) (focusables(el)[0] ?? el).focus();
  }, []);
  useEffect(() => {
    if (present) return;
    const back = restoreTo.current;
    const active = document.activeElement;
    if (back instanceof HTMLElement && back.isConnected && (!active || active === document.body || panel.current?.contains(active))) back.focus({ preventScroll: true });
  }, [present]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== "Tab" || !panel.current || !isTop()) return;
    const list = focusables(panel.current);
    if (list.length === 0) return e.preventDefault();
    const first = list[0];
    const last = list[list.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || !panel.current.contains(at) || at === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || at === panel.current)) {
      e.preventDefault();
      first.focus();
    }
  };

  const anchored = placement === "anchored";
  const [spot, setSpot] = useState<{ top: number; left?: number; right?: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchored) return;
    const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
    if (!r) return setSpot({ top: 40, right: 12 });
    setSpot(align === "end" ? { top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) } : { top: r.bottom + 8, left: Math.max(8, r.left) });
  }, [anchored, anchor, align]);

  const heading = title ? (
    <div className="flex flex-col gap-1.5">
      <h2 id={titleId} className="t-heading m-0 text-ink">
        {title}
      </h2>
      {intro && (
        <p id={introId} className="m-0 text-ink-2">
          {intro}
        </p>
      )}
    </div>
  ) : null;

  const a11y = {
    role,
    "aria-modal": true,
    "aria-labelledby": title ? titleId : undefined,
    "aria-label": title ? undefined : ariaLabel,
    "aria-describedby": title && intro ? introId : undefined,
    tabIndex: -1,
    onKeyDown,
  } as const;

  if (placement === "full") {
    return (
      <m.div
        ref={panel}
        {...a11y}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: enter }}
        exit={{ opacity: 0, transition: exit }}
        className={cx("fixed inset-0 z-[70] flex flex-col bg-ground outline-none", className)}
      >
        <div data-tauri-drag-region className="h-9 shrink-0" />
        <div className="flex flex-1 items-center justify-center overflow-y-auto px-8 pb-12">
          <div className="flex w-full max-w-[560px] flex-col gap-8">
            {heading}
            {children}
          </div>
        </div>
      </m.div>
    );
  }

  return (
    <div className={cx("fixed inset-0 z-[70] flex", anchored ? "items-start justify-end" : "items-center justify-center overflow-y-auto p-6")}>
      <m.div
        aria-hidden="true"
        className={cx("absolute inset-0", anchored ? "bg-transparent" : "bg-black/40")}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.2 } }}
        exit={{ opacity: 0, transition: exit }}
        onClick={() => dismissible && onClose()}
      />
      <m.div
        ref={panel}
        {...a11y}
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: enter }}
        exit={{ opacity: 0, y: 4, scale: 0.98, transition: exit }}
        className={cx(
          "relative flex max-w-[calc(100vw-48px)] flex-col gap-5 rounded-lg bg-elevated shadow-float outline-none",
          anchored ? "fixed p-4" : "my-auto p-8",
          className,
        )}
        style={{
          width: width ?? (anchored ? 360 : 560),
          ...(anchored ? { top: spot?.top ?? 40, left: spot?.left, right: spot?.left === undefined ? (spot?.right ?? 12) : undefined, transformOrigin: align === "end" ? "top right" : "top left" } : null),
        }}
      >
        {heading}
        {children}
      </m.div>
    </div>
  );
}

export interface ConfirmOptions {
  title: ReactNode;
  /** What happens, in a line or two. */
  body?: ReactNode;
  /** A verb naming the result: "Delete project", never OK. */
  confirmLabel: string;
  cancelLabel?: string;
  /** "danger" styles the confirm button for deletes and resets, and focuses Cancel first. */
  tone?: "primary" | "danger";
}

/** A yes/no question (role="alertdialog"). Usually reached through useConfirm(). */
export function ConfirmDialog({
  open = true,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "primary",
  onConfirm,
  onCancel,
}: ConfirmOptions & { open?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onClose={onCancel} role="alertdialog" title={title} intro={body} width={440} initialFocus={tone === "danger" ? cancel : confirm}>
      <div className="flex justify-end gap-2">
        <Button ref={cancel} variant="ghost" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button ref={confirm} variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

// Confirmations asked for with confirm() wait here until <DialogHost> answers them.
interface Pending {
  id: number;
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}
let queue: Pending[] = [];
let seq = 1;
let hosts = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Asks a question in a ConfirmDialog and resolves true on confirm, false on cancel or Escape. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  // Without a DialogHost mounted (a test, a stray window), fall back to the browser's own.
  if (hosts === 0) return Promise.resolve(window.confirm(typeof options.title === "string" ? options.title : options.confirmLabel));
  return new Promise((resolve) => {
    queue = [...queue, { id: seq++, options, resolve }];
    emit();
  });
}

function settle(id: number, ok: boolean) {
  const p = queue.find((q) => q.id === id);
  if (!p) return;
  queue = queue.filter((q) => q !== p);
  emit();
  p.resolve(ok);
}

/** `const confirm = useConfirm(); if (!(await confirm({ ... }))) return;` */
export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  return confirm;
}

/** Mount once, at the app root: shows the confirmations asked for with useConfirm(). */
export function DialogHost() {
  const list = useSyncExternalStore(subscribe, () => queue);
  useEffect(() => {
    hosts++;
    return () => {
      hosts--;
    };
  }, []);
  const top = list[0];
  return (
    <AnimatePresence>
      {top && <ConfirmDialog key={top.id} {...top.options} onConfirm={() => settle(top.id, true)} onCancel={() => settle(top.id, false)} />}
    </AnimatePresence>
  );
}
