import { cx } from "./cx";

/**
 * A turning ring. It keeps turning under reduced motion: it says something is
 * happening. `tone="current"` follows the text colour (inside a filled button).
 * Decorative unless given a `label`.
 */
export function Spinner({ size = 14, tone = "verdigris", label, className }: { size?: number; tone?: "verdigris" | "current"; label?: string; className?: string }) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx("inline-block shrink-0 rounded-full border-2", tone === "current" ? "border-current/30 border-t-current" : "border-hairline border-t-verdigris", className)}
      style={{ width: size, height: size, animation: "ac-spin 0.9s linear infinite" }}
    />
  );
}
