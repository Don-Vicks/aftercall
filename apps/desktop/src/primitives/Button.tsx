import type { ComponentPropsWithRef, ReactNode } from "react";
import { cx } from "./cx";
import { Spinner } from "./Spinner";
import { Tooltip } from "./Tooltip";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "quiet" | "danger" | "record";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  /** The one main action on a screen. */
  primary: "bg-verdigris text-on-verdigris hover:bg-verdigris-hover",
  secondary: "border border-border text-ink hover:bg-elevated",
  /** Cancel and other low-key actions; a soft fill under the pointer. */
  ghost: "text-ink-2 hover:bg-elevated hover:text-ink",
  /** Text only, as Dismiss on a row. */
  quiet: "text-ink-2 hover:text-ink",
  /** Deletes and resets. */
  danger: "bg-record-tint text-record shadow-[inset_0_0_0_1px_var(--record)] hover:bg-[color-mix(in_srgb,var(--record)_16%,var(--record-tint))]",
  /** Start and Stop recording only. */
  record: "bg-record text-white hover:bg-[color-mix(in_srgb,var(--record)_86%,var(--ink))]",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-sm px-3 text-[13px]",
  md: "h-9 gap-2 rounded-sm px-4",
  lg: "h-11 gap-2 rounded-[10px] px-5 text-[15px]",
};

export type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner in place of the icon and ignores clicks, with aria-busy. */
  loading?: boolean;
  /** Leading icon (lucide at 14–16px). */
  icon?: ReactNode;
};

/** Dips to 0.97 when pressed (the `.press` class in styles.css). */
export function Button({ variant = "secondary", size = "md", loading = false, icon, className, children, onClick, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      {...props}
      aria-busy={loading || undefined}
      aria-disabled={loading || props["aria-disabled"] || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      className={cx(
        "press inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40 aria-busy:cursor-progress",
        sizes[size],
        variants[variant],
        className,
      )}
    >
      {loading ? <Spinner size={size === "lg" ? 14 : 12} tone="current" /> : icon}
      {children}
    </button>
  );
}

export type IconButtonProps = Omit<ComponentPropsWithRef<"button">, "aria-label"> & {
  /** Required: it is the button's only name, and the tooltip's text. */
  "aria-label": string;
  variant?: "ghost" | "quiet" | "secondary" | "primary";
  size?: "sm" | "md";
  /** Tooltip text when it should differ from the label; false for none. */
  tooltip?: ReactNode | false;
  shortcut?: string;
  tooltipSide?: "top" | "bottom";
};

/** A square button with only an icon as its child. Always named, always with a tooltip. */
export function IconButton({ variant = "ghost", size = "md", tooltip, shortcut, tooltipSide, className, children, type = "button", ...props }: IconButtonProps) {
  const button = (
    <button
      type={type}
      {...props}
      className={cx(
        "press inline-flex shrink-0 items-center justify-center rounded-sm disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "size-7" : "size-8",
        variant === "ghost" ? "text-ink-2 hover:bg-elevated hover:text-ink" : variant === "quiet" ? "text-muted hover:text-ink" : variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
  if (tooltip === false) return button;
  return (
    <Tooltip content={tooltip ?? props["aria-label"]} shortcut={shortcut} side={tooltipSide}>
      {button}
    </Tooltip>
  );
}
