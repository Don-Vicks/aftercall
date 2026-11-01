"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../ui";
import h from "./how.module.css";

type Kind = "mac" | "tee" | "near";

/** The seven stops of one meeting, as docs/privacy.md and the pipeline describe them. */
const STOPS: { kind: Kind; title: string; role: string; sees: string; keeps: string; edge: string | null; caption: string }[] = [
  { kind: "mac", title: "Your Mac", role: "Records, seals the audio", sees: "Your mic and the call's audio, as two tracks", keeps: "The audio, sealed, until the notes are saved", edge: "TLS", caption: "Your Mac records your mic and the call's audio as two tracks, sealing the audio about once a second." },
  { kind: "tee", title: "NEAR AI gateway", role: "Relays to the models", sees: "The audio, over TLS. The transcript only as ciphertext", keeps: "Up to NEAR AI. Its logs aren't attested", edge: "", caption: "First your Mac checks the gateway, Whisper and Qwen against a fresh nonce. Only then does the audio go, over TLS." },
  { kind: "tee", title: "Whisper", role: "Transcribes", sees: "The audio, plus project and payee names as spelling hints", keeps: "Up to NEAR AI's policy", edge: "TLS", caption: "Whisper transcribes every chunk of both tracks. Transcriptions aren't signed per response." },
  { kind: "mac", title: "Your Mac", role: "Encrypts the transcript to Qwen", sees: "The transcript, as You and Others", keeps: "The transcript, sealed", edge: "E2EE", caption: "Your Mac merges both tracks into one transcript and encrypts it to the Qwen TEE's attested key." },
  { kind: "tee", title: "Qwen", role: "Writes and signs the notes", sees: "The transcript and names, opened only inside the TEE", keeps: "Up to NEAR AI's policy", edge: "E2EE", caption: "Qwen writes the notes to a strict schema, signs the exchange with its attested key, and encrypts the reply to your Mac." },
  { kind: "mac", title: "Your Mac", role: "Checks, then saves the notes", sees: "The signed notes", keeps: "The notes, sealed. The audio is deleted", edge: "hash", caption: "Your Mac checks the signature, drops any item without an exact quote, saves the notes and deletes the audio." },
  { kind: "near", title: "NEAR", role: "A hash only", sees: "A sha256 hash, the start time and the model name", keeps: "Those, in public, for good. No content", edge: null, caption: "A sha256 hash of the proof goes on NEAR with the start time and the model name. No meeting content." },
];
const KIND_LABEL: Record<Kind, string> = { mac: "On your Mac", tee: "TEE", near: "Public chain" };
const LAST = STOPS.length - 1;
const TICK_MS = 1100;

/**
 * The journey diagram: it plays through the stops once, lighting each arrow as the
 * meeting passes. Picking a stop (click, or arrow keys) stops the play and shows its
 * caption. With reduced motion it doesn't play on its own.
 */
