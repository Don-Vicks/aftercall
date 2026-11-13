import { AppWindow, DownloadCta, vars } from "../ui";
import l from "../landing.module.css";
import { ApproveDemo } from "./ApproveDemo";
import { Check, Glyph, Shot, MEETING_COL_SIZES } from "./bits";
import { Moment } from "./motion";

/*
 * Section 1. The outcome first (notes that follow through), privacy as the qualifier, who
 * it's for, one button. Beside it the product doing the thing: the Sync with Ada notes and
 * the payment they proposed, which plays moment 3 when it's in view (the quote highlights,
 * Heard → 50.00 USDC, Approve, "Paying in 5…", Paid). Under the button, the Verified seal
 * row plays moment 4. On a phone the payment card comes straight after the button.
 */

/** Check counts: packages/core/src/tee/checks.ts, nvidia.ts and pipeline.ts, one node per model. */
const GROUPS: [string, number][] = [
  ["Gateway", 7],
  ["Whisper", 9],
  ["Qwen", 9],
  ["On the reply", 5],
];

export function Hero() {
  return (
    <section id="top" aria-labelledby="hero-h" className={l.hero}>
      <div className={`${l.wrap} ${l.heroGrid}`}>
        <div className={l.heroCopy}>
          <p className={`${l.eyebrow} ${l.load}`} style={vars({ ld: "0ms" })}>
            For Mac · No bot joins your call
          </p>
          <h1 id="hero-h" className={`${l.display} ${l.load} ${l.loadRise}`} style={vars({ ld: "40ms" })}>
            Meeting notes that follow&nbsp;through.
          </h1>
          <p className={`${l.heroLead} ${l.load}`} style={vars({ ld: "120ms" })}>
            Notes apps send your calls to servers you can&apos;t check, and the follow-ups still wait on you. Aftercall records on your Mac and makes the notes in secure hardware it checks
            first. Then it drafts the recap and, once you approve, pays what was agreed, within caps a NEAR contract enforces.
          </p>
          <p className={`${l.heroWho} ${l.load}`} style={vars({ ld: "150ms" })}>
            For founders and freelancers who agree work and payments on calls.
          </p>
          <div id="hero-cta" className={`${l.ctaRow} ${l.load}`} style={vars({ ld: "180ms" })}>
            <DownloadCta note />
            <a href="#story" className={l.secondary}>
              See one call, start to finish
              <Glyph name="arrow" size={16} />
            </a>
            <a href="/proof" className={l.secondary}>
              What has run on NEAR testnet
              <Glyph name="arrow" size={16} />
            </a>
          </div>
        </div>

        <Moment className={`${l.heroTrust} ${l.load}`} style={vars({ ld: "320ms" })} threshold={0.6} role="group" aria-labelledby="trust-h">
          <SealMark size={56} />
          <div className={l.trustText}>
            <p id="trust-h" className={l.trustTitle}>
              Verified in secure hardware, every run
            </p>
            <ul className={l.trustChips} aria-label="Checks, with one node per model">
              {GROUPS.map(([name, n], i) => (
                <li key={name} style={vars({ i })}>
                  <Check size={14} i={i} />
                  {name} <span className={l.mono}>{n}</span>
                </li>
              ))}
            </ul>
            <p className={l.trustSub}>25 checks before anything is sent and 5 on the reply, with one node per model.</p>
            <p className={l.trustCaveat}>Audio goes to NEAR AI over TLS and isn&apos;t end-to-end encrypted. The transcript is, or it isn&apos;t sent.</p>
          </div>
        </Moment>

        <div className={l.heroStage}>
          <div className={`${l.heroWindowWrap} ${l.load} ${l.loadWindow}`} style={vars({ ld: "220ms" })}>
            <AppWindow className={l.heroWindow} bodyClassName={l.heroWindowBody}>
              <Shot
                name="meeting-col"
                w={632}
                h={796}
                eager
                sizes={MEETING_COL_SIZES}
                alt="Aftercall's notes for Sync with Ada, marked Verified: Ada and Victor agreed the API fix ships before Friday's demo; Victor sends Ada a recap today and pays the designer a 50 USDC deposit to refresh the deck."
              />
            </AppWindow>
          </div>
          <Moment className={`${l.heroPay} ${l.load} ${l.loadSlide}`} style={vars({ ld: "420ms" })} threshold={0.5} role="group" aria-label="The payment the meeting proposed: Pay Designer 50.00 USDC">
            <ApproveDemo className={l.heroApprove} />
          </Moment>
          <p className={`${l.caption} ${l.heroCaption}`}>The Mac app on its built-in sample meeting. The payment card is drawn from the app&apos;s own; payments in the sample are simulated.</p>
        </div>
      </div>
    </section>
  );
}

/** The Verified seal, with its ring separate so it can turn on its own. */
export function SealMark({ size = 44, id = "seal-hero", className }: { size?: number; id?: string; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 148 148" className={`${l.seal}${className ? ` ${className}` : ""}`} role="img" aria-label="Verified">
      <defs>
        <path id={id} d="M22 74a52 52 0 1 1 104 0a52 52 0 1 1-104 0" />
      </defs>
      <circle cx="74" cy="74" r="71" fill="var(--verdigris-tint)" />
      <g className={l.sealRing}>
        <circle cx="74" cy="74" r="65" fill="none" strokeWidth="2.5" stroke="var(--verdigris)" />
        <text fill="var(--verdigris)" style={{ fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, letterSpacing: ".14em" }}>
          <textPath href={`#${id}`} textLength="318" lengthAdjust="spacing">
            VERIFIED · IN SECURE HARDWARE ·{" "}
          </textPath>
        </text>
      </g>
      <g transform="translate(54.8 54.8) scale(1.6)" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="var(--verdigris)">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
        <path d="m9 12 2 2 4-4" />
      </g>
    </svg>
  );
}
