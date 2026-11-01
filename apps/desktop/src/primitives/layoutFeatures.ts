import { domMax } from "motion/react";

// Layout animations (layout, layoutId) live in domMax. Loaded on demand by
// <LayoutMotion>, so the app's first bundle carries only domAnimation.
export default domMax;
