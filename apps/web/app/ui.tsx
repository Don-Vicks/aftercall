import type { CSSProperties, ReactNode } from "react";
import { initials, personHue } from "@aftercall/core";
import { HeaderMenu } from "./HeaderMenu";
import { DOWNLOAD_HREF, DOWNLOAD_NOTE, REPO_PUBLIC } from "./site";
import s from "./site.module.css";

/** Where the code lives, for every "GitHub" and "Read the code" link. */
export const REPO_URL = "https://github.com/Don-Vicks/aftercall";

/** Custom properties in a style prop: vars({ d: "120ms" }) sets --d. */
export function vars(v: Record<string, string | number | undefined>, base?: CSSProperties): CSSProperties {
  const out: Record<string, string | number> = { ...(base as Record<string, string | number>) };
  for (const [k, value] of Object.entries(v)) if (value !== undefined) out[`--${k}`] = value;
  return out as CSSProperties;
}

/** The mark: a page with a waveform and a verified tick. Drawn with the tokens, so it follows the theme. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="2" width="13" height="18" rx="2.2" fill="var(--ink)" />
      <rect x="6.6" y="9" width="1.5" height="4" rx=".75" fill="var(--raised)" />
      <rect x="9.1" y="7" width="1.5" height="8" rx=".75" fill="var(--raised)" />
      <rect x="11.6" y="8.2" width="1.5" height="5.6" rx=".75" fill="var(--raised)" />
      <rect x="14.1" y="9.4" width="1.5" height="3.2" rx=".75" fill="var(--raised)" />
      <circle cx="17.6" cy="18.4" r="5.4" fill="var(--raised)" />
      <circle cx="17.6" cy="18.4" r="4.2" fill="var(--verdigris)" />
      <path d="M15.7 18.5l1.3 1.3 2.4-2.6" fill="none" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" stroke="var(--on-verdigris)" />
    </svg>
  );
}

const ICONS = {
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  external: <path d="M7 17 17 7M8 7h9v9" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  check: <path d="M20 6 9 17l-5-5" />,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />,
  shieldCheck: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>
  ),
  chevronRight: <path d="m9 6 6 6-6 6" />,
  laptop: (
    <>
      <rect x="4" y="5" width="16" height="11" rx="2" />
      <path d="M2 20h20" />
    </>
  ),
  chain: (
    <>
      <rect x="3" y="8" width="7" height="8" rx="2" />
      <rect x="14" y="8" width="7" height="8" rx="2" />
      <path d="M10 12h4" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  speaker: (
    <>
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m10.8 12.2 8.7-8.7M17 6l3 3M14.5 8.5l2 2" />
    </>
  ),
  note: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-5M12 8h.01" />
    </>
  ),
  x: <path d="M18 6 6 18M6 6l12 12" />,
  minus: <path d="M5 12h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
} as const;

export type IconName = keyof typeof ICONS;

/** Line icons from the boards (24-unit grid, round caps). Decorative: give the control its own label. */
export function Icon({ name, size = 16, stroke = 2, className, style }: { name: IconName; size?: number; stroke?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={{ flexShrink: 0, ...style }}
    >
      {ICONS[name]}
    </svg>
  );
}

/**
 * A round tick: the circle pops, then the check draws. `d1`/`d2` stagger it.
 * A failed one is a record-tinted cross. Labelled for screen readers unless decorative.
 */
export function Tick({ ok = true, size = 20, d1, d2, still, label, decorative }: { ok?: boolean; size?: number; d1?: string; d2?: string; still?: boolean; label?: string; decorative?: boolean }) {
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img", "aria-label": label ?? (ok ? "Passed" : "Failed") };
  return (
    <svg className={`tick${still ? " still" : ""}`} width={size} height={size} viewBox="0 0 22 22" style={vars({ d1, d2 })} {...a11y}>
      {ok ? (
        <>
          <circle className="tick-fill" cx="11" cy="11" r="10" fill="var(--verdigris)" />
          <path className="tick-mark" d="M6.5 11.5l3 3 6-6.5" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" stroke="var(--on-verdigris)" />
        </>
      ) : (
        <>
          <circle className="tick-fill" cx="11" cy="11" r="10" fill="var(--record-tint)" />
          <path className="tick-mark" d="M7.5 7.5l7 7M14.5 7.5l-7 7" fill="none" strokeWidth="2.2" strokeLinecap="round" stroke="var(--record)" />
        </>
      )}
    </svg>
  );
}

