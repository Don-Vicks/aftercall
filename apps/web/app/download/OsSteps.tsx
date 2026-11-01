"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import d from "./download.module.css";

const STEPS = {
  "14": ["In Finder, open your Applications folder.", "Control-click Aftercall, or right-click it, and choose Open.", "Choose Open again in the dialog. macOS remembers this, so it’s only once."],
  "15": ["Open Aftercall once, then choose Done in the warning.", "Go to System Settings › Privacy & Security and scroll down.", "Choose Open Anyway next to Aftercall, then confirm with your password."],
} as const;
type Os = keyof typeof STEPS;
const TABS: { id: Os; label: string }[] = [
  { id: "14", label: "macOS 14" },
  { id: "15", label: "macOS 15 or later" },
];

/** How to open an unnotarized build, per macOS version. Tabs move with the arrow keys. */
export function OsSteps() {
  const [os, setOs] = useState<Os>("15");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent, i: number) => {
    const to = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i - 1 + TABS.length) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    setOs(TABS[to].id);
    refs.current[to]?.focus();
  };

  return (
    <>
      <div role="tablist" aria-label="Your macOS version" className={d.tabs}>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`os-tab-${t.id}`}
            aria-selected={os === t.id}
            aria-controls="os-panel"
            tabIndex={os === t.id ? 0 : -1}
            onClick={() => setOs(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={`${d.tab} press`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <ol id="os-panel" role="tabpanel" aria-labelledby={`os-tab-${os}`} className={`${d.steps} ${d.osSteps}`} key={os}>
        {STEPS[os].map((text, i) => (
          <li key={text} className="enter" style={{ ["--d" as string]: `${i * 50}ms`, ["--dur" as string]: "240ms" }}>
            <span className={d.stepNo}>{String(i + 1).padStart(2, "0")}</span>
            <span className="ink">{text}</span>
          </li>
        ))}
      </ol>
    </>
  );
}
