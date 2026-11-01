import type { ComponentPropsWithRef, ElementType } from "react";
import { cx } from "./cx";

const tones = {
  default: "bg-elevated shadow-1",
  /** A person must look: blocked payments, consent. */
  caution: "bg-caution-tint",
  /** Recording and Failed only. */
  record: "bg-record-tint",
};

const pads = { none: "", sm: "px-4 py-3.5", md: "px-5 py-4", lg: "p-6" };

export type CardProps = ComponentPropsWithRef<"div"> & {
  /** The element to render: a button or link for a card you click as a whole. */
  as?: ElementType;
  href?: string;
  /** Lifts to shadow-2 under the pointer and dips when pressed. */
  interactive?: boolean;
  tone?: keyof typeof tones;
  pad?: keyof typeof pads;
};

/** A card you act on: elevated, radius 14, shadow-1 at rest. Never nest one card in another. */
export function Card({ as: Tag = "div", interactive, tone = "default", pad = "md", className, ...props }: CardProps) {
  return (
    <Tag
      {...(Tag === "button" ? { type: "button" } : null)}
      {...props}
      className={cx("block rounded-md text-left text-ink", tones[tone], pads[pad], interactive && "lift press cursor-pointer", className)}
    />
  );
}
