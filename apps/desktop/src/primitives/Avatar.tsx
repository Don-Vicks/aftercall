import { createContext, useContext, type ReactNode } from "react";
import { initials, isYou, personHue } from "@aftercall/core";
import { cx } from "./cx";

/** The surface behind an avatar, which its 2px ring is cut from. */
export type Surface = "ground" | "raised" | "elevated" | "well";

const MeContext = createContext<readonly string[]>([]);

/** Names, emails or NEAR accounts that mean "you" to every Avatar below. */
export function MeProvider({ me, children }: { me: readonly string[]; children: ReactNode }) {
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

/** Whether a name is the person using the app, by MeProvider's names. */
export function useIsYou(): (name: string) => boolean {
  const me = useContext(MeContext);
  return (name) => isYou(name, me);
}

/**
 * Initials on the person's colour (from a hash of their name, so it never changes).
 * You are always "You" on verdigris-tint. Sizes 20–64.
 */
export function Avatar({
  name,
  size = 28,
  you,
  ring,
  decorative,
  className,
}: {
  name: string;
  size?: number;
  /** Overrides the MeProvider match. */
  you?: boolean;
  /** Cuts a 2px ring of this surface around it (for stacks and overlaps). */
  ring?: Surface;
  /** Hidden from screen readers when the name is already written next to it. */
  decorative?: boolean;
  className?: string;
}) {
  const me = useContext(MeContext);
  const self = you ?? isYou(name, me);
  const px = Math.min(64, Math.max(20, size));
  const hue = personHue(name);
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : self ? "You" : name}
      aria-hidden={decorative || undefined}
      className={cx("inline-flex shrink-0 items-center justify-center rounded-full leading-none font-semibold", className)}
      style={{
        width: px,
        height: px,
        fontSize: Math.max(9, Math.round(px * (self ? 0.31 : 0.39))),
        background: self ? "var(--verdigris-tint)" : `var(--p${hue})`,
        color: self ? "var(--verdigris)" : `var(--p${hue}i)`,
        boxShadow: ring ? `0 0 0 2px var(--${ring})` : undefined,
      }}
    >
      {self ? "You" : initials(name)}
    </span>
  );
}

/** "Ada, Ines and Theo", or "Ada, Ines, Theo and 2 more". */
function peopleLabel(names: string[], extra: number): string {
  if (extra > 0) return `${names.join(", ")} and ${extra} more`;
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Overlapping avatars; past `max`, the rest become "+N". Named as one image. */
export function AvatarStack({ people, max = 3, size = 28, ring = "raised", className }: { people: string[]; max?: number; size?: number; ring?: Surface; className?: string }) {
  const me = useContext(MeContext);
  const shown = people.length > max ? people.slice(0, max) : people;
  const extra = people.length - shown.length;
  const overlap = size >= 32 ? 8 : 6;
  const label = peopleLabel(shown.map((p) => (isYou(p, me) ? "You" : p)), extra);
  return (
    <span role="img" aria-label={label} className={cx("inline-flex items-center", className)}>
      {shown.map((p, i) => (
        // Earlier avatars sit on top, so the next one never covers "You" or initials.
        <span key={`${p}-${i}`} className="relative inline-flex" style={{ marginLeft: i ? -overlap : 0, zIndex: shown.length - i }}>
          <Avatar name={p} size={size} ring={ring} decorative />
        </span>
      ))}
      {extra > 0 && (
        <span
          aria-hidden="true"
          className="inline-flex items-center rounded-full bg-elevated px-[7px] text-[11px] font-semibold text-ink-2"
          style={{ height: size, marginLeft: -overlap, boxShadow: `0 0 0 2px var(--${ring})` }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
