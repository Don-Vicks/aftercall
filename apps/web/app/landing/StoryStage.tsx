"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import l from "../landing.module.css";
import { PlayContext, motionOn, type PlayState } from "./motion";

/*
 * The one-call story's sticky window. The active step is the one crossing the middle
 * of the viewport; its screen fades in and plays, the others wait armed. Native scroll
 * only: the stage is position: sticky, nothing is pinned or hijacked.
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
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    root.querySelectorAll("[data-step]").forEach((el) => io.observe(el));
    return () => io.disconnect();
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
