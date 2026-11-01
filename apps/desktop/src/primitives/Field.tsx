import { createContext, useContext, useId, type ComponentPropsWithRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "./cx";

interface FieldInfo {
  id: string;
  describedBy?: string;
  invalid: boolean;
}

const FieldContext = createContext<FieldInfo | null>(null);

/**
 * A label, the control, then an error (record) and a hint (ink-2). Wires the
 * label's htmlFor and the control's aria-describedby and aria-invalid, so the
 * Input, TextArea or Select inside needs no ids.
 */
export function Field({
  label,
  hint,
  error,
  hideLabel,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** Shown in record under the control; also marks it invalid. */
  error?: ReactNode;
  /** Keeps the label for screen readers only. */
  hideLabel?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={cx("text-[13px] leading-[18px] font-semibold text-ink", hideLabel && "sr-only")}>
        {label}
      </label>
      <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error) }}>{children}</FieldContext.Provider>
      {error ? (
        <span id={errorId} aria-live="polite" className="selectable text-[13px] leading-[18px] text-record">
          {error}
        </span>
      ) : null}
      {hint ? (
        <span id={hintId} className="text-[13px] leading-[18px] text-ink-2">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** The id, describedby and invalid state a control takes from its Field, merged with its own. */
function useField(props: { id?: string; "aria-describedby"?: string; "aria-invalid"?: ComponentPropsWithRef<"input">["aria-invalid"] }, invalid?: boolean) {
  const field = useContext(FieldContext);
  const bad = invalid ?? field?.invalid ?? false;
  return {
    id: props.id ?? field?.id,
    "aria-describedby": cx(field?.describedBy, props["aria-describedby"]) || undefined,
    "aria-invalid": bad || props["aria-invalid"] || undefined,
    bad,
  };
}

const control = (bad: boolean, mono?: boolean) =>
  cx(
    "selectable w-full min-w-0 rounded-sm border bg-well px-3 text-ink outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50",
    bad ? "border-record" : "border-border",
    mono ? "font-mono text-[13px]" : "text-[14px]",
  );

type ControlProps = {
  /** Accounts, amounts, hashes: Geist Mono. */
  mono?: boolean;
  /** Marks it invalid without a Field (a Field's error does this for you). */
  invalid?: boolean;
};

export function Input({ mono, invalid, className, ...props }: ComponentPropsWithRef<"input"> & ControlProps) {
  const { bad, ...aria } = useField(props, invalid);
  return <input {...props} {...aria} className={cx(control(bad, mono), "h-9", className)} />;
}

export function TextArea({ mono, invalid, className, rows = 3, ...props }: ComponentPropsWithRef<"textarea"> & ControlProps) {
  const { bad, ...aria } = useField(props, invalid);
  return <textarea rows={rows} {...props} {...aria} className={cx(control(bad, mono), "resize-y py-2 leading-[21px]", className)} />;
}

export function Select({ mono, invalid, className, children, ...props }: ComponentPropsWithRef<"select"> & ControlProps) {
  const { bad, ...aria } = useField(props, invalid);
  return (
    <span className={cx("relative flex", className)}>
      <select {...props} {...aria} className={cx(control(bad, mono), "h-9 appearance-none pr-9")}>
        {children}
      </select>
      <ChevronDown size={14} strokeWidth={2} aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-faint" />
    </span>
  );
}
