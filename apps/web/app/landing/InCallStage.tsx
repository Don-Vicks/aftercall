"use client";

import { useEffect, useRef, useState } from "react";
import l from "../landing.module.css";
import { Face, Glyph, Key } from "./atoms";
import { Rolling, TIMING, motionOn, useInView, watch } from "./motion";

/*
 * Moment 1, the live recorder, over a neutral call window. The server renders the
 * finished state (recording at 12:34, your notes typed); with motion on, the opening
 * plays once when the stage comes into view (storyboard in motion.tsx, TIMING.call),
 * then the timer, the two meters and the tiles' glow run while it stays in view.
 */

const FINAL = 12 * 60 + 34;
const START = 12 * 60 + 31;
const LINE_2 = "Deck: refresh with the designer, deposit now, rest when it's done.";
const ENVELOPE = [0.55, 0.8, 1, 0.8, 0.55];
/** The still meters: a calm mid level for each side. */
const STILL_MIC = [0.32, 0.55, 0.8, 0.5, 0.3];
const STILL_CALL = [0.22, 0.4, 0.55, 0.38, 0.2];

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

type Phase = { keys: boolean; sheet: "off" | "in" | "out"; ticked: boolean; pressing: boolean; rec: boolean; notes: boolean };
const FINAL_PHASE: Phase = { keys: false, sheet: "off", ticked: true, pressing: false, rec: true, notes: true };
const ARMED: Phase = { keys: false, sheet: "off", ticked: false, pressing: false, rec: false, notes: false };

