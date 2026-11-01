import type { Transition } from "motion/react";

/** The design system's curve: a calm ease-out (`--ease` in styles.css). */
export const ease: [number, number, number, number] = [0.2, 0.8, 0.2, 1];

/** Durations in seconds, matching `--dur-1`..`--dur-3`: small state changes, exits, entries. */
export const dur = { 1: 0.12, 2: 0.2, 3: 0.32 } as const;

/** Entry 240 ms, exit 160 ms. Exits are always faster than entries. */
export const enter: Transition = { duration: 0.24, ease };
export const exit: Transition = { duration: 0.16, ease };

/** Springs for things you touch. */
export const springs = {
  /** Toggles, tabs, menus: quick and settled. */
  snappy: { type: "spring", stiffness: 500, damping: 35 },
  /** Sheets and rows that change height. */
  gentle: { type: "spring", stiffness: 260, damping: 30 },
  /** The expressive moments only: the tick, Paid sliding into place. */
  bouncy: { type: "spring", stiffness: 400, damping: 18 },
} as const satisfies Record<string, Transition>;

/** A view switch: 80 ms fade out, then 160 ms fade in with a 4px rise. */
export const view = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.16, ease } },
  exit: { opacity: 0, transition: { duration: 0.08, ease } },
} as const;
