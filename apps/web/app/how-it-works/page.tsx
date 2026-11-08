import { NOT_PROVEN } from "@aftercall/core";
import { Icon, OpenCircle, REPO_URL, SiteFooter, SiteHeader, vars } from "../ui";
import { Checks } from "./Checks";
import { Journey } from "./Journey";
import h from "./how.module.css";

export const metadata = {
  title: "How it works · Aftercall",
  description: "How Aftercall keeps your meetings private: the journey of one meeting, the checks it passes, and what it can't prove.",
};

const CODE: [string, string][] = [
  ["packages/core/src/tee/checks.ts", "CPU checks, signature"],
  ["packages/core/src/tee/nvidia.ts", "NVIDIA GPU evidence"],
  ["packages/core/src/tee/e2ee.ts", "Encryption to Qwen"],
  ["packages/core/src/notes/pipeline.ts", "Order, stop on failure"],
  ["packages/core/src/notes/proof.ts", "The proof, its limits"],
  ["apps/desktop/src-tauri/src/attest.rs", "Intel quotes, NRAS"],
  ["docs/privacy.md", "Where every byte goes"],
];

// The same list the Verify page shows, split into its bold lead and the rest.
const LIMITS = NOT_PROVEN.map((n) => {
  const cut = n.indexOf(": ");
  return cut > 0 ? [n.slice(0, cut + 1), n.slice(cut + 2)] : ["", n];
});