export function InCallStage() {
  const stage = useRef<HTMLDivElement>(null);
  const micBars = useRef<HTMLSpanElement>(null);
  const callBars = useRef<HTMLSpanElement>(null);
  const youRing = useRef<HTMLSpanElement>(null);
  const adaRing = useRef<HTMLSpanElement>(null);
  const [live, setLive] = useState(false); // motion on and the opening has started
  const [phase, setPhase] = useState<Phase>(FINAL_PHASE);
  const [seconds, setSeconds] = useState(FINAL);
  const [typed, setTyped] = useState(LINE_2.length);
  const [paused, setPaused] = useState(false);
  const inView = useInView(stage);
  const running = live && phase.rec && inView && !paused;

  // Arm on mount, play the opening once 25% of the stage is in view.
  useEffect(() => {
    const el = stage.current;
    if (!el || !motionOn()) return;
    setPhase(ARMED);
    setSeconds(START);
    setTyped(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, f: () => void) => timers.push(setTimeout(f, ms));
    const stop = watch(
      el,
      (e) => {
        if (!e.isIntersecting) return;
        stop();
        const t = TIMING.call;
        setLive(true);
        at(t.keys, () => setPhase((p) => ({ ...p, keys: true })));
        at(t.sheetIn, () => setPhase((p) => ({ ...p, keys: false, sheet: "in" })));
        at(t.tick, () => setPhase((p) => ({ ...p, ticked: true })));
        at(t.start, () => setPhase((p) => ({ ...p, pressing: true })));
        at(t.sheetOut, () => setPhase((p) => ({ ...p, pressing: false, sheet: "out" })));
        at(t.recorder, () => setPhase((p) => ({ ...p, rec: true })));
        at(t.notes, () => setPhase((p) => ({ ...p, notes: true })));
        at(t.notes + 280, () => {
          let n = 0;
          const typing = setInterval(() => {
            n += 1;
            setTyped(n);
            if (n >= LINE_2.length) clearInterval(typing);
          }, t.typeEvery);
          timers.push(typing as unknown as ReturnType<typeof setTimeout>);
        });
      },
      { threshold: 0.25 },
    );
    return () => {
      stop();
      timers.forEach((x) => {
        clearTimeout(x);
        clearInterval(x);
      });
    };
  }, []);

  // The timer: one second at a time while recording and in view.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Two meters, each following its own level: two smoothed random walks that take turns,
  // so they read as two people talking. 12 updates a second, transforms only.
  useEffect(() => {
    if (!running) return;
    const level = { you: 0.3, ada: 0.2 };
    let speaker: "you" | "ada" | "both" = "ada";
    let next = performance.now() + 1800;
    const set = (bars: HTMLSpanElement | null, v: number) => {
      bars?.querySelectorAll<HTMLElement>("i").forEach((b, i) => {
        const s = Math.min(1, Math.max(0.15, v * ENVELOPE[i] * (0.7 + Math.random() * 0.6)));
        b.style.transform = `scaleY(${s.toFixed(3)})`;
      });
    };
    const id = setInterval(() => {
      const now = performance.now();
      if (now > next) {
        const r = Math.random();
        speaker = speaker === "you" ? (r < 0.8 ? "ada" : "both") : speaker === "ada" ? (r < 0.8 ? "you" : "both") : r < 0.5 ? "you" : "ada";
        next = now + (speaker === "both" ? 700 : 1600 + Math.random() * 2600);
      }
      const talk = () => 0.6 + Math.random() * 0.4;
      const quiet = () => 0.08 + Math.random() * 0.14;
      const tYou = speaker === "ada" ? quiet() : talk() * (speaker === "both" ? 0.75 : 1);
      const tAda = speaker === "you" ? quiet() : talk() * (speaker === "both" ? 0.75 : 1);
      level.you += (tYou - level.you) * 0.35;
      level.ada += (tAda - level.ada) * 0.35;
      set(micBars.current, level.you);
      set(callBars.current, level.ada);
      if (youRing.current) youRing.current.style.opacity = level.you > 0.6 ? "0.9" : "0.2";
      if (adaRing.current) adaRing.current.style.opacity = level.ada > 0.6 ? "0.9" : "0.2";
    }, TIMING.call.meterEvery);
    return () => clearInterval(id);
  }, [running]);

  const time = clock(seconds);
  return (
    <div
      ref={stage}
      className={l.callStage}
      data-live={live ? "" : undefined}
      data-running={running ? "" : undefined}
      data-keys={phase.keys ? "" : undefined}
      data-sheet={phase.sheet}
      data-rec={phase.rec ? "on" : "off"}
      data-notes={phase.notes ? "on" : "off"}
    >
      <p className="sr-only">
        A call with Ada, with Aftercall recording it at {time}: the floating recorder shows a meter for your mic and one for the call, and Your notes holds two lines typed during the call:
        “Fix before demo, no exceptions.” and “{LINE_2}”
      </p>
      <div className={l.callArt} aria-hidden="true">
        <div className={l.menubar}>
          <span className={l.menuClock}>
            <i className={l.recDot} />
            <Rolling value={time} still={!live} />
          </span>
          <span>Mon 2 Nov 14:05</span>
        </div>

        <div className={l.callKeys}>
          <Key style={{ ["--k" as string]: 0 }}>⌘</Key>
          <Key style={{ ["--k" as string]: 1 }}>⇧</Key>
          <Key style={{ ["--k" as string]: 2 }}>R</Key>
          <span className={l.callKeysNote}>from any app</span>
        </div>

        <div className={l.callWindow}>
          <div className={l.callBar}>
            <span className={l.callDots}>
              <i />
              <i />
              <i />
            </span>
            <span>Call</span>
          </div>
          <div className={l.tiles}>
            <div className={l.tile}>
              <span ref={youRing} className={`${l.tileRing} ${l.tileRingYou}`} />
              <Face who="You" size={76} />
              <span className={l.tileName}>You</span>
            </div>
            <div className={l.tile}>
              <span ref={adaRing} className={l.tileRing} />
              <Face who="A" size={76} hue={2} />
              <span className={l.tileName}>Ada</span>
            </div>
          </div>
          <span className={l.toldChip}>
            <Glyph name="check" size={12} />
            You told everyone it&apos;s recorded
          </span>
        </div>

        <div className={l.recorderWrap}>
          <div className={l.recorder}>
            <i className={l.recDot} />
            <span className={l.recTime}>
              <Rolling value={time} still={!live} />
            </span>
            <span ref={micBars} className={`${l.meter} ${l.meterMic}`}>
              {STILL_MIC.map((v, i) => (
                <i key={i} style={{ transform: `scaleY(${v})` }} />
              ))}
            </span>
            <span ref={callBars} className={`${l.meter} ${l.meterCall}`}>
              {STILL_CALL.map((v, i) => (
                <i key={i} style={{ transform: `scaleY(${v})` }} />
              ))}
            </span>
            <span className={l.recBtn}>
              <Glyph name="pen" size={13} />
              Note
            </span>
            <span className={`${l.recBtn} ${l.recIcon}`}>
              <Glyph name="pause" size={12} />
            </span>
            <span className={l.recStop}>
              <Glyph name="stop" size={11} />
              Stop
            </span>
          </div>
          <div className={l.meterLegend}>
            <span>
              <i className={l.legendMic} />
              Your mic
            </span>
            <span>
              <i className={l.legendCall} />
              The call
            </span>
          </div>
        </div>

        <div className={l.notesPop}>
          <p className={l.notesTitle}>
            Your notes <span>only you write here</span>
            <kbd>⌘⇧R</kbd>
          </p>
          <div className={l.notesBody}>
            <p>Fix before demo, no exceptions.</p>
            <p>
              {LINE_2.slice(0, typed)}
              {live && typed < LINE_2.length ? <span className={l.caret} /> : null}
              <span className={l.notesGhost}>{LINE_2.slice(typed)}</span>
            </p>
          </div>
        </div>

        <div className={l.sheet}>
          <p className={l.sheetTitle}>Start a recording</p>
          <p className={l.sheetLabel}>From your calendar</p>
          <div className={l.sheetEvent}>
            <Face who="A" size={26} hue={2} />
            <span>
              <b>Sync with Ada</b>
              <span>Starts now · 14:02</span>
            </span>
          </div>
          <p className={l.sheetCheck} data-on={phase.ticked ? "" : undefined}>
            <svg width="18" height="18" viewBox="0 0 22 22" aria-hidden="true">
              <circle cx="11" cy="11" r="9.5" className={l.sheetBox} />
              <circle cx="11" cy="11" r="10" className={l.sheetFill} />
              <path d="M6.5 11.5l3 3 6-6.5" pathLength={1} className={l.sheetMark} />
            </svg>
            I&apos;ve told everyone on the call
          </p>
          <span className={l.sheetStart} data-pressing={phase.pressing ? "" : undefined}>
            <i />
            Start recording
            <kbd>⌘⇧R</kbd>
          </span>
        </div>
      </div>

      {live ? (
        <button type="button" className={`${l.pauseMotion} press`} aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
          {paused ? "Play motion" : "Pause motion"}
        </button>
      ) : null}
    </div>
  );
}
