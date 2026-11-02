import { useCallback, useSyncExternalStore } from "react";
import type { Meeting } from "@aftercall/core";

/**
 * Which items of a meeting are new since its notes were made and not yet seen, so the
 * meeting page can mark them (a verdigris rule) until you've looked. Ids only, never any
 * text, in this browser profile's localStorage; when that isn't available, in memory for
 * this window. Forgotten a week after the notes were made.
 */

const KEY = "aftercall.fresh";
const KEEP_MS = 7 * 24 * 3600 * 1000;

type Store = Record<string, { at: number; keys: string[] }>;

/** The key of one item: decisions by their place, action items and follow-ups by id. */
export const freshKey = {
  decision: (i: number) => `d:${i}`,
  action: (id: string) => `a:${id}`,
  followUp: (id: string) => `f:${id}`,
};

let store: Store = load();
const listeners = new Set<() => void>();

function load(): Store {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store;
    const now = Date.now();
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => v && Array.isArray(v.keys) && now - v.at < KEEP_MS));
  } catch {
    return {};
  }
}

function save(next: Store) {
  store = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private window or storage off: it still works for this window.
  }
  listeners.forEach((l) => l());
}

/** A meeting's notes were just made: everything in them is new. */
export function markFresh(m: Pick<Meeting, "id" | "decisions" | "actionItems" | "followUps">) {
  const keys = [...m.decisions.map((_, i) => freshKey.decision(i)), ...m.actionItems.map((a) => freshKey.action(a.id)), ...m.followUps.map((f) => freshKey.followUp(f.id))];
  if (keys.length === 0) return;
  save({ ...store, [m.id]: { at: Date.now(), keys } });
}

/** You've seen the meeting's notes: nothing in it is marked new any more. */
export function markSeen(meetingId: string) {
  if (!store[meetingId]) return;
  const { [meetingId]: _, ...rest } = store;
  save(rest);
}

export function isFresh(meetingId: string, key: string): boolean {
  return store[meetingId]?.keys.includes(key) ?? false;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/**
 * For the meeting page: `isNew(freshKey.action(id))` per row, and `seen()` once the
 * notes have been on screen long enough to read (the marks fade as they go).
 */
export function useFresh(meetingId: string) {
  const entry = useSyncExternalStore(subscribe, () => store[meetingId]);
  const isNew = useCallback((key: string) => entry?.keys.includes(key) ?? false, [entry]);
  const seen = useCallback(() => markSeen(meetingId), [meetingId]);
  return { any: Boolean(entry), isNew, seen };
}
