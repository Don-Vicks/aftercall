"use client";

import { useEffect, useRef, useState } from "react";
import l from "../landing.module.css";
import { Face, Glyph, Key } from "./atoms";
import { Rolling, TIMING, motionOn, useInView, watch } from "./motion";

/*
 * Moment 1, the live recorder, over a neutral call window. The sample call is Sync with Ada
 * (sample.ts: started 14:02, the payment line said at 02:14). The server renders the finished
 * state: recording at 02:16, the menu bar at 14:04, the line just said, your notes typed.
 * With motion on, the opening plays once when the stage comes into view (storyboard in
 * motion.tsx, TIMING.call): ⌘⇧R, the record sheet, the recorder at 00:00, a jump two
 * minutes in, the line typed as it's said, then your notes. The timer, the two meters and
 * the tiles' glow run while it stays in view.
 *
 * Aftercall doesn't transcribe during the call: the line under the tiles is what's being
 * said, and the note beside it is the page explaining what happens to it after Stop.
 */

const FINAL = 2 * 60 + 16;
const JUMP_TO = 2 * 60 + 11;
const SAID = "Send Ada the recap after this call, and pay the designer the fifty dollar deposit today.";
const QUOTE_FROM = SAID.indexOf("pay the designer");
const LINE_2 = "Deck: refresh with the designer, deposit now, rest when it's done.";
const ENVELOPE = [0.45, 0.65, 0.85, 1, 0.85, 0.65, 0.45];
/** The still meters: a calm mid level for each side. */
const STILL_MIC = [0.3, 0.5, 0.72, 0.9, 0.66, 0.46, 0.28];
const STILL_CALL = [0.2, 0.3, 0.42, 0.5, 0.4, 0.28, 0.18];

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

type Phase = { keys: boolean; sheet: "off" | "in" | "out"; ticked: boolean; pressing: boolean; rec: boolean; jump: boolean; heard: boolean; notes: boolean };
const FINAL_PHASE: Phase = { keys: false, sheet: "off", ticked: true, pressing: false, rec: true, jump: false, heard: true, notes: true };
const ARMED: Phase = { keys: false, sheet: "off", ticked: false, pressing: false, rec: false, jump: false, heard: false, notes: false };

