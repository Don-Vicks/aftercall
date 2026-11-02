"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import l from "../landing.module.css";
import { Face, Said } from "./atoms";
import { ReplayButton, Rolling, TIMING, usePlay } from "./motion";

/*
 * Moment 3, approve: the sample's payment card (FollowUps.tsx). When it plays, the words
 * "fifty dollar" are highlighted in the quote, the Heard row reads them as 50.00 USDC, then
 * Approve payment is pressed and "Paying in 5… you can still take it back." runs with Undo
 * and a bar that empties over the app's real grace period (GRACE_MS, 5 s); at 0 the amount
 * slides into the Paid pill. The server renders it paid. Anyone can Undo, Approve or Replay.
 * The card's height never changes.
 */

type Mode = "idle" | "count" | "paid";

export function ApproveDemo({ startAfter = TIMING.approve.autoStart, className }: { startAfter?: number; className?: string }) {
  const { state, run } = usePlay();
  const [mode, setMode] = useState<Mode>("paid");
  const [left, setLeft] = useState(5);
  const [startedAt, setStartedAt] = useState(0);
  const [said, setSaid] = useState("");
  const [pass, setPass] = useState(0); // remounts the quote and Heard row so Replay replays them
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  };

  const approve = useCallback(() => {
    clear();
    setMode("count");
    setLeft(5);
    setStartedAt(Date.now());
    setSaid("Paying Designer 50.00 USDC in 5 seconds. Undo to take it back.");
    for (let s = 1; s <= 5; s++)
      timers.current.push(
        setTimeout(() => {
          if (s < 5) setLeft(5 - s);
          else {
            setMode("paid");
            setSaid("Paid Designer 50.00 USDC from your agent wallet.");
          }
        }, s * (TIMING.approve.grace / 5)),
      );
  }, []);

  const undo = () => {
    clear();
    setMode("idle");
    setSaid("Payment taken back. Nothing was paid.");
  };

  const replay = () => {
    clear();
    setMode("idle");
    setSaid("");
    setPass((p) => p + 1);
    timers.current.push(setTimeout(approve, startAfter));
  };

  // Armed: back to the card as proposed. Playing: press Approve after a beat.
  useEffect(() => {
    if (state === "armed") {
      clear();
      setMode("idle");
      setLeft(5);
    } else if (state === "play") {
      clear();
      setMode("idle");
      timers.current.push(setTimeout(approve, startAfter));
    }
    return clear;
  }, [state, run, approve, startAfter]);

  // ⌘Z undoes while the countdown runs, as in the app.
  useEffect(() => {
    if (mode !== "count") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  const title = mode === "paid" ? "Paid Designer" : mode === "count" ? "Paying Designer" : "Pay Designer";
  return (
    <div className={`${l.approve}${className ? ` ${className}` : ""}`} data-mode={mode}>
      <div className={l.payCardFlat}>
        <div className={l.payHead}>
          <Face who="D" size={36} hue={5} />
          <div className={l.payWho}>
            <p className={l.payTitle}>{title}</p>
            <p className={l.payAcct}>designer.near</p>
          </div>
          <div className={l.payRight}>
            <p className={`${l.payAmount} ${l.amountSlot}`} aria-hidden={mode === "paid"}>
              50.00 <span>USDC</span>
            </p>
            <p className={l.paidPill} aria-hidden={mode !== "paid"}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" pathLength={1} className={l.paidMark} />
              </svg>
              <span className={l.mono}>50.00 USDC</span> paid 14:07
            </p>
          </div>
        </div>
        <div key={pass} className={l.evidence}>
        <Said at="02:14" className={l.paySaid}>
          pay the designer the <mark className={l.sweep}>fifty dollar</mark> deposit today
        </Said>
        <dl className={`${l.payWell} ${l.heardWell}`}>
          <div>
            <dt>Heard</dt>
            <dd>
              <q className={l.serifQ}>fifty dollar</q> → <span className={l.mono}>50.00 USDC</span>
            </dd>
          </div>
          <div>
            <dt>Payee</dt>
            <dd>
              Designer <span className={l.accent}>· on your list</span>
            </dd>
          </div>
        </dl>
        </div>
        <div className={l.actionStack}>
          <div className={l.actIdle} inert={mode !== "idle"}>
            <span className={l.btnQuiet} aria-hidden="true">
              Dismiss
            </span>
            <span className={l.btnOutline} aria-hidden="true">
              Edit amount
            </span>
            <button type="button" className={`${l.btnPrimary} press`} onClick={approve}>
              Approve payment
            </button>
          </div>
          <div className={l.actCount} inert={mode !== "count"}>
            <p>
              Paying in <Rolling value={String(left)} className={l.countDigit} />… you can still take it back.
            </p>
            <button type="button" className={`${l.undo} press`} onClick={undo}>
              Undo <kbd>⌘Z</kbd>
            </button>
            <span className={l.countBar} key={startedAt} />
          </div>
          <div className={l.actPaid} inert={mode !== "paid"}>
            <p>From your agent wallet</p>
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
      <ReplayButton onClick={replay} label="Replay payment" />
    </div>
  );
}
