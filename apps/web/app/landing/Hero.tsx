import { AppWindow, DownloadCta, vars } from "../ui";
import l from "../landing.module.css";
import { Caption, Check, Face, Glyph, Said, Shot } from "./bits";

/*
 * Section 1. Category and reason in five seconds, then the product's own output at
 * full width: the Sync with Ada meeting, the checks receipt (moment 4) and the
 * payment card the meeting proposed. Plays once on load, in CSS, then stays still.
 */

/** Check labels and counts: packages/core/src/tee/checks.ts, nvidia.ts and pipeline.ts. */
const BEFORE: [string, number][] = [
  ["Gateway TEE", 6],
  ["Whisper TEE", 9],
  ["Qwen TEE", 9],
];
const REPLY: [string, number][] = [
  ["Transcript end-to-end encrypted to the checked model", 1],
  ["Reply signed by that TEE, over the exact request and reply", 4],
];

export function Hero() {
  return (
    <section id="top" aria-labelledby="hero-h" className={l.hero}>
      <div className={l.wrap}>
        <div className={l.heroText}>
          <p className={`${l.eyebrow} ${l.load}`} style={vars({ ld: "0ms" })}>
            Meeting notes for Mac · Built for NEAR HACKATHON
          </p>
          <h1 id="hero-h" className={`${l.display} ${l.load} ${l.loadRise}`} style={vars({ ld: "40ms" })}>
            Private meeting notes <span className={l.nobr}>you can check.</span>
          </h1>
          <p className={`${l.heroLead} ${l.load}`} style={vars({ ld: "120ms" })}>
            Aftercall records your calls on your Mac and makes the notes inside NEAR AI&apos;s secure hardware, which it checks before anything is sent. Then it does what the meeting agreed: the recap goes out
            and the payment is made, after your approval and within caps a NEAR contract enforces.
          </p>
          <div className={`${l.ctaRow} ${l.load}`} style={vars({ ld: "180ms" })}>
            <DownloadCta note />
            <a href="#story" className={l.secondary}>
              See one call, start to finish
              <Glyph name="arrow" size={16} />
            </a>
          </div>
        </div>

        <figure className={l.heroStage}>
          <div className={l.heroBox}>
          <div className={`${l.heroWindowWrap} ${l.load} ${l.loadWindow}`} style={vars({ ld: "260ms" })}>
            <AppWindow className={l.heroWindow}>
              <Shot
                name="meeting"
                w={1280}
                h={820}
                eager
                sizes="(max-width: 767px) 358px, (max-width: 1240px) 92vw, 1112px"
                phone={{ name: "meeting-col", w: 632, h: 796, sizes: "92vw" }}
                alt="Aftercall's meeting page for Sync with Ada: summary, your notes, two decisions and three action items, one claimed by Claude Code, marked Verified."
              />
            </AppWindow>
          </div>
          <Receipt />
          <PaymentCard />
          </div>
          <Caption className={l.heroCaption}>The Mac app on its built-in sample meeting. The receipt and payment card are drawn from the app&apos;s own components.</Caption>
        </figure>
      </div>
    </section>
  );
}

/** Moment 4: rows tick in 90 ms apart, the totals fade in, and it ends on the Verified seal. */
function Receipt() {
  let i = 0;
  return (
    <div className={`${l.receipt} ${l.load}`} style={vars({ ld: "600ms" })} aria-labelledby="receipt-h" role="group">
      <div className={l.receiptHead}>
        <SealMark />
        <div>
          <p id="receipt-h" className={l.receiptTitle}>
            Checked on your Mac
          </p>
          <p className={l.receiptSub}>Every run · against a fresh nonce</p>
        </div>
      </div>
      <ul className={l.receiptRows}>
        {BEFORE.map(([label, n]) => {
          const k = i++;
          return (
            <li key={label} className={l.receiptRow} style={vars({ i: k })}>
              <Check i={k} />
              <span>{label}</span>
              <span className={l.receiptN}>{n}</span>
            </li>
          );
        })}
        <li className={l.receiptTotal} style={vars({ i: i - 1 })}>
          24 checks before anything is sent
        </li>
        {REPLY.map(([label, n]) => {
          const k = i++;
          return (
            <li key={label} className={l.receiptRow} style={vars({ i: k })}>
              <Check i={k} />
              <span>{label}</span>
              <span className={l.receiptN}>{n}</span>
            </li>
          );
        })}
        <li className={l.receiptTotal} style={vars({ i: i - 1 })}>
          5 on the signed reply
        </li>
      </ul>
      <div className={l.receiptFoot}>
        <p>Counts with one node per model. Ran live on NEAR AI Cloud once, 1 Nov 2026: every check passed.</p>
        <p>Audio goes to NEAR AI over TLS through the checked gateway; it isn&apos;t end-to-end encrypted. The transcript is, or it isn&apos;t sent.</p>
      </div>
    </div>
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

/** The payment the meeting proposed, as the app's follow-up card shows it before you approve. */
function PaymentCard() {
  return (
    <div className={`${l.payCard} ${l.load} ${l.loadSlide}`} style={vars({ ld: "520ms" })} role="group" aria-label="Proposed payment: Pay Designer 50.00 USDC">
      <div className={l.payHead}>
        <Face who="D" size={36} hue={5} />
        <div className={l.payWho}>
          <p className={l.payTitle}>Pay Designer</p>
          <p className={l.payAcct}>designer.near</p>
        </div>
        <p className={l.payAmount}>
          50.00 <span>USDC</span>
        </p>
      </div>
      <Said at="02:14" className={l.paySaid}>
        pay the designer the <mark className={l.sweep}>fifty dollar</mark> deposit today
      </Said>
      <dl className={l.payWell}>
        <div>
          <dt>Heard</dt>
          <dd>
            <q className={l.serifQ}>fifty dollar</q> → <span className={l.mono}>50.00 USDC</span>
          </dd>
        </div>
        <div>
          <dt>Payee</dt>
          <dd>
            Designer <span className={l.accent}>· on your list</span>
          </dd>
        </div>
      </dl>
      <div className={l.payButtons} aria-hidden="true">
        <span className={l.btnQuiet}>Dismiss</span>
        <span className={l.btnOutline}>Edit amount</span>
        <span className={l.btnPrimary}>Approve payment</span>
      </div>
    </div>
  );
}
