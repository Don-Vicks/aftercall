"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import l from "../landing.module.css";
import { PlayContext, motionOn, watch, type PlayState } from "./motion";

/*
 * The features switcher: WAI-ARIA tabs (arrow keys move, Home/End jump, roving tabindex).
 * Every panel stays in the DOM, stacked in one grid cell; the inactive ones are inert,
 * hidden from screen readers and transparent, so the page's HTML still holds all of them.
 * A panel "plays" (its demo runs) each time it's opened, once the section has been seen.
 */

export type Tab = { id: string; name: string; keycap?: string; line: string };

const useIsoLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function FeatureTabs({ tabs, panels }: { tabs: Tab[]; panels: ReactNode[] }) {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [seen, setSeen] = useState(false);
  const [motion, setMotion] = useState(false);
  const [runs, setRuns] = useState<number[]>(() => tabs.map(() => 0));
  const [bar, setBar] = useState<{ y: number; h: number; x: number; w: number } | null>(null);

  useEffect(() => {
    setMotion(motionOn());
    const el = root.current;
    if (!el) return;
    const stop = watch(el, (e) => {
      if (!e.isIntersecting) return;
      setSeen(true);
      stop();
    });
    return stop;
  }, []);

  // The indicator follows the selected tab (measured, so it slides between tabs of any height).
  useIsoLayout(() => {
    const measure = () => {
      const tab = list.current?.querySelectorAll<HTMLElement>("[role=tab]")[active];
      if (tab) setBar({ y: tab.offsetTop, h: tab.offsetHeight, x: tab.offsetLeft, w: tab.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);

  const select = (i: number, focus = false) => {
    setActive(i);
    setRuns((r) => r.map((v, k) => (k === i ? v + 1 : v)));
    if (focus) {
      const tab = list.current?.querySelectorAll<HTMLElement>("[role=tab]")[i];
      tab?.focus();
      tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = tabs.length;
    const k = e.key;
    let next = -1;
    if (k === "ArrowDown" || k === "ArrowRight") next = (active + 1) % n;
    else if (k === "ArrowUp" || k === "ArrowLeft") next = (active - 1 + n) % n;
    else if (k === "Home") next = 0;
    else if (k === "End") next = n - 1;
    if (next >= 0) {
      e.preventDefault();
      select(next, true);
    }
  };

  return (
    <div ref={root} className={l.features}>
      <div ref={list} role="tablist" aria-label="What Aftercall does" aria-orientation="vertical" className={l.tablist} onKeyDown={onKey}>
        {bar ? <span className={l.tabBar} aria-hidden="true" style={{ transform: `translate(${bar.x}px, ${bar.y}px)`, height: bar.h, width: bar.w }} /> : null}
        {tabs.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-controls={`panel-${t.id}`}
            aria-selected={active === i}
            tabIndex={active === i ? 0 : -1}
            className={l.tab}
            onClick={() => select(i)}
          >
            <span className={l.tabTop}>
              <span className={l.tabName}>{t.name}</span>
              {t.keycap ? <kbd className={l.tabKey}>{t.keycap}</kbd> : null}
            </span>
            <span className={l.tabLine}>{t.line}</span>
          </button>
        ))}
      </div>
      <div className={l.panels}>
        {panels.map((p, i) => {
          const on = active === i;
          const state: PlayState = !motion ? "final" : on && seen ? "play" : "armed";
          return (
            <div
              key={tabs[i].id}
              role="tabpanel"
              id={`panel-${tabs[i].id}`}
              aria-labelledby={`tab-${tabs[i].id}`}
              className={l.panel}
              data-on={on ? "" : undefined}
              data-state={state}
              aria-hidden={!on}
              inert={!on}
              tabIndex={on ? 0 : -1}
            >
              <PlayContext.Provider value={{ state, run: runs[i] }}>
                <p className={l.panelLine}>{tabs[i].line}</p>
                {p}
              </PlayContext.Provider>
            </div>
          );
        })}
      </div>
    </div>
  );
}
