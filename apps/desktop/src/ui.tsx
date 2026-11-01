import type { ReactNode } from "react";

// The v2 primitives live in ./primitives; screens keep importing them from here.
export * from "./primitives";

/** The old uppercase section label. New screens use SectionTitle (sentence case, with a count). */
export function SectionLabel({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="t-label m-0 text-muted">
      {children}
    </h2>
  );
}
