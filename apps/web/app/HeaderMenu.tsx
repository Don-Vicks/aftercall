"use client";

import { useEffect, useRef, type ReactNode } from "react";
import s from "./site.module.css";

/** The header's Menu below 900 px: a disclosure that closes on Escape, a click outside or a link. */
export function HeaderMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const close = (focus: boolean) => {
      if (!d.open) return;
      d.open = false;
      if (focus) d.querySelector("summary")?.focus();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(true);
    const onDown = (e: PointerEvent) => !d.contains(e.target as Node) && close(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, []);
  return (
    <details ref={ref} className={s.menu}>
      <summary className={s.menuButton}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 8h16M4 16h16" />
        </svg>
        Menu
      </summary>
      <nav aria-label="Menu" className={s.menuSheet} onClick={(e) => (e.target as HTMLElement).closest("a") && ref.current && (ref.current.open = false)}>
        {children}
      </nav>
    </details>
  );
}
