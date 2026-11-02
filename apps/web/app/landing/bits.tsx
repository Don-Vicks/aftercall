import { getImageProps } from "next/image";
import type { CSSProperties, ReactNode } from "react";
import { vars } from "../ui";
import l from "../landing.module.css";

/**
 * A real screen of the Mac app, light and dark (`/landing/<name>-light|dark.webp`), sized
 * in CSS px (the files are 2x). Dark is the default, as in the tokens. `phone` swaps in a
 * narrower crop below 768 px.
 */
export function Shot({
  name,
  w,
  h,
  alt,
  sizes,
  eager,
  lazy,
  phone,
  className,
  style,
}: {
  name: string;
  w: number;
  h: number;
  alt: string;
  sizes: string;
  eager?: boolean;
  /** Below the fold (the feature tabs): load when near the viewport. */
  lazy?: boolean;
  phone?: { name: string; w: number; h: number; sizes: string };
  className?: string;
  style?: CSSProperties;
}) {
  // Screens load with the page unless marked lazy; only the hero's is fetched at high priority.
  // The alt text is in the HTML either way.
  const loading = lazy ? ("lazy" as const) : ("eager" as const);
  const base = { alt, sizes, loading, ...(eager ? { fetchPriority: "high" as const } : { fetchPriority: "low" as const }) };
  const dark = getImageProps({ ...base, src: `/landing/${name}-dark.webp`, width: w, height: h }).props;
  const light = getImageProps({ ...base, src: `/landing/${name}-light.webp`, width: w, height: h }).props;
  const p = phone
    ? {
        dark: getImageProps({ alt, loading, sizes: phone.sizes, src: `/landing/${phone.name}-dark.webp`, width: phone.w, height: phone.h }).props,
        light: getImageProps({ alt, loading, sizes: phone.sizes, src: `/landing/${phone.name}-light.webp`, width: phone.w, height: phone.h }).props,
      }
    : null;
  return (
    <picture className={`${l.shot}${className ? ` ${className}` : ""}`} style={style}>
      {p ? <source media="(max-width: 767px) and (prefers-color-scheme: light)" srcSet={p.light.srcSet} sizes={phone!.sizes} width={phone!.w} height={phone!.h} /> : null}
      {p ? <source media="(max-width: 767px)" srcSet={p.dark.srcSet} sizes={phone!.sizes} width={phone!.w} height={phone!.h} /> : null}
      <source media="(prefers-color-scheme: light)" srcSet={light.srcSet} sizes={sizes} />
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img {...dark} />
    </picture>
  );
}

/** The one repeated template: "02 · In the call", the H2, and the lead beside it. */
export function SectionHead({ index, eyebrow, id, title, lead, children }: { index: string; eyebrow: string; id: string; title: ReactNode; lead: ReactNode; children?: ReactNode }) {
  return (
    <div className={l.head}>
      <div className={l.headMain}>
        <p className={l.eyebrow} data-reveal="">
          <span className={l.eyebrowIndex}>{index}</span> · {eyebrow}
        </p>
        <h2 id={id} className={l.h2} data-reveal="" style={vars({ rd: "40ms" })}>
          {title}
        </h2>
      </div>
      <div className={l.headLead} data-reveal="" style={vars({ rd: "100ms" })}>
        <p className={l.lead}>{lead}</p>
        {children}
      </div>
    </div>
  );
}

export { Caption, Check, Face, Glyph, Key, MEETING_COL_SIZES, Said, cssVars } from "./atoms";
