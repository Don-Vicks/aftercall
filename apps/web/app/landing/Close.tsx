import Image from "next/image";
import { REPO_PUBLIC } from "../site";
import { DownloadCta, REPO_URL, vars } from "../ui";
import l from "../landing.module.css";
import { SealMark } from "./Hero";

/* Section 8: the three beats of the product, once more, and one confident ask. */
export function Close() {
  return (
    <section id="get" aria-labelledby="get-h" className={l.close}>
      <div className={l.closeInner}>
        <div className={l.icon} data-reveal="">
          <Image src="/landing/app-icon.png" width={88} height={88} loading="lazy" alt="The Aftercall app icon" />
        </div>
        <h2 id="get-h" className={l.closeTitle} data-reveal="" style={vars({ rd: "60ms" })}>
          Your next call, private and followed up.
        </h2>
        <ol className={l.beats} data-reveal="" style={vars({ rd: "120ms" })}>
          <li>
            <span className={l.beatGlyph} aria-hidden="true">
              <i className={`${l.recDot} ${l.beatDot}`} />
            </span>
            <span>
              <b>Record, with no bot</b>
              <span>Both sides, on your Mac</span>
            </span>
          </li>
          <li>
            <span className={l.beatGlyph} aria-hidden="true">
              <SealMark size={30} id="seal-close" />
            </span>
            <span>
              <b>Notes, checked first</b>
              <span>In secure hardware on NEAR AI</span>
            </span>
          </li>
          <li>
            <span className={l.beatGlyph} aria-hidden="true">
              <span className={l.beatPaid}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Paid
              </span>
            </span>
            <span>
              <b>Recap and payment</b>
              <span>Once you approve, within your caps</span>
            </span>
          </li>
        </ol>
        <div className={l.closeCta} data-reveal="" style={vars({ rd: "180ms" })}>
          <DownloadCta note />
          {REPO_PUBLIC ? (
            <a href={REPO_URL} className={l.secondary}>
              Read the source <span aria-hidden="true">↗</span>
            </a>
          ) : null}
        </div>
        <p className={l.closeMeta} data-reveal="" style={vars({ rd: "240ms" })}>
          MIT licence · Mac only, macOS 14.2 or later · Built for NEAR HACKATHON, November 2026
        </p>
      </div>
    </section>
  );
}
