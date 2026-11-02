import { useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import * as m from "motion/react-m";
import { cx } from "./cx";
import { springs } from "./motion";
import { LayoutMotion } from "./MotionProvider";
import { RollingNumber } from "./RollingNumber";

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** A muted count after the label. */
  count?: number;
}

/**
 * Tabs with an underline that slides to the selected one (a shared layoutId).
 * Arrow keys, Home and End move and select. Pair each with a <TabPanel> of the
 * same `id` and value.
 */
export function Tabs<T extends string>({
  id,
  label,
  items,
  value,
  onChange,
  className,
}: {
  /** Prefix for the tab and panel ids; unique on the page. */
  id: string;
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const tabs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});
  const go = (i: number) => {
    const t = items[(i + items.length) % items.length];
    onChange(t.id);
    tabs.current[t.id]?.focus();
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const at = items.findIndex((t) => t.id === value);
    if (e.key === "ArrowRight") go(at + 1);
    else if (e.key === "ArrowLeft") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else return;
    e.preventDefault();
  };
  return (
    <LayoutMotion>
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cx("flex gap-6 border-b border-hairline", className)}>
        {items.map((t) => {
          const selected = t.id === value;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${id}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.id)}
              className={cx("relative pt-1 pb-2.5 font-semibold transition-colors duration-(--dur-1)", selected ? "text-ink" : "text-muted hover:text-ink")}
            >
              {t.label}
              {t.count !== undefined && (
                <span className="ml-1.5 font-medium text-muted">
                  <RollingNumber value={t.count} />
                </span>
              )}
              {selected && <m.span layoutId={`${id}-underline`} transition={springs.snappy} aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-ink" />}
            </button>
          );
        })}
      </div>
    </LayoutMotion>
  );
}

/** The content for one tab. Render only the selected one. */
export function TabPanel({ tabsId, value, className, children }: { tabsId: string; value: string; className?: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${tabsId}-panel-${value}`} aria-labelledby={`${tabsId}-tab-${value}`} className={className}>
      {children}
    </div>
  );
}
