"use client";

import { useEffect, useState } from "react";
import l from "../landing.module.css";
import { TIMING, usePlay } from "./motion";

/*
 * Moment 2, the tick, on the sample's action items. The circle fills, the check draws,
 * then a line strikes the text through from left to right and it goes quiet. The first
 * row ticks itself 600 ms after the panel opens; anyone can tick or untick it.
 */

export function TickCard() {
  const { state, run } = usePlay();
  const [done, setDone] = useState(true);

  useEffect(() => {
    if (state === "armed") setDone(false);
    if (state !== "play") return;
    setDone(false);
    const t = setTimeout(() => setDone(true), TIMING.tick.after);
    return () => clearTimeout(t);
  }, [state, run]);

  return (
    <div className={l.tickCard}>
      <p className={l.tickHead}>
        Action items <span>{done ? "1 open" : "2 open"}</span>
      </p>
      <ul>
        <li className={l.tickRow} data-done={done ? "" : undefined}>
          <button type="button" className={`${l.tickBtn} press`} aria-pressed={done} onClick={() => setDone((d) => !d)} aria-label={`Send Ada the recap: ${done ? "done" : "not done"}`}>
            <svg width="20" height="20" viewBox="0 0 22 22" aria-hidden="true">
              <circle cx="11" cy="11" r="9.25" className={l.tickRing} />
              <circle cx="11" cy="11" r="10" className={l.tickFill} />
              <path d="M6.5 11.5l3 3 6-6.5" pathLength={1} className={l.tickMark} />
            </svg>
          </button>
          <span className={l.tickText}>
            <span className={l.tickTitle}>
              Send Ada the recap
              <i className={l.strike} aria-hidden="true" />
            </span>
            <span className={l.tickMeta}>You · today</span>
          </span>
        </li>
        <li className={l.tickRow}>
          <span className={l.claimed} aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 22 22">
              <circle cx="11" cy="11" r="9.25" fill="none" strokeWidth="1.5" stroke="var(--border)" />
              <path d="M11 1.75a9.25 9.25 0 0 1 0 18.5" fill="none" strokeWidth="2" stroke="var(--verdigris)" strokeLinecap="round" />
            </svg>
          </span>
          <span className={l.tickText}>
            <span className={l.tickTitle}>Ship the API fix</span>
            <span className={l.tickMeta}>
              <span className={l.accent}>Claude Code is on it</span> · since 14:20
            </span>
          </span>
        </li>
        <li className={l.tickRow} data-done="" data-static="">
          <span className={l.tickBtnStatic} aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 22 22">
              <circle cx="11" cy="11" r="10" className={l.tickFill} />
              <path d="M6.5 11.5l3 3 6-6.5" pathLength={1} className={l.tickMark} />
            </svg>
          </span>
          <span className={l.tickText}>
            <span className={l.tickTitle}>
              Get deck feedback from Ada
              <i className={l.strike} aria-hidden="true" />
            </span>
            <span className={l.tickMeta}>Closed here · opened in Deck review, 3 Nov</span>
          </span>
          <span className="sr-only">Done.</span>
        </li>
      </ul>
    </div>
  );
}
