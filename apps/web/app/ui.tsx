import type { CSSProperties, ReactNode } from "react";

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="115" fill="#24221e" />
      <rect x="128" y="92" width="256" height="328" rx="28" fill="#ede9e1" />
      <g fill="#24221e">
        <rect x="167" y="200" width="28" height="80" rx="14" />
        <rect x="214" y="160" width="28" height="160" rx="14" />
        <rect x="261" y="185" width="28" height="110" rx="14" />
        <rect x="308" y="205" width="28" height="70" rx="14" />
      </g>
      <circle cx="378" cy="398" r="56" fill="#24221e" />
      <circle cx="378" cy="398" r="44" fill="#8dbfa8" />
    </svg>
  );
}

export function Page({ width = 640, tag, children }: { width?: number; tag?: string; children: ReactNode }) {
  return (
    <div style={{ minHeight: "100vh" }}>
      <header style={{ maxWidth: width, margin: "0 auto", padding: 24, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo />
          <span className="serif" style={{ fontSize: 20, fontWeight: 500 }}>Aftercall</span>
        </span>
        {tag && <span className="mono muted" style={{ fontSize: 12 }}>{tag}</span>}
      </header>
      <main style={{ maxWidth: width, margin: "0 auto", padding: "32px 24px 64px", display: "flex", flexDirection: "column", gap: 28 }}>{children}</main>
    </div>
  );
}

export function Badge({ tone, children }: { tone: "verdigris" | "caution" | "muted"; children: ReactNode }) {
  const colors = {
    verdigris: { background: "var(--verdigris-tint)", color: "var(--verdigris)" },
    caution: { background: "var(--caution-tint)", color: "var(--caution)" },
    muted: { background: "var(--elevated)", color: "var(--muted)" },
  }[tone];
  return (
    <span className="label" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", minHeight: 24, padding: "4px 10px", borderRadius: 999, ...colors }}>
      {children}
    </span>
  );
}

export const button = (variant: "primary" | "secondary" | "ghost"): CSSProperties => ({
  height: 44,
  padding: "0 18px",
  borderRadius: 6,
  fontSize: 15,
  fontWeight: 600,
  border: variant === "secondary" ? "1px solid var(--border)" : 0,
  background: variant === "primary" ? "var(--verdigris)" : "transparent",
  color: variant === "primary" ? "#10201a" : variant === "ghost" ? "var(--muted)" : "var(--ink)",
});

export function Facts({ rows }: { rows: { label: string; value: string; mono?: boolean }[] }) {
  return (
    <dl className="facts" style={{ margin: 0, display: "grid", gridTemplateColumns: "140px minmax(0, 1fr)", gap: "14px 20px", padding: "22px 24px", borderRadius: 10, background: "var(--raised)", boxShadow: "inset 0 0 0 1px var(--hairline)" }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "contents" }}>
          <dt className="label" style={{ lineHeight: "22px" }}>{r.label}</dt>
          <dd className={r.mono ? "mono" : undefined} style={{ margin: 0, overflowWrap: "anywhere", fontSize: r.mono ? 15 : undefined }}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