/** An action item not done yet: the empty circle. */
export function OpenCircle({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="11" cy="11" r="9.25" fill="none" strokeWidth="1.5" stroke="var(--border)" />
    </svg>
  );
}

/**
 * A person: initials on their colour, worked out from the name with `personHue`,
 * so the same person has the same colour here and in the app. "You" is verdigris.
 */
export function Avatar({ name, size = 28, ring, decorative, className }: { name: string; size?: number; ring?: "raised" | "elevated" | "ground"; decorative?: boolean; className?: string }) {
  const you = name === "You";
  const hue = personHue(name);
  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.round(size * (you ? 0.36 : 0.38)),
    background: you ? "var(--verdigris-tint)" : `var(--p${hue})`,
    color: you ? "var(--verdigris)" : `var(--p${hue}i)`,
    boxShadow: ring ? `0 0 0 2px var(--${ring})` : undefined,
  };
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img", "aria-label": name };
  return (
    <span className={`avatar${className ? ` ${className}` : ""}`} style={style} {...a11y}>
      {you ? "You" : initials(name)}
    </span>
  );
}

/** Status pill, uppercase inside (the only place uppercase is used). */
export function Pill({ tone, icon, children, className, style }: { tone: "verdigris" | "caution" | "record" | "muted" | "outline"; icon?: ReactNode; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <span className={`pill pill-${tone} t-label${className ? ` ${className}` : ""}`} style={style}>
      {icon}
      {children}
    </span>
  );
}

/** The Verified seal. `id` must be unique on the page (it names the text path). */
export function Seal({ size = 148, id, fine, className, style }: { size?: number; id: string; fine?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 148 148" aria-hidden="true" className={className} style={{ flexShrink: 0, ...style }}>
      <defs>
        <path id={id} d="M22 74a52 52 0 1 1 104 0a52 52 0 1 1-104 0" />
      </defs>
      <circle cx="74" cy="74" r="71" fill="var(--verdigris-tint)" />
      <circle cx="74" cy="74" r="65" fill="none" strokeWidth={fine ? 1.5 : 2} stroke="var(--verdigris)" />
      <circle cx="74" cy="74" r="38" fill="none" strokeWidth={fine ? 1 : 1.4} stroke="var(--verdigris)" opacity=".45" />
      <text fill="var(--verdigris)" style={{ fontFamily: "var(--font-sans)", fontSize: fine ? 10.5 : 12, fontWeight: 600, letterSpacing: fine ? ".18em" : ".14em" }}>
        <textPath href={`#${id}`} textLength="318" lengthAdjust="spacing">
          VERIFIED · IN SECURE HARDWARE ·{" "}
        </textPath>
      </text>
      <g transform="translate(54.8 54.8) scale(1.6)" fill="none" strokeWidth={fine ? 1.3 : 1.6} strokeLinecap="round" strokeLinejoin="round" stroke="var(--verdigris)">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
        <path d="m9 12 2 2 4-4" />
      </g>
    </svg>
  );
}

// ---------- download, windows, headers and footers ----------

/**
 * "Download for Mac": the one primary action, in the header, the landing hero and its close.
 * It goes to DOWNLOAD_URL once a signed build is published, and to the Install page until then.
 * `note` adds the mono line under it (hero and close only).
 */
export function DownloadCta({ size = "lg", note, className }: { size?: "sm" | "lg"; note?: boolean; className?: string }) {
  const button = (
    <a href={DOWNLOAD_HREF} className={`${s.cta} ${size === "sm" ? s.ctaSm : s.ctaLg} press${note ? "" : className ? ` ${className}` : ""}`}>
      <Icon name="download" size={size === "sm" ? 14 : 17} stroke={2.2} />
      {size === "sm" ? (
        <>
          <span className={s.ctaLong}>Download for Mac</span>
          <span className={s.ctaShort}>Download</span>
        </>
      ) : (
        "Download for Mac"
      )}
    </a>
  );
  if (!note) return button;
  return (
    <span className={`${s.ctaBlock}${className ? ` ${className}` : ""}`}>
      {button}
      <span className={s.ctaNote}>{DOWNLOAD_NOTE}</span>
    </span>
  );
}

