import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Dialog } from "./Dialog";
import { anyLayerOpen } from "./overlay";

/*
 * Keyboard-first lists, as in Things or Linear: j/k (or ↓/↑) move a focus row down the
 * list, and single keys act on it. Keys never fire while you type in a field, while a
 * dialog, menu or sheet is open, or with ⌘, ⌃ or ⌥ held. One list on the page takes keys
 * at a time: the newest one mounted with something in it.
 */

export interface RovingActions<K extends string> {
  /** x: tick or untick. */
  onTick?: (key: K) => void;
  /** e: edit in place. */
  onEdit?: (key: K) => void;
  /** ↵: open, or jump to the quote. */
  onOpen?: (key: K) => void;
  /** a: approve. Must go through the deferred approve with Undo; never pays at once. */
  onApprove?: (key: K) => void;
  /** ⌫: dismiss, with Undo. */
  onDismiss?: (key: K) => void;
}

export interface RovingShortcut {
  keys: string[];
  label: string;
}

/** What `?` lists for a list with these actions. */
export function shortcutsFor(actions: RovingActions<string>, words: Partial<Record<keyof RovingActions<string>, string>> = {}): RovingShortcut[] {
  return [
    { keys: ["j", "k"], label: "Move down and up (or ↓ ↑)" },
    actions.onTick && { keys: ["x"], label: words.onTick ?? "Tick or untick" },
    actions.onEdit && { keys: ["e"], label: words.onEdit ?? "Edit" },
    actions.onOpen && { keys: ["↵"], label: words.onOpen ?? "Open" },
    actions.onApprove && { keys: ["a"], label: words.onApprove ?? "Approve, with 5 s to undo" },
    actions.onDismiss && { keys: ["⌫"], label: words.onDismiss ?? "Dismiss, with undo" },
    { keys: ["esc"], label: "Stop moving through the list" },
    { keys: ["?"], label: "Show these shortcuts" },
  ].filter((s): s is RovingShortcut => Boolean(s));
}

/** Lists on the page, newest last; only the newest with rows takes keys. */
const lists: { id: string; has: () => boolean }[] = [];

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}

/** A control inside a row that ↵ and space already press. */
const isControl = (t: EventTarget | null) => t instanceof HTMLElement && Boolean(t.closest("button, a[href], [role=checkbox], [role=button]")) && !t.hasAttribute("data-roving-row");

/**
 * Moves a visible focus row through `keys` (in the order they're on screen) and runs
 * `actions` on it. Spread `row(key)` on each row's outer element and style
 * `data-[active=true]:` on it; real focus moves with the row (tabIndex -1), so screen
 * readers follow and a row's own focus styles (its quote) open. Pass `enabled: false`
 * while a row is being edited. `sheet` is the `?` sheet: render it once.
 */
