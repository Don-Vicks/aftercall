import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type Tone = "verdigris" | "caution" | "record" | "muted";

const pillTones: Record<Tone, string> = {
  verdigris: "bg-verdigris-tint text-verdigris",
  caution: "bg-caution-tint text-caution",
  record: "bg-record-tint text-record",
  muted: "bg-elevated text-muted",
};

/** Status pill. Status colours always come with a word, never alone. */
export function Pill({ tone, children, icon }: { tone: Tone; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={cx("t-label inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-[9px]", pillTones[tone])}>
      {icon}
      {children}
    </span>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-verdigris text-on-verdigris hover:bg-verdigris-hover",
  secondary: "border border-border text-ink hover:bg-elevated",
  ghost: "text-muted hover:text-ink",
  danger: "bg-record-tint text-record shadow-[inset_0_0_0_1px_var(--record)]",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "md" | "lg" }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        size === "md" ? "h-8 px-3.5" : "h-[42px] px-4",
        variants[variant],
        className,
      )}
    />
  );
}

export function SectionLabel({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="t-label m-0 text-muted">
      {children}
    </h2>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-full border-2 border-hairline border-t-verdigris"
      style={{ width: size, height: size, animation: "spin 0.9s linear infinite" }}
    />
  );
}
