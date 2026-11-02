import type { CSSProperties, ReactNode } from "react";
import l from "../landing.module.css";

/* Small pieces shared by the server sections and the client moments (no other imports, so client bundles stay small). */

/** Custom properties in a style prop: cssVars({ i: 2 }) sets --i. */
export function cssVars(v: Record<string, string | number | undefined>, base?: CSSProperties): CSSProperties {
  const out: Record<string, string | number> = { ...(base as Record<string, string | number>) };
  for (const [k, value] of Object.entries(v)) if (value !== undefined) out[`--${k}`] = value;
  return out as CSSProperties;
}

/** A keycap: ⌘, ⇧, R. */
export function Key({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <kbd className={`${l.key}${className ? ` ${className}` : ""}`} style={style}>
      {children}
    </kbd>
  );
}

/**
 * A round tick that can draw itself: the fill pops, then the check draws.
 * `i` staggers it inside a playing moment (see .chk in the CSS).
 */
export function Check({ size = 16, i, className, label }: { size?: number; i?: number; className?: string; label?: string }) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <svg className={`${l.chk}${className ? ` ${className}` : ""}`} width={size} height={size} viewBox="0 0 22 22" style={i === undefined ? undefined : cssVars({ i })} {...a11y}>
      <circle className={l.chkFill} cx="11" cy="11" r="10" />
      <path className={l.chkMark} d="M6.5 11.5l3 3 6-6.5" pathLength={1} />
    </svg>
  );
}

/** An avatar the way the app draws one: "You" on verdigris, others on their own colour. */
export function Face({ who, size = 28, hue = 2 }: { who: string; size?: number; hue?: number }) {
  const you = who === "You";
  return (
    <span
      className={l.face}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * (you ? 0.34 : 0.4)),
        background: you ? "var(--verdigris-tint)" : `var(--p${hue})`,
        color: you ? "var(--verdigris)" : `var(--p${hue}i)`,
      }}
    >
      {you ? "You" : who}
    </span>
  );
}

/** A spoken quote, in the app's serif italic, with its place in the call. */
export function Said({ children, at, className }: { children: ReactNode; at?: string; className?: string }) {
  return (
    <p className={`${l.said}${className ? ` ${className}` : ""}`}>
      <q>{children}</q>
      {at ? <span className={l.at}> {at}</span> : null}
    </p>
  );
}

/** The mono caption under every product picture. */
export function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={`${l.caption}${className ? ` ${className}` : ""}`}>{children}</p>;
}

/** Small inline icons the replicas need (the app's lucide shapes, drawn here). */
export function Glyph({ name, size = 14 }: { name: "pen" | "pause" | "stop" | "lock" | "arrow" | "search" | "check" | "send" | "mail"; size?: number }) {
  const d: Record<string, ReactNode> = {
    pen: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />,
    pause: (
      <>
        <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
        <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
      </>
    ),
    stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
    lock: (
      <>
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </>
    ),
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
    check: <path d="M20 6 9 17l-5-5" />,
    send: <path d="m22 2-7 20-4-9-9-4zM22 2 11 13" />,
    mail: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </>
    ),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      {d[name]}
    </svg>
  );
}
