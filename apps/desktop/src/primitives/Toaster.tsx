import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { AlertTriangle, Check, CircleAlert } from "lucide-react";
import { ease, exit } from "./motion";
import { LayoutMotion } from "./MotionProvider";

export type ToastTone = "neutral" | "verdigris" | "caution" | "record";

export interface ToastOptions {
  /** Replaces a toast with the same id instead of adding another. */
  id?: string;
  /** What happened, with the number. A function gets the seconds left (deferred toasts). */
  text: ReactNode | ((secondsLeft: number) => ReactNode);
  /** One extra action, as "Open". Clicking it also dismisses the toast. */
  action?: { label: string; onClick: () => void };
  /** Shows "Undo ⌘Z". Clicking it (or ⌘Z) calls this and dismisses the toast. */
  undo?: () => void;
  /** "record" for errors (read out at once), "verdigris" for done, "caution" for a decision. */
  tone?: ToastTone;
  /** How long it stays, in ms. Default 4 s; 6 s with an action or undo; 8 s for errors. */
  duration?: number;
  /** For screen readers when `text` isn't a plain string. */
  announce?: string;
}

interface Item extends ToastOptions {
  id: string;
  /** When a deferred action runs (ms since epoch); drives "in 4…". */
  endsAt?: number;
  /** When the deferred action was queued, for a countdown bar. */
  startedAt?: number;
  /** A deferred action whose row shows its own countdown: no pill, but ⌘Z and the announcement still work. */
  quiet?: boolean;
}

// The toasts on screen, oldest first, outside React so toast() works from anywhere.
let items: Item[] = [];
let seq = 1;
const timers = new Map<string, { handle: number; endsAt: number; left: number }>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const defaultDuration = (o: ToastOptions) => o.duration ?? (o.tone === "record" ? 8000 : o.undo || o.action ? 6000 : 4000);

function arm(id: string, ms: number) {
  window.clearTimeout(timers.get(id)?.handle);
  timers.set(id, { handle: window.setTimeout(() => dismissToast(id), ms), endsAt: Date.now() + ms, left: ms });
}

/** Shows a toast at the bottom of the window. Returns its id. */
export function toast(options: ToastOptions): string {
  const id = options.id ?? `toast-${seq++}`;
  const item: Item = { ...options, id };
  items = items.some((t) => t.id === id) ? items.map((t) => (t.id === id ? item : t)) : [...items, item];
  if (!pending.has(id)) arm(id, defaultDuration(options));
  emit();
  return id;
}

export function dismissToast(id: string) {
  window.clearTimeout(timers.get(id)?.handle);
  timers.delete(id);
  if (!items.some((t) => t.id === id)) return;
  items = items.filter((t) => t.id !== id);
  emit();
}

/** Holds a toast while the pointer or focus is on it, so its Undo can be reached. */
function hold(id: string, held: boolean) {
  const t = timers.get(id);
  if (!t || pending.has(id)) return;
  if (held) {
    window.clearTimeout(t.handle);
    t.left = Math.max(1000, t.endsAt - Date.now());
  } else arm(id, t.left);
}

// Deferred actions waiting for their grace period, by id. A module-level queue, so
// a second call with the same id (React StrictMode running an effect twice, a
// double click) joins the first instead of queueing the action again.
interface Deferred {
  run: () => void | Promise<void>;
  undo?: () => void;
  timer: number;
}
const pending = new Map<string, Deferred>();

export interface DeferredHandle {
  id: string;
  /** Takes it back: the action never runs (as Undo). */
  cancel: () => void;
  /** Runs it now instead of waiting. */
  flush: () => void;
}

const handleFor = (id: string): DeferredHandle => ({ id, cancel: () => settle(id, false), flush: () => settle(id, true) });

function settle(id: string, run: boolean) {
  const d = pending.get(id);
  if (!d) return;
  pending.delete(id);
  window.clearTimeout(d.timer);
  dismissToast(id);
  if (!run) return d.undo?.();
  Promise.resolve()
    .then(d.run)
    .catch((e) => toast({ text: `That didn't work: ${e instanceof Error ? e.message : String(e)}`, tone: "record" }));
}

/**
 * Does something after a grace period, with Undo: "Paying in 5… Undo". `run` happens
 * once, after `ms`, unless Undo (or ⌘Z) comes first, which calls `undo`. Nothing runs
 * if the app quits before then. A failed `run` shows an error toast.
 */
export function deferred({
  id,
  text,
  ms,
  run,
  undo,
  tone,
  quiet,
}: {
  id?: string;
  text: ToastOptions["text"];
  ms: number;
  run: () => void | Promise<void>;
  undo?: () => void;
  tone?: ToastTone;
  /** No toast: the row on screen shows the countdown itself (read it with `useDeferred`). ⌘Z still takes it back. */
  quiet?: boolean;
}): DeferredHandle {
  const key = id ?? `deferred-${seq++}`;
  if (pending.has(key)) return handleFor(key);
  pending.set(key, { run, undo, timer: window.setTimeout(() => settle(key, true), ms) });
  const now = Date.now();
  items = [...items.filter((t) => t.id !== key), { id: key, text, tone, quiet, startedAt: now, endsAt: now + ms, undo: () => settle(key, false) }];
  emit();
  return handleFor(key);
}