export function Journey() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [played, setPlayed] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const play = useCallback(() => {
    clearInterval(timer.current);
    setStep(0);
    setPlaying(true);
    setPlayed(true);
    timer.current = setInterval(() => {
      setStep((s) => {
        if (s + 1 >= LAST) {
          clearInterval(timer.current);
          setPlaying(false);
          return LAST;
        }
        return s + 1;
      });
    }, TICK_MS);
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(false);
    else play();
    return () => clearInterval(timer.current);
  }, [play]);

  const pick = (i: number) => {
    clearInterval(timer.current);
    setPlaying(false);
    setStep(i);
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: LAST }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(LAST, to));
    pick(next);
    buttons.current[next]?.focus();
  };

  return (
    <div className={h.journeyWrap}>
      <div className={h.journeyHead}>
        <div>
          <h2 id="jt" className={h.h2}>
            The journey of one meeting
          </h2>
          <p className={h.intro}>What each stop sees and keeps. Both trips to the models pass through the gateway; on the way to Qwen it only relays ciphertext.</p>
        </div>
        <button type="button" onClick={play} className="btn btn-secondary press" aria-label={playing ? "Playing the journey" : played ? "Play the journey again" : "Play the journey"}>
          <Icon name="refresh" size={14} />
          {playing ? "Playing" : played ? "Play it again" : "Play it"}
        </button>
      </div>

      <figure aria-label="One meeting from your Mac, through NEAR AI's secure hardware, back to your Mac, then a hash on NEAR" className={`${h.figure} enter`} style={{ ["--d" as string]: "80ms", ["--dur" as string]: "360ms" }}>
        <ol className={h.stops}>
          {STOPS.map((d, i) => {
            const active = i === step;
            const dim = playing && i > step;
            const lit = i < step || (!playing && step === LAST);
            const node = `${h.node} ${h[d.kind]}${active ? ` ${h.active} pop` : ""}${dim ? ` ${h.dim}` : ""}`;
            const edgeChip = d.edge ? <span className={`${h.edgeChip}${d.edge === "E2EE" ? ` ${h.edgeE2ee}` : ""}`}>{d.edge}</span> : null;
            return (
              <li key={i} className={h.stop}>
                <div className={h.nodeWrap}>
                  <button
                    type="button"
                    ref={(el) => {
                      buttons.current[i] = el;
                    }}
                    onClick={() => pick(i)}
                    onKeyDown={(e) => onKey(e, i)}
                    aria-pressed={active}
                    aria-label={`${i + 1} of ${STOPS.length}: ${d.title}, ${d.role}`}
                    className={node}
                  >
                    <span className={h.nodeKind}>
                      <Icon name={d.kind === "mac" ? "laptop" : d.kind === "tee" ? "shieldCheck" : "chain"} size={16} stroke={1.75} />
                      <span>{KIND_LABEL[d.kind]}</span>
                      <span className={h.nodeNo}>{String(i + 1).padStart(2, "0")}</span>
                    </span>
                    <span className={h.nodeTitle}>{d.title}</span>
                    <span className={h.nodeRole}>{d.role}</span>
                  </button>
                  {d.edge !== null && (
                    <span aria-hidden="true" className={`${h.edge}${lit ? ` ${h.lit}` : ""}`}>
                      <span className={h.line} />
                      <Arrow />
                      {edgeChip}
                    </span>
                  )}
                </div>
                <dl className={`${h.sees}${dim ? ` ${h.dim}` : ""}`}>
                  <div>
                    <dt>Sees: </dt>
                    <dd>{d.sees}</dd>
                  </div>
                  <div>
                    <dt>Keeps: </dt>
                    <dd>{d.keeps}</dd>
                  </div>
                </dl>
                {d.edge !== null && (
                  <span aria-hidden="true" className={`${h.edgeDown}${lit ? ` ${h.lit}` : ""}`}>
                    <span className={h.line} />
                    <Arrow />
                    {edgeChip}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        <div className={h.captionRow}>
          <span className={h.step}>
            {step + 1} of {STOPS.length}
          </span>
          <p aria-live="polite" className={h.caption}>
            {STOPS[step].caption}
          </p>
          <span className={h.legend}>
            <span>
              <span aria-hidden="true" className={h.key} style={{ background: "var(--verdigris-tint)", boxShadow: "inset 0 0 0 1px var(--verdigris)" }} />
              Your Mac
            </span>
            <span>
              <span aria-hidden="true" className={h.key} style={{ background: "var(--elevated)", boxShadow: "inset 0 0 0 1px var(--border)" }} />
              Secure hardware, checked first
            </span>
            <span>
              <span aria-hidden="true" className={h.key} style={{ background: "var(--well)", boxShadow: "inset 0 0 0 1px var(--border)" }} />
              NEAR, public
            </span>
          </span>
        </div>
      </figure>
    </div>
  );
}

function Arrow() {
  return (
    <svg width="7" height="10" viewBox="0 0 7 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m1 1 5 4-5 4" />
    </svg>
  );
}
