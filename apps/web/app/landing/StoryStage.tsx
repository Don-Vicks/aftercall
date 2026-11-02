"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import l from "../landing.module.css";
import { PlayContext, motionOn, type PlayState } from "./motion";

/*
 * The one-call story's sticky window. The active step is the one whose middle is closest
 * to the middle of the viewport, measured on scroll (once a frame at most), so a page jump
 * or a fast flick never skips one: each step is at least 80vh tall and a page is about 87%
 * of the viewport. Its screen fades in and plays; the others wait armed, and a step that
 * was scrolled past plays when it becomes active. Native scroll only: the stage is
 * position: sticky, nothing is pinned or hijacked.
 */

const StoryContext = createContext<{ active: number; motion: boolean }>({ active: 0, motion: false });

export function StoryStage({ children, className, steps }: { children: ReactNode; className?: string; steps: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [motion, setMotion] = useState(false);
  useEffect(() => {
    setMotion(motionOn());
    const root = ref.current;
    if (!root) return;
    const steps = [...root.querySelectorAll<HTMLElement>("[data-step]")];
    let frame = 0;
    const measure = () => {
      frame = 0;
      const box = root.getBoundingClientRect();
      const mid = window.innerHeight / 2;
      // Before the story reaches the middle of the screen nothing is active; after it, the last step stays.
      if (box.top > mid) {
        setActive(0);
        return;
      }
      if (box.bottom < mid) {
        setActive(steps.length);
        return;
      }
      let best = 0;
      let dist = Infinity;
      for (const el of steps) {
        const r = el.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - mid);
        if (d < dist) {
          dist = d;
          best = Number(el.dataset.step);
        }
      }
      setActive(best);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  const shown = active || 1;
  return (
    <StoryContext.Provider value={{ active, motion }}>
      <div ref={ref} className={className} data-active={shown} style={{ ["--progress" as string]: active ? (active - 0.5) / steps : 0 }}>
        {children}
      </div>
    </StoryContext.Provider>
  );
}

/** One step's screen inside the sticky window. */
export function StoryScreen({ n, children }: { n: number; children: ReactNode }) {
  const { active, motion } = useContext(StoryContext);
  const on = (active || 1) === n;
  const state: PlayState = !motion ? "final" : active === n ? "play" : "armed";
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (state === "play") setRun((r) => r + 1);
  }, [state]);
  return (
    <PlayContext.Provider value={{ state, run }}>
      <div className={l.screen} data-screen={n} data-on={on ? "" : undefined} data-state={state} aria-hidden={!on} inert={!on}>
        {children}
      </div>
    </PlayContext.Provider>
  );
}
