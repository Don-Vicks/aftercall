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
  title: "Aftercall · Private meeting notes you can check",
  description:
    "A Mac app that makes private notes of your calls inside NEAR AI's checked secure hardware, then sends the recap and pays what was agreed, after your approval and within caps a NEAR contract enforces.",
  openGraph: {
    title: "Aftercall · Private meeting notes you can check",
    description: "Meeting notes for Mac, made inside NEAR AI's secure hardware that your Mac checks first. Then the recap and the agreed payment, within caps a NEAR contract enforces.",
    images: [{ url: "/landing/og.png", width: 1200, height: 630, alt: "Aftercall: private meeting notes you can check." }],
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
        <Cant />
        <Proof />
        <Money />
        <Close />
      </main>
      <SiteFooter />
      <MotionRoot />
    </div>
  );
}