/** V2HowItWorks: the privacy story, step by step, with links to the code behind each claim. */
export default function HowItWorks() {
  return (
    <>
      <SiteHeader current="how" />
      <main>
        <section aria-labelledby="hero" className={h.hero}>
          <div className={h.heroInner}>
            <span className={`${h.eyebrow} enter`}>How it works · privacy</span>
            <h1 id="hero" className={`${h.h1} enter`} style={vars({ d: "40ms", dur: "360ms" })}>
              How Aftercall keeps your meetings private
            </h1>
            <p className={`${h.lede} enter`} style={vars({ d: "100ms", dur: "360ms" })}>
              Nothing leaves your Mac until NEAR AI&apos;s secure hardware passes its checks, and only the checked model can read your transcript.
            </p>
          </div>
        </section>

        <section id="journey" aria-labelledby="jt" className={h.journeySection}>
          <Journey />
        </section>

        <section id="checks" aria-labelledby="ct" className={h.section}>
          <div className={`${h.wrap} ${h.checksWrap}`}>
            <div className={h.col} style={{ gap: 8 }}>
              <h2 id="ct" className={h.h2}>
                Checked every time, before it’s sent and when it comes back
              </h2>
              <p className={h.intro}>
                Each recording gets a fresh nonce. Your Mac checks the gateway, Whisper and Qwen against it, then checks the signed reply: 25 checks before anything is sent and 5 on the signed reply, on a typical meeting with one node per model.
              </p>
            </div>
            <Checks />
          </div>
        </section>

        <section id="e2ee" aria-labelledby="et" className={h.section}>
          <div className={`${h.wrap} ${h.two}`}>
            <div className={h.col}>
              <h2 id="et" className={h.h2}>
                End-to-end encrypted summaries
              </h2>
              <p className={h.intro}>The transcript is sealed on your Mac to a key bound in Qwen&apos;s verified quote, so the gateway passes on text it can&apos;t read.</p>
              <div className={h.notice}>
                <Icon name="info" size={18} stroke={1.75} />
                <span>
                  <span style={{ fontWeight: 600 }}>Audio isn&apos;t end-to-end encrypted</span>
                  <span className="ink-2">
                    NEAR AI doesn&apos;t offer it for transcription. Audio goes over TLS pinned to the gateway&apos;s TLS key from its attestation, and transcriptions aren&apos;t signed per response. The Verify sheet says so next to the Whisper checks.
                  </span>
                </span>
              </div>
            </div>
            <ol className={h.numbered}>
              <li>
                <span aria-hidden="true" className={h.num}>
                  1
                </span>
                <span>
                  <span className={h.t}>Your Mac takes the key from a verified quote</span>
                  <span className={h.d}>Qwen&apos;s Ed25519 key has to sit in the report data of a quote that passed every check, next to this run&apos;s nonce.</span>
                </span>
              </li>
              <li>
                <span aria-hidden="true" className={h.num}>
                  2
                </span>
                <span>
                  <span className={h.t}>The transcript is sealed to that key, on your Mac</span>
                  <span className={h.d}>Each message gets a fresh X25519 key pair. The shared secret goes through HKDF-SHA256, then XChaCha20-Poly1305 seals the text.</span>
                  <span className={h.code}>[one-time key 32] [nonce 24] [ciphertext + tag]</span>
                </span>
              </li>
              <li>
                <span aria-hidden="true" className={h.num}>
                  3
                </span>
                <span>
                  <span className={h.t}>The notes come back sealed to your Mac</span>
                  <span className={h.d}>Qwen encrypts its reply to a key pair made for this one request. If end-to-end encryption isn&apos;t available, the transcript isn&apos;t sent: it never goes over TLS instead.</span>
                </span>
              </li>
            </ol>
          </div>
        </section>

        <section id="mac" aria-labelledby="mt" className={h.section}>
          <div className={`${h.wrap} ${h.two}`}>
            <div className={h.col}>
              <h2 id="mt" className={h.h2}>
                On your Mac
              </h2>
              <p className={h.intro}>Audio, transcripts and notes stay in Aftercall&apos;s folder, sealed with a key in your macOS Keychain.</p>
              <div role="img" aria-label="Your Keychain holds three keys: the at-rest key, your NEAR AI key and the app's limited NEAR key" className={`${h.keychain} lift`}>
                <span aria-hidden="true" className={h.keychainHead}>
                  <Icon name="key" size={16} stroke={1.75} className="accent" />
                  <span style={{ fontWeight: 600 }}>Keychain</span>
                  <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
                    on this Mac
                  </span>
                </span>
                <span aria-hidden="true" className={h.keychainBody}>
                  <span className="mono">at-rest key</span>
                  <span className="ink-2">Seals audio, transcripts and notes</span>
                  <span className="mono">NEAR AI key</span>
                  <span className="ink-2">Used from Rust, only to send its own recordings</span>
                  <span className="mono">app key</span>
                  <span className="ink-2">Can only call pay, record_proof, open_escrow and release_escrow</span>
                </span>
              </div>
            </div>
            <dl className={h.rows}>
              <div>
                <dt>Audio</dt>
                <dd>Sealed about once a second as it records, so it&apos;s never on disk unencrypted. Deleted once the notes are saved.</dd>
              </div>
              <div>
                <dt>Transcripts and notes</dt>
                <dd>Sealed with XChaCha20-Poly1305. A changed byte or the wrong key won&apos;t open.</dd>
              </div>
              <div>
                <dt>Stays local</dt>
                <dd>Search, calendar lookups, backups you export, and the server agents use to read meetings. Automatic backups go to iCloud Drive, encrypted, only if you turn them on.</dd>
              </div>
              <div>
                <dt>The limit</dt>
                <dd>This stops other apps, backup and sync tools from reading your meetings. It doesn&apos;t protect a Mac account someone else has taken over.</dd>
              </div>
            </dl>
          </div>
        </section>

        <section id="limits" aria-label="What we can't prove, and how to check it yourself" className={h.section} style={{ paddingBottom: 48 }}>
          <div className={`${h.wrap} ${h.two} ${h.half}`}>
            <div className={h.col}>
              <h2 className={h.h2}>What we can&apos;t prove</h2>
              <p className={h.intro}>Every Verify page lists these under the checks.</p>
              <ul className={h.limits}>
                {LIMITS.map(([lead, rest]) => (
                  <li key={lead}>
                    <OpenCircle />
                    <span>
                      <strong>{lead}</strong> {rest}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className={h.col}>
              <h2 className={h.h2}>Check it yourself</h2>
              <p className={h.intro}>Every claim on this page points to code you can read and run.</p>
              <div className={h.linkRows}>
                <a href="/verify" className={h.linkRow}>
                  <span>
                    <strong>Verify a proof</strong>
                    <span className="ink-2">open a proof link from the app to re-run its checks</span>
                  </span>
                  <Icon name="arrowRight" size={16} stroke={2.2} />
                </a>
                <a href="/handling" className={h.linkRow}>
                  <span>
                    <strong>How a call is handled</strong>
                    <span className="ink-2">each step, and the recap footer</span>
                  </span>
                  <Icon name="arrowRight" size={16} stroke={2.2} />
                </a>
                <a href={`${REPO_URL}/blob/main/docs/proven.md`} className={h.linkRow}>
                  <span>
                    <strong>“What is proven” in the repo</strong>
                    <span className="ink-2">each claim and its test</span>
                  </span>
                  <Icon name="external" size={16} />
                </a>
              </div>
              <dl aria-label="Where the code is" className={h.where}>
                {CODE.map(([path, what]) => (
                  <div key={path} style={{ display: "contents" }}>
                    <dt>
                      <a href={`${REPO_URL}/blob/main/${path}`} className="quiet">
                        {path}
                      </a>
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
                <dt className="accent">pnpm sample:notes</dt>
                <dd>Every check, on a sample call</dd>
              </dl>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
