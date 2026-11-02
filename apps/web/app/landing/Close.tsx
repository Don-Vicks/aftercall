import Image from "next/image";
import { DownloadCta, REPO_URL, vars } from "../ui";
import l from "../landing.module.css";

/* Section 8: one confident ask. */
export function Close() {
  return (
    <section id="get" aria-labelledby="get-h" className={l.close}>
      <div className={l.closeInner}>
        <div className={l.icon} data-reveal="">
          <Image src="/landing/app-icon.png" width={88} height={88} loading="eager" alt="The Aftercall app icon" />
        </div>
        <h2 id="get-h" className={l.closeTitle} data-reveal="" style={vars({ rd: "60ms" })}>
          Your next call, private and followed up.
        </h2>
        <p className={l.closeBody} data-reveal="" style={vars({ rd: "120ms" })}>
          Record it on your Mac. Get notes made in checked secure hardware, a recap in your own Mail, and the agreed payment made within your caps.
        </p>
        <div className={l.closeCta} data-reveal="" style={vars({ rd: "180ms" })}>
          <DownloadCta note />
          <a href={REPO_URL} className={l.secondary}>
            Read the source <span aria-hidden="true">↗</span>
          </a>
        </div>
        <p className={l.closeMeta} data-reveal="" style={vars({ rd: "240ms" })}>
          MIT licence · Built for NEAR HACKATHON, November 2026
        </p>
      </div>
    </section>
  );
}