export function InCallStage() {
  const stage = useRef<HTMLDivElement>(null);
  const micBars = useRef<HTMLSpanElement>(null);
  const callBars = useRef<HTMLSpanElement>(null);
  const youRing = useRef<HTMLSpanElement>(null);
  const adaRing = useRef<HTMLSpanElement>(null);
  const talking = useRef<"you" | null>(null);
  const [live, setLive] = useState(false); // motion on and the opening has started
  const [phase, setPhase] = useState<Phase>(FINAL_PHASE);
  const [seconds, setSeconds] = useState(FINAL);
  const [said, setSaid] = useState(SAID.length);
  const [typed, setTyped] = useState(LINE_2.length);
  const [paused, setPaused] = useState(false);
  const inView = useInView(stage);
  const running = live && phase.rec && inView && !paused;

  // Arm on mount, play the opening once 25% of the stage is in view.
  useEffect(() => {
    const el = stage.current;
    if (!el || !motionOn()) return;
    setPhase(ARMED);
    setSeconds(0);
    setSaid(0);
    setTyped(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, f: () => void) => timers.push(setTimeout(f, ms));
    const type = (every: number, length: number, set: (n: number) => void, done?: () => void) => {
      let n = 0;
      const id = setInterval(() => {
        n += 1;
        set(n);
        if (n >= length) {
          clearInterval(id);
          done?.();
        }
      }, every);
      timers.push(id as unknown as ReturnType<typeof setTimeout>);
    };
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
        at(t.jump, () => {
          setSeconds(JUMP_TO);
          setPhase((p) => ({ ...p, jump: true }));
        });
        at(t.jump + 1600, () => setPhase((p) => ({ ...p, jump: false })));
        at(t.said, () => {
          talking.current = "you";
          type(t.sayEvery, SAID.length, setSaid, () => {
            talking.current = null;
          });
        });
        at(t.heard, () => setPhase((p) => ({ ...p, heard: true })));
        at(t.notes, () => setPhase((p) => ({ ...p, notes: true })));
        at(t.notes + 280, () => type(t.typeEvery, LINE_2.length, setTyped));
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
  // so they read as two people talking (you, while your line is being said). 12 updates a
  // second, transforms only.
  useEffect(() => {
    if (!running) return;
    const level = { you: 0.3, ada: 0.2 };
    let speaker: "you" | "ada" | "both" = "ada";
    let next = performance.now() + 1800;
    const set = (bars: HTMLSpanElement | null, v: number) => {
      bars?.querySelectorAll<HTMLElement>("i").forEach((b, i) => {
        const s = Math.min(1, Math.max(0.12, v * ENVELOPE[i] * (0.7 + Math.random() * 0.6)));
        b.style.transform = `scaleY(${s.toFixed(3)})`;
      });
    };
    const id = setInterval(() => {
      const now = performance.now();
      if (talking.current) speaker = "you";
      else if (now > next) {
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
      if (youRing.current) youRing.current.style.opacity = level.you > 0.6 ? "0.9" : "0.15";
      if (adaRing.current) adaRing.current.style.opacity = level.ada > 0.6 ? "0.9" : "0.15";
    }, TIMING.call.meterEvery);
    return () => clearInterval(id);
  }, [running]);

  const time = clock(seconds);
  const saying = live && said > 0 && said < SAID.length;
  return (
    <div
      ref={stage}
      className={l.callStage}
      data-live={live ? "" : undefined}
      data-running={running ? "" : undefined}
      data-keys={phase.keys ? "" : undefined}
      data-sheet={phase.sheet}
      data-rec={phase.rec ? "on" : "off"}
      data-jump={phase.jump ? "" : undefined}
      data-heard={phase.heard ? "on" : "off"}
      data-notes={phase.notes ? "on" : "off"}
    >
      <p className="sr-only">
        A call with Ada, with Aftercall recording it, {time} in. The floating recorder shows one meter for your mic and one for the call. You say: “{SAID}” Your notes, typed during the call:
        “Fix before demo, no exceptions.” and “{LINE_2}” After the call, that line becomes a 50.00 USDC payment to the designer, waiting for your approval.
      </p>
      <div className={l.callArt} aria-hidden="true">
        <div className={l.menubar}>
          <span className={l.menuClock}>
            <i className={l.recDot} />
            <Rolling value={time} still={!live} />
          </span>
          <span>14:04</span>
        </div>

        <div className={l.desk}>
          <div className={l.callKeys}>
            <Key style={{ ["--k" as string]: 0 }}>⌘</Key>
            <Key style={{ ["--k" as string]: 1 }}>⇧</Key>
            <Key style={{ ["--k" as string]: 2 }}>R</Key>
            <span className={l.callKeysNote}>opens the record sheet from any app</span>
          </div>

          <div className={l.callWindow}>
            <div className={l.callBar}>
              <span className={l.callDots}>
                <i />
                <i />
                <i />
              </span>
              <span>Sync with Ada</span>
            </div>
            <div className={l.tiles}>
              <div className={l.tile}>
                <span ref={youRing} className={`${l.tileRing} ${l.tileRingYou}`} />
                <Face who="You" size={64} />
                <span className={l.tileName}>You</span>
              </div>
              <div className={l.tile}>
                <span ref={adaRing} className={l.tileRing} />
                <Face who="A" size={64} hue={2} />
                <span className={l.tileName}>Ada</span>
              </div>
            </div>
            <div className={l.saidStrip} data-idle={live && said === 0 ? "" : undefined}>
              <span className={l.saidLabel}>Said on the call · 02:14</span>
              <p className={l.saidLine}>
                <b>You</b>
                <span>
                  {SAID.slice(0, Math.min(said, QUOTE_FROM))}
                  <span className={l.saidQuote}>{said > QUOTE_FROM ? SAID.slice(QUOTE_FROM, said) : ""}</span>
                  {saying ? <span className={l.caret} /> : null}
                  <span className={l.notesGhost}>{SAID.slice(said)}</span>
                </span>
              </p>
            </div>
          </div>

          <div className={l.recorderWrap}>
            <span className={l.jumpTag}>Two minutes in</span>
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
                <span className={l.recBtnLabel}>Note</span>
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
                {live && phase.notes && typed < LINE_2.length ? <span className={l.caret} /> : null}
                <span className={l.notesGhost}>{LINE_2.slice(typed)}</span>
              </p>
            </div>
          </div>

          <div className={l.heardNote}>
            <Glyph name="arrow" size={14} />
            <span>
              After the call, <q className={l.serifQ}>fifty dollar</q> becomes a <b className={l.mono}>50.00 USDC</b> payment to the designer, waiting for your approval.
            </span>
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
      </div>

      {live ? (
        <button type="button" className={`${l.pauseMotion} press`} aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
          {paused ? "Play motion" : "Pause motion"}
        </button>
      ) : null}
    </div>
  );
}
