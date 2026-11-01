import type { ReactNode } from "react";
import * as m from "motion/react-m";
import { cx } from "./cx";
import { springs } from "./motion";

/**
 * An on/off switch (role="switch") whose thumb springs across. With a `label`, the
 * whole row is the switch, as in Settings; without one, pass an aria-label.
 */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  /** One line under the label, usually what the current state means. */
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const track = (
    <span aria-hidden="true" className={cx("relative inline-block h-6 w-10 shrink-0 rounded-full transition-colors duration-[160ms] ease-calm", checked ? "bg-verdigris" : "bg-border")}>
      <m.span
        className="absolute top-[3px] left-[3px] size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
        initial={false}
        animate={{ x: checked ? 16 : 0 }}
        transition={springs.snappy}
      />
    </span>
  );
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "press disabled:cursor-not-allowed disabled:opacity-40",
        label ? "flex w-full items-center justify-between gap-3 rounded-md bg-elevated px-3.5 py-3 text-left shadow-1" : "inline-flex rounded-full",
        className,
      )}
    >
      {label ? (
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold text-ink">{label}</span>
          {description && <span className="text-[13px] leading-[18px] text-ink-2">{description}</span>}
        </span>
      ) : null}
      {track}
    </button>
  );
}
