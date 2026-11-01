import { NOT_PROVEN, WHISPER_NOTE, recapFooter } from "@aftercall/core";
import { Icon, OpenCircle, SiteFooter, SiteHeader, vars, type IconName } from "../ui";
import c from "./handling.module.css";

export const metadata = {
  title: "How a call is handled · Aftercall",
  description: "What happens to a call Aftercall records, step by step: where the audio and transcript go, what is checked, what the recap footer means, and what isn't proven.",
};

type Where = "mac" | "tee" | "near";
const WHERE: Record<Where, { label: string; icon: IconName }> = {
  mac: { label: "On the Mac", icon: "laptop" },
  tee: { label: "NEAR AI TEE", icon: "shieldCheck" },
  near: { label: "On NEAR", icon: "chain" },
};

/** The steps as apps/desktop/src/RecordingScreen.tsx and packages/core/src/notes/pipeline.ts run them. */
const STEPS: { where: Where; title: string; body: string; travels?: string }[] = [
  {
    where: "mac",
    title: "The person recording tells everyone",
    body: "Before recording, the app asks them to confirm they told everyone on the call. That statement and the time they made it go into the proof, with how they told people if they said. Aftercall can't check it.",
  },
  {
    where: "mac",
    title: "Recorded on the Mac as two tracks",
    body: "Their microphone is one track, labelled You. The call's audio from macOS is the other, labelled Others. That's how the notes tell the two sides apart; there's no voice recognition.",
  },
  {
    where: "mac",
    title: "The audio is sealed as it records",
    body: "About once a second the audio is encrypted with XChaCha20-Poly1305, using a key kept in the Mac's Keychain. Unencrypted audio is never written to disk.",
  },
  {
    where: "mac",
    title: "The secure hardware is checked before anything is sent",
    body: "With a fresh nonce for this recording, the Mac checks the NEAR AI gateway, Whisper and the summary model: Intel TDX quotes, NVIDIA GPU evidence, and the software each one runs. If the gateway or any Whisper node fails, or no summary node passes, nothing is sent.",
  },
  {
    where: "tee",
    title: "Transcribed by Whisper in an attested TEE",
    travels: "TLS, not end to end",
    body: "The audio goes in five-minute chunks over TLS through the attested gateway to Whisper in a NEAR AI TEE. It isn't end-to-end encrypted, because NEAR AI doesn't offer that for transcription. Project and payee names go with it as spelling hints.",
  },
  {
    where: "tee",
    title: "Summarised by a model in an attested TEE",
    travels: "End to end if NEAR AI accepts",
    body: "The Mac merges both tracks into one transcript and encrypts it to a key bound in the summary model's verified quote, so the gateway passes on text it can't read. If end-to-end encryption isn't available (no verified node offers an attested key, or NEAR AI refuses an encryption header), the transcript goes over TLS only when every summary node passed. If NEAR AI no longer serves the attested model key, the Mac checks the hardware again and retries encrypted once, never over TLS. Any other error stops processing, and the transcript isn't sent again. The proof says which happened. The model signs the exchange.",
  },
  {
    where: "mac",
    title: "Checked and sealed on the Mac",
    body: "The Mac checks the signature, drops any item whose quote isn't word for word in the transcript, and keeps a payment's amount only when the same amount is in that quote. The proof records how many items were dropped. The notes are saved sealed with the same Keychain key.",
  },
  {
    where: "mac",
    title: "The audio is deleted",
    body: "Right after the notes are saved, the app deletes the audio and the cached transcriptions of each chunk from the Mac. If the app quits before it can, or the delete fails, it deletes them the next time it opens. If making the notes fails, the sealed audio stays so the person can try again.",
  },
  {
    where: "near",
    title: "A hash of the proof is recorded on NEAR",
    travels: "Public, no content",
    body: "When the app has a NEAR account set up, a sha256 hash of the proof goes on NEAR with the meeting's ID (its start time) and the model name. Anyone with the proof link can compare the two.",
  },
];

/** The footer of a verified, end-to-end encrypted recap with a notice, line by line. */
const FOOTER = recapFooter({
  verified: true,
  e2ee: true,
  notice: { by: "you", at: "2026-11-02T14:02:00.000Z", how: "chat" },
  verifyUrl: "https://aftercall.app/verify#…",
  handlingUrl: "https://aftercall.app/handling",
}).split("\n");
const FOOTER_MEANS = [
  "Every secure-hardware check passed for this meeting. The second sentence says whether the transcript was end-to-end encrypted or went over TLS. When a check failed, this line says so instead.",
  "The app deletes the audio right after the notes are saved, as in step 8.",
  "Only there when the sender logged a notice. It's their statement; Aftercall can't check it.",
  "A link to this meeting's proof, where your browser re-runs the checks it can. Without a proof link, it points to this page.",
];

/** Open issues in NEAR AI's protocol, each confirmed at its source on 1 Nov 2026. */
const KNOWN: { text: string; source: string; href: string }[] = [
  {
    text: "NEAR AI's end-to-end encryption doesn't tie the reply key to the encrypted request, so someone holding a copy of that request could resend it with their own reply key and read the answer.",
    source: "nearai/cloud-api issue 1061, open",
    href: "https://github.com/nearai/cloud-api/issues/1061",
  },
  {
    text: "An independent review of private inference services hasn't yet confirmed that NEAR AI's gateway binds each TLS request to the backend that answers it, or that hardware evidence covers every party on that path.",
    source: "Awesome private inference",
    href: "https://amiller.github.io/awesome-private-inference",
  },
];

