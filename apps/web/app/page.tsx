import { SiteFooter, SiteHeader } from "./ui";
import l from "./landing.module.css";
import { Cant } from "./landing/Cant";
import { Close } from "./landing/Close";
import { Features } from "./landing/Features";
import { Hero } from "./landing/Hero";
import { InCall } from "./landing/InCall";
import { Money } from "./landing/Money";
import { MotionRoot } from "./landing/motion";
import { Proof } from "./landing/Proof";
import { Story } from "./landing/Story";

/*
 * The landing page. Every claim stays inside README.md; the sample world is the app's own
 * (apps/desktop/src/sample.ts: Sync with Ada, Fundraise, the 50 USDC deposit to the
 * designer and the blocked 5,000 USDC payment). Pictures are real screens of the Mac
 * app's interface on that sample; the moving parts are drawn from its components.
 * Everything is server-rendered finished; motion (landing/motion.tsx) is opt-in.
 */

export const metadata = {
  title: "Aftercall · Meeting notes that follow through",
  description:
    "A Mac app that records your calls with no bot in them, makes the notes in NEAR AI's secure hardware it checks first, then drafts the recap and pays what was agreed, once you approve or by autopilot rules you set, within caps a NEAR contract enforces.",
  openGraph: {
    title: "Aftercall · Meeting notes that follow through",
    description: "Meeting notes for Mac, made in secure hardware your Mac checks first. Then the recap and the agreed payment, once you approve or by autopilot rules you set, within caps a NEAR contract enforces.",
    images: [{ url: "/landing/og.png", width: 1200, height: 630, alt: "Aftercall: meeting notes that follow through." }],
  },
};

export default function Landing() {
  return (
    <div className={l.page}>
      <a href="#main" className={l.skip}>
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        <Hero />
        <InCall />
        <Story />
        <Features />
        <Money />
        <Cant />
        <Proof />
        <Close />
      </main>
      <SiteFooter />
      <MotionRoot />
    </div>
  );
}