/** A plain macOS window frame around a screen of the app: three neutral dots and a centred title. */
export function AppWindow({ title = "Aftercall", children, className, style, bodyClassName }: { title?: string; children: ReactNode; className?: string; style?: CSSProperties; bodyClassName?: string }) {
  return (
    <div className={`${s.window}${className ? ` ${className}` : ""}`} style={style}>
      <div className={s.windowBar} aria-hidden="true">
        <span className={s.windowDots}>
          <i />
          <i />
          <i />
        </span>
        <span className={s.windowTitle}>{title}</span>
      </div>
      <div className={`${s.windowBody}${bodyClassName ? ` ${bodyClassName}` : ""}`}>{children}</div>
    </div>
  );
}

type Current = "how" | "handling" | "verify" | "download" | null;

/**
 * The site header on the landing, How it works, Call handling, Verify and Install pages:
 * three links and Download for Mac. Below 900 px the links fold into a Menu; below 600 px
 * the button goes too (the page carries it).
 */
export function SiteHeader({ current = null }: { current?: Current }) {
  const here = (page: Current) => (current === page ? { "aria-current": "page" as const } : {});
  const links = (
    <>
      <a href="/how-it-works" className="quiet" {...here("how")}>
        How it works
      </a>
      <a href="/handling" className="quiet" {...here("handling")}>
        Call handling
      </a>
      <a href="/verify" className="quiet" {...here("verify")}>
        Verify a proof
      </a>
    </>
  );
  return (
    <header className={s.headerWrap}>
      <div className={`${s.gutter} ${s.headerGutter}`}>
        <div className={s.header}>
          <a href="/" className={s.brand} aria-label="Aftercall, home">
            <Logo size={26} />
            <span className={s.brandName}>Aftercall</span>
          </a>
          <nav aria-label="Site" className={s.nav}>
            {links}
          </nav>
          <div className={s.headerEnd}>
            <HeaderMenu>
              {links}
              <a href="/download" className="quiet" {...here("download")}>
                Install
              </a>
              {REPO_PUBLIC ? (
                <a href={REPO_URL} className={`quiet ${s.navExternal}`}>
                  GitHub
                  <Icon name="external" size={12} />
                </a>
              ) : null}
            </HeaderMenu>
            <DownloadCta size="sm" className={s.headerCta} />
          </div>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className={s.gutter} style={{ paddingTop: 32 }}>
      <div className={s.footer}>
        <span className="ink-2">Aftercall · built on NEAR AI Cloud and NEAR</span>
        <nav aria-label="Footer" className={s.footerNav}>
          <a href="/how-it-works" className="quiet">
            How it works
          </a>
          <a href="/handling" className="quiet">
            How a call is handled
          </a>
          <a href={REPO_PUBLIC ? `${REPO_URL}/blob/main/docs/privacy.md` : "/handling"} className="quiet">
            Privacy
          </a>
          <a href="/verify" className="quiet">
            Verify a proof
          </a>
          <a href="/download" className="quiet">
            Install
          </a>
          {REPO_PUBLIC ? (
            <a href={REPO_URL} className="quiet">
              GitHub
            </a>
          ) : null}
        </nav>
      </div>
    </footer>
  );
}

/** The compact header on pages opened from a link: the mark, and what this page is about on the right. */
export function AppHeader({ width, tag }: { width: number; tag?: ReactNode }) {
  return (
    <header className={s.appHeader}>
      <div className={s.appHeaderInner} style={{ maxWidth: width }}>
        <a href="/" className={s.appBrand} aria-label="Aftercall, home">
          <Logo size={24} />
          <span className={s.appBrandName}>Aftercall</span>
        </a>
        {tag ? <span className={s.appTag}>{tag}</span> : null}
      </div>
    </header>
  );
}