/** "Lead: rest" in bold-then-plain, as the Verify page shows NOT_PROVEN. */
function Lead({ text }: { text: string }) {
  const cut = text.indexOf(": ");
  if (cut < 0) return <>{text}</>;
  return (
    <>
      <strong>{text.slice(0, cut + 1)}</strong> {text.slice(cut + 2)}
    </>
  );
}

export default function Handling() {
  return (
    <>
      <SiteHeader current="handling" />
      <main>
        <section aria-labelledby="hero" className={c.hero}>
          <div className={c.heroInner}>
            <span className={`${c.eyebrow} enter`}>For anyone who got a recap</span>
            <h1 id="hero" className={`${c.h1} enter`} style={vars({ d: "40ms", dur: "360ms" })}>
              How a call is handled
            </h1>
            <p className={`${c.lede} enter`} style={vars({ d: "100ms", dur: "360ms" })}>
              What happens to a call Aftercall records, from the Mac that recorded it to a hash on NEAR, and what each step can and can&apos;t show.
            </p>
          </div>
        </section>

        <section id="steps" aria-labelledby="st" className={c.section}>
          <div className={c.wrap}>
            <h2 id="st" className={c.h2}>
              Step by step
            </h2>
            <ol className={c.steps}>
              {STEPS.map((s, i) => (
                <li key={s.title} className={`${c.step} enter`} style={vars({ d: `${160 + i * 40}ms`, dur: "240ms" })}>
                  <span aria-hidden="true" className={`${c.num} ${c[s.where]}`}>
                    {i + 1}
                  </span>
                  <span className={c.stepText}>
                    <span className={c.stepTitle}>{s.title}</span>
                    <span className={c.stepBody}>{s.body}</span>
                  </span>
                  <span className={c.stepMeta}>
                    <span className={c.where}>
                      <Icon name={WHERE[s.where].icon} size={14} stroke={1.75} />
                      {WHERE[s.where].label}
                    </span>
                    {s.travels && <span className={c.travels}>{s.travels}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="footer" aria-labelledby="ft" className={c.section}>
          <div className={`${c.wrap} ${c.two}`}>
            <div className={c.col}>
              <h2 id="ft" className={c.h2}>
                The recap footer
              </h2>
              <p className={c.intro}>A recap sent from Aftercall ends with a few lines like these. This one is for a meeting where every check passed and the transcript was end-to-end encrypted.</p>
            </div>
            <ol className={c.footerLines} aria-label="The footer, line by line">
              {FOOTER.map((line, i) => (
                <li key={line}>
                  <span className={c.footerLine}>{line}</span>
                  <span className={c.footerMeans}>{FOOTER_MEANS[i]}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="checked" aria-labelledby="ct" className={c.section}>
          <div className={`${c.wrap} ${c.two}`}>
            <div className={c.col}>
              <h2 id="ct" className={c.h2}>
                Checked on every run
              </h2>
              <p className={c.intro}>
                The checks in step 4 run again for every recording, against its own nonce, and the results go into the proof. From a proof link your browser re-runs the ones it can and shows the rest as the app recorded them.
              </p>
            </div>
            <div className={c.linkRows}>
              <a href="/how-it-works#checks" className={c.linkRow}>
                <span>
                  <strong>The checks, one by one</strong>
                  <span className="ink-2">what each one compares</span>
                </span>
                <Icon name="arrowRight" size={16} stroke={2.2} />
              </a>
              <a href="/verify" className={c.linkRow}>
                <span>
                  <strong>Verify a proof</strong>
                  <span className="ink-2">open the link from a recap</span>
                </span>
                <Icon name="arrowRight" size={16} stroke={2.2} />
              </a>
            </div>
          </div>
        </section>

        <section id="not-proven" aria-labelledby="nt" className={c.section}>
          <div className={`${c.wrap} ${c.two}`}>
            <div className={c.col}>
              <h2 id="nt" className={c.h2}>
                What isn&apos;t proven
              </h2>
              <p className={c.intro}>Every Verify page lists these under the checks.</p>
              <div className={c.notice}>
                <Icon name="info" size={18} stroke={1.75} />
                <span>
                  <span style={{ fontWeight: 600 }}>About transcription</span>
                  <span className="ink-2">{WHISPER_NOTE}</span>
                </span>
              </div>
            </div>
            <ul className={c.limits}>
              {NOT_PROVEN.map((n) => (
                <li key={n}>
                  <OpenCircle />
                  <span>
                    <Lead text={n} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="known-limits" aria-labelledby="kt" className={c.section} style={{ paddingBottom: 48 }}>
          <div className={`${c.wrap} ${c.two}`}>
            <div className={c.col}>
              <h2 id="kt" className={c.h2}>
                Known limits in NEAR AI&apos;s protocol
              </h2>
              <p className={c.intro}>Open issues in the service Aftercall relies on. Aftercall&apos;s checks don&apos;t close them.</p>
            </div>
            <ul className={c.limits}>
              {KNOWN.map((k) => (
                <li key={k.href}>
                  <OpenCircle />
                  <span className={c.known}>
                    <span className="ink">{k.text}</span>
                    <a href={k.href} className={c.source}>
                      {k.source}
                      <Icon name="external" size={12} />
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
