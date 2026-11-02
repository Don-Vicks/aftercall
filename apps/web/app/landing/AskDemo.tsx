"use client";

import { useEffect, useState } from "react";
import l from "../landing.module.css";
import { Face, Glyph } from "./atoms";
import { TIMING, usePlay } from "./motion";

/*
 * Ask your meetings (⌘J), as the app's Ask screen draws it on the sample: the question
 * types in, the search runs on this Mac, and the two excerpts that would be sent appear
 * with their quotes. No model answer is drawn: none comes from the browser preview.
 */

const QUESTION = "Which payments are waiting for me?";

export function AskDemo() {
  const { state, run } = usePlay();
  const [typed, setTyped] = useState(QUESTION.length);

  useEffect(() => {
    if (state === "armed") setTyped(0);
    if (state !== "play") return;
    setTyped(0);
    let n = 0;
    let id: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      id = setInterval(() => {
        n += 1;
        setTyped(n);
        if (n >= QUESTION.length && id) clearInterval(id);
      }, TIMING.ask.typeEvery);
    }, TIMING.ask.startAfter);
    return () => {
      clearTimeout(start);
      if (id) clearInterval(id);
    };
  }, [state, run]);

  const typing = state === "play" && typed < QUESTION.length;
  return (
    <div className={l.ask}>
      <p className={l.askEyebrow}>1 meeting · searched on this Mac</p>
      <p className={l.askTitle}>Ask your meetings</p>
      <div className={l.askInput}>
        <Glyph name="search" size={15} />
        <p>
          <span className="sr-only">{QUESTION}</span>
          <span aria-hidden="true">
            {QUESTION.slice(0, typed)}
            {typing ? <span className={l.caret} /> : null}
          </span>
        </p>
        <kbd>⌘J</kbd>
      </div>
      <p className={l.askStep}>
        <Glyph name="check" size={13} />
        Searched on this Mac · 2 excerpts would be sent
      </p>
      <ul className={l.askCards}>
        <li className={l.askCard} style={{ ["--c" as string]: 0 }}>
          <p className={l.askMeta}>
            <Face who="You" size={20} />
            <b>You</b>
            <span>Sync with Ada · Today 14:02</span>
            <span className={l.at}>02:14</span>
            <span className={l.mono}>50.00 USDC</span>
            <span className={l.tagMuted}>To approve</span>
            <span className={l.askOpen}>Open in transcript →</span>
          </p>
          <p className={l.askQuote}>“Send Ada the recap after this call, and pay the designer the fifty dollar deposit today.”</p>
        </li>
        <li className={l.askCard} style={{ ["--c" as string]: 1 }}>
          <p className={l.askMeta}>
            <Face who="You" size={20} />
            <b>You</b>
            <span>Sync with Ada · Today 14:02</span>
            <span className={l.at}>02:30</span>
            <span className={l.mono}>5,000.00 USDC</span>
            <span className={l.tagCaution}>Blocked</span>
            <span className={l.askOpen}>Open in transcript →</span>
          </p>
          <p className={l.askQuote}>“And the full five thousand when the deck is done.”</p>
        </li>
      </ul>
      <p className={l.askFoot}>
        <Glyph name="lock" size={12} />
        Only the excerpts needed leave this Mac
      </p>
    </div>
  );
}