/** Whether the deferred action with this id is still waiting: a 5 s window a phone's tap mustn't race. */
export const isDeferred = (id: string) => pending.has(id);

/** A deferred action that is still waiting, for a row that shows its own countdown. */
export interface PendingDeferred extends DeferredHandle {
  startedAt: number;
  endsAt: number;
}

/** The deferred action with this id while it waits; null once it ran or was undone. */
export function useDeferred(id: string): PendingDeferred | null {
  const list = useSyncExternalStore(subscribe, () => items);
  const item = list.find((t) => t.id === id);
  if (!item?.endsAt || !pending.has(id)) return null;
  return { ...handleFor(id), startedAt: item.startedAt ?? item.endsAt, endsAt: item.endsAt };
}

/** The toast stack: bottom-centre pills, newest at the bottom. Mount once, at the app root. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items);
  const shown = list.filter((t) => !t.quiet).slice(-3);
  const latest = list[list.length - 1];

  // ⌘Z takes back the newest undoable toast, unless the key is for a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.key.toLowerCase() !== "z") return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const last = [...items].reverse().find((x) => x.undo);
      if (!last) return;
      e.preventDefault();
      last.undo!();
      dismissToast(last.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return createPortal(
    <>
      <Announcer item={latest} />
      {/* --toast-lift: room for something else at the bottom, as the live pill while recording. */}
      <section
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-0 z-[90] flex flex-col items-center gap-2 px-6"
        style={{ bottom: "calc(24px + var(--toast-lift, 0px))" }}
      >
        <LayoutMotion>
          <AnimatePresence initial={false}>
            {shown.map((t) => (
              <Toast key={t.id} item={t} />
            ))}
          </AnimatePresence>
        </LayoutMotion>
      </section>
    </>,
    document.body,
  );
}

const icons: Partial<Record<ToastTone, ReactNode>> = {
  verdigris: <Check size={15} strokeWidth={2.25} className="shrink-0 text-verdigris" aria-hidden="true" />,
  caution: <AlertTriangle size={15} strokeWidth={2} className="shrink-0 text-caution" aria-hidden="true" />,
  record: <CircleAlert size={15} strokeWidth={2} className="shrink-0 text-record" aria-hidden="true" />,
};

function useSecondsLeft(endsAt?: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!endsAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [endsAt]);
  return endsAt ? Math.max(1, Math.ceil((endsAt - now) / 1000)) : 0;
}

function Toast({ item }: { item: Item }) {
  const seconds = useSecondsLeft(item.endsAt);
  const text = typeof item.text === "function" ? item.text(seconds) : item.text;
  const buttons = item.undo || item.action;
  return (
    <m.div
      layout="position"
      data-toast
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.24, ease } }}
      exit={{ opacity: 0, scale: 0.96, transition: exit }}
      onPointerEnter={() => hold(item.id, true)}
      onPointerLeave={() => hold(item.id, false)}
      onFocus={() => hold(item.id, true)}
      onBlur={() => hold(item.id, false)}
      className={`pointer-events-auto flex max-w-[min(560px,100%)] items-center gap-3.5 rounded-full bg-elevated py-2.5 pl-4 text-ink shadow-pill ${buttons ? "pr-2.5" : "pr-4"}`}
    >
      {item.tone && icons[item.tone]}
      <span className="min-w-0">{text}</span>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            item.action!.onClick();
            dismissToast(item.id);
          }}
          className="press h-[30px] shrink-0 rounded-full bg-well px-3 font-semibold text-ink"
        >
          {item.action.label}
        </button>
      )}
      {item.undo && (
        <button
          type="button"
          onClick={() => {
            item.undo!();
            dismissToast(item.id);
          }}
          className="press inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-full bg-well px-3 font-semibold text-ink"
        >
          Undo <span className="font-mono text-[12px] font-normal text-muted">⌘Z</span>
        </button>
      )}
    </m.div>
  );
}

/**
 * Screen readers hear each new toast once, from live regions that are always in
 * the page (a live region added along with its text is often missed). Errors
 * interrupt; everything else waits its turn.
 */
function Announcer({ item }: { item?: Item }) {
  const [said, setSaid] = useState<{ id: string; text: string; urgent: boolean } | null>(null);
  useEffect(() => {
    if (!item || item.id === said?.id) return;
    const text = item.announce ?? (typeof item.text === "string" ? item.text : typeof item.text === "function" ? String(item.text(Math.ceil(((item.endsAt ?? Date.now()) - Date.now()) / 1000))) : "");
    setSaid({ id: item.id, text: item.undo ? `${text}. Undo with Command Z.` : text, urgent: item.tone === "record" });
  }, [item, said?.id]);
  return (
    <>
      <div aria-live="polite" className="sr-only">
        {said && !said.urgent ? said.text : ""}
      </div>
      <div aria-live="assertive" className="sr-only">
        {said?.urgent ? said.text : ""}
      </div>
    </>
  );
}
