import type { ReactNode } from "react";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import { enter } from "./motion";

/**
 * Wraps the app: motion's DOM animations, loaded once, and the system's reduced-motion
 * setting respected (transforms jump, opacity still fades). `strict` makes a stray
 * `motion.*` component throw: use `m.*` from "motion/react-m".
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user" transition={enter}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}

const loadLayout = () => import("./layoutFeatures").then((r) => r.default);

/** Around anything that uses `layout` or `layoutId` (Tabs does this itself). */
export function LayoutMotion({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadLayout} strict>
      {children}
    </LazyMotion>
  );
}
