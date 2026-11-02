"use client";

import { useEffect, useRef, useState } from "react";
import l from "../landing.module.css";
import { motionOn, useInView } from "./motion";

/**
 * The app's autopilot line: "Sending by autopilot in 0:52 · Undo", counting down a
 * 60-second undo window (UNDO_SECONDS) while it's on screen. Still at 0:52 without motion.
 */
export function AutopilotLine() {
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(52);
  const [on, setOn] = useState(false);
  const inView = useInView(ref);
  useEffect(() => setOn(motionOn()), []);
  useEffect(() => {
    if (!on || !inView) return;
    const id = setInterval(() => setLeft((s) => (s <= 1 ? 60 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [on, inView]);
  const text = `0:${String(left).padStart(2, "0")}`.replace("0:60", "1:00");
  return (
    <div ref={ref} className={l.autopilot} data-running={on && inView ? "" : undefined}>
      <p>
        Sending by autopilot in <span className={l.mono}>{text}</span> · your rules
      </p>
      <span className={l.undoText} aria-hidden="true">
        Undo
      </span>
      <span className={l.autoBar} style={{ transform: `scaleX(${left / 60})` }} />
    </div>
  );
}