export function useRovingList<K extends string>(keys: readonly K[], actions: RovingActions<K>, opts: { enabled?: boolean; title?: string; words?: Partial<Record<keyof RovingActions<K>, string>> } = {}) {
  const id = useId();
  const [active, setActive] = useState<K | null>(null);
  const [help, setHelp] = useState(false);
  /** The focus row shows once you use the keys, and hides again when you use the mouse. */
  const [shown, setShown] = useState(false);
  const enabled = opts.enabled ?? true;

  // The latest of everything, for one window listener.
  const live = useRef({ keys, actions, active, enabled });
  live.current = { keys, actions, active, enabled };
  /** Where the focus row was, so it stays at that place when its item leaves the list. */
  const lastIndex = useRef(0);

  const rowEl = (key: K) => document.querySelector<HTMLElement>(`[data-roving="${CSS.escape(id)}"][data-roving-key="${CSS.escape(key)}"]`);
  const focusRow = (key: K) => {
    const el = rowEl(key);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
  };

  // An item that left (ticked away, dismissed): the row below it takes the focus.
  useEffect(() => {
    if (active === null) return;
    const at = keys.indexOf(active);
    if (at >= 0) {
      lastIndex.current = at;
      return;
    }
    const next = keys[Math.min(lastIndex.current, keys.length - 1)] ?? null;
    setActive(next);
    if (next !== null && document.activeElement === document.body) requestAnimationFrame(() => focusRow(next));
  }, [keys, active]);

  useEffect(() => {
    const entry = { id, has: () => live.current.enabled && live.current.keys.length > 0 };
    lists.push(entry);
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || anyLayerOpen()) return;
      const mine = [...lists].reverse().find((l) => l.has());
      if (mine !== entry) return;
      const { keys, actions, active } = live.current;
      const at = active === null ? -1 : keys.indexOf(active);
      const move = (to: number) => {
        const key = keys[Math.max(0, Math.min(keys.length - 1, to))];
        setActive(key);
        focusRow(key);
      };
      const run = (fn: ((key: K) => void) | undefined) => {
        if (!fn || active === null || at < 0 || e.repeat) return false;
        fn(active);
        return true;
      };
      let handled = true;
      switch (e.key) {
        case "j":
        case "ArrowDown":
          move(at < 0 ? 0 : at + 1);
          break;
        case "k":
        case "ArrowUp":
          move(at < 0 ? 0 : at - 1);
          break;
        case "x":
          handled = run(actions.onTick);
          break;
        case "e":
          handled = run(actions.onEdit);
          break;
        case "Enter":
          handled = !isControl(e.target) && run(actions.onOpen);
          break;
        case "a":
          handled = run(actions.onApprove);
          break;
        case "Backspace":
        case "Delete":
          handled = run(actions.onDismiss);
          break;
        case "Escape":
          handled = active !== null;
          if (handled) {
            setActive(null);
            (document.activeElement as HTMLElement | null)?.blur?.();
          }
          break;
        case "?":
          setHelp(true);
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        setShown(e.key !== "Escape");
      }
    };
    const onPointer = () => setShown(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
      const i = lists.indexOf(entry);
      if (i >= 0) lists.splice(i, 1);
    };
  }, [id]);

  /** Props for a row's outer element. A click in the row makes it the focus row too. */
  const row = (key: K) => ({
    "data-roving": id,
    "data-roving-key": key,
    "data-roving-row": "",
    "data-active": shown && active === key ? "true" : undefined,
    tabIndex: -1,
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button === 0) setActive(key);
    },
    // Tabbing into a row's controls (or clicking one) makes it the focus row as well.
    onFocus: () => setActive(key),
  });

  const list = shortcutsFor(actions as RovingActions<string>, opts.words as Partial<Record<keyof RovingActions<string>, string>>);
  const sheet = <ShortcutsSheet open={help} onClose={() => setHelp(false)} title={opts.title ?? "Keyboard shortcuts"} shortcuts={list} />;

  return { active: shown ? active : null, row, sheet, openHelp: () => setHelp(true) };
}

const Key = ({ children }: { children: string }) => (
  <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-[6px] bg-well px-1.5 font-mono text-[12px] leading-none text-ink shadow-[inset_0_0_0_1px_var(--hairline)]">{children}</kbd>
);

/** The `?` sheet: the keys this list answers to. */
export function ShortcutsSheet({ open, onClose, title, shortcuts }: { open: boolean; onClose: () => void; title: string; shortcuts: RovingShortcut[] }) {
  return (
    <Dialog open={open} onClose={onClose} title={title} intro="Not while you're typing in a field." width={400}>
      <dl className="m-0 flex flex-col">
        {shortcuts.map((s) => (
          <div key={s.label} className="flex items-center justify-between gap-4 border-b border-hairline py-2.5 last:border-b-0">
            <dt className="text-ink-2">{s.label}</dt>
            <dd className="m-0 flex shrink-0 gap-1">
              {s.keys.map((k) => (
                <Key key={k}>{k}</Key>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

/** The quiet "?" hint by a list's title that opens its shortcuts. */
export function ShortcutsHint({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-keyshortcuts="?"
      className="press inline-flex h-7 items-center gap-1.5 rounded-sm px-1.5 text-[12px] font-medium text-muted hover:text-ink"
    >
      Shortcuts
      <kbd className="inline-flex size-[18px] items-center justify-center rounded-[5px] bg-well font-mono text-[11px] leading-none text-ink-2 shadow-[inset_0_0_0_1px_var(--hairline)]">?</kbd>
    </button>
  );
}

/** The focus row on a flat list: a soft ink tint behind it and a verdigris edge, no outline. */
export const rovingRowClass =
  "relative isolate outline-none focus-visible:outline-none before:pointer-events-none before:absolute before:inset-y-0.5 before:-inset-x-3 before:-z-10 before:rounded-sm before:opacity-0 before:transition-opacity before:duration-(--dur-1) data-[active=true]:before:opacity-100 data-[active=true]:before:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] data-[active=true]:before:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--verdigris)_45%,transparent)]";

/** The focus row on a list of cards: a verdigris ring round the card. */
export const rovingCardClass =
  "rounded-md outline-none focus-visible:outline-none transition-shadow duration-(--dur-1) data-[active=true]:shadow-[0_0_0_2px_color-mix(in_srgb,var(--verdigris)_70%,transparent)]";
