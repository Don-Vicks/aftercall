import type { ReactNode } from "react";
import { AppWindow, vars } from "../ui";
import l from "../landing.module.css";
import { ApproveDemo } from "./ApproveDemo";
import { Caption, Check, Face, Glyph, Said, SectionHead, Shot, MEETING_COL_SIZES } from "./bits";
import { Moment } from "./motion";
import { StoryScreen, StoryStage } from "./StoryStage";

/*
 * Section 3: one call, start to finish (the sample, Sync with Ada), after Stop.
 * At 1440 the steps scroll past a sticky window whose screen changes with the
 * step in the middle of the viewport. On a phone each step carries its own window.
 */

type Step = { n: number; label: string; title: string; body: ReactNode; detail: string; screen: () => ReactNode; caption: string };

const STEPS: Step[] = [
  {
    n: 1,
    label: "Checked first",
    title: "Nothing leaves until the hardware checks out.",
    body: (
      <>
        Press Stop and make notes. Before any audio is sent, Aftercall checks NEAR AI&apos;s gateway and the Whisper and Qwen machines against a fresh nonce: <b>24 checks</b> with one node per model. If
        the gateway or Whisper fails, or no Qwen node passes, nothing is sent.
      </>
    ),
    detail: "Audio then goes over TLS through the checked gateway; the transcript is end-to-end encrypted to the Qwen model, or not sent.",
    screen: () => <Processing />,
    caption: "Processing, as the app shows it. Times are illustrative. Proof recording runs on NEAR testnet.",
  },
  {
    n: 2,
    label: "Notes, with the words behind them",
    title: "Every follow-up quotes the call.",
    body: (
      <>
        Whisper writes the transcript with you and the call kept apart. Qwen writes the summary, decisions and action items, and every follow-up has to carry the exact words it came from.{" "}
        <b>The amount is read from those words, never from the model&apos;s number.</b>
      </>
    ),
    detail: "Quotes are matched word for word, in any language the call was in.",
    screen: () => <NotesScreen />,
    caption: "The Mac app on its built-in sample meeting.",
  },
  {
    n: 3,
    label: "The recap",
    title: "The recap waits in your own Mail.",
    body: (
      <>
        Draft in Mail, the default, opens the recap in your own mail app, ready to send: what you agreed, the action items, and a footer that says what was checked. Aftercall&apos;s servers never see it.
      </>
    ),
    detail: "Send through Aftercall is there if you want it; it hands the email to Resend, which keeps sent mail under its own policy.",
    screen: () => <RecapScreen />,
    caption: "The recap the app builds for the sample meeting, as a draft in Mail. The footer is the one it writes when every check passed.",
  },
  {
    n: 4,
    label: "The payment",
    title: "Approve once. Paid, within your caps.",
    body: (
      <>
        One approval pays the designer 50 USDC from your agent wallet, with five seconds to take it back. The 5,000 USDC from <q>the full five thousand when the deck is done</q> is over your caps, so the
        contract holds it until <b>your own wallet</b> approves.
      </>
    ),
    detail: "The app's own key can't raise a cap or add a payee.",
    screen: () => <PaymentScreen />,
    caption: "Payments in the sample are simulated. The contract's caps are tested on a local NEAR node.",
  },
];

export function Story() {
  return (
    <section id="story" aria-labelledby="story-h" className={l.section}>
      <div className={l.wrap}>
        <SectionHead
          index="03"
          eyebrow="One call, start to finish"
          id="story-h"
          title="What happens after you press Stop."
          lead="Follow the sample meeting, Sync with Ada, from the end of the call to the payment. The times are illustrative; the steps and their order are the app's."
        />
        <StoryStage className={l.story} steps={STEPS.length}>
          <div className={l.stepsCol}>
            <span className={l.rail} aria-hidden="true">
              <span className={l.railFill} />
            </span>
            <ol className={l.steps}>
            {STEPS.map((s) => (
              <li key={s.n} className={l.step} data-step={s.n}>
                <div className={l.stepText}>
                  <p className={l.stepLabel}>
                    <span>Step {s.n}</span> · {s.label}
                  </p>
                  <h3 className={l.h3}>{s.title}</h3>
                  <p className={l.body}>{s.body}</p>
                  <p className={l.detail}>{s.detail}</p>
                </div>
                {/* Phones: the step's own window, played when it scrolls in. */}
                <div className={l.stepPhone}>
                  <Moment threshold={0.35}>
                    <AppWindow className={l.storyWindow} bodyClassName={l.storyBody}>
                      {s.screen()}
                    </AppWindow>
                  </Moment>
                  <Caption>{s.caption}</Caption>
                </div>
              </li>
            ))}
            </ol>
          </div>
          <div className={l.stageCol}>
            <div className={l.stageSticky}>
              <AppWindow className={l.storyWindow} bodyClassName={l.storyBody}>
                {STEPS.map((s) => (
                  <StoryScreen key={s.n} n={s.n}>
                    {s.screen()}
                  </StoryScreen>
                ))}
              </AppWindow>
              <div className={l.stageCaptions}>
                {STEPS.map((s) => (
                  <Caption key={s.n} className={l.stageCaption}>
                    <span data-cap={s.n}>{s.caption}</span>
                  </Caption>
                ))}
              </div>
            </div>
          </div>
        </StoryStage>
      </div>
    </section>
  );
}

// ---------- the four screens ----------

/** apps/desktop/src/recording/processing.tsx, in the app's order, with its labels and details. */
const STAGES: { title: string; detail: string; time: string; chips?: string[] }[] = [
  { title: "Secure hardware checked", detail: "Gateway, Whisper and Qwen TEEs, each against a fresh nonce", time: "0.9 s", chips: ["Intel TDX quote", "Debug off", "Key bound", "Nonce bound", "Software", "NVIDIA GPUs"] },
  { title: "Transcribed", detail: "Whisper in secure hardware · You and Ada kept apart", time: "2.2 s" },
  { title: "Notes written", detail: "Transcript sealed on this Mac for the attested Qwen TEE; each item needs a quote from the call", time: "31 s" },
  { title: "Signature checked", detail: "Signed over the exact request and response by the attested key", time: "0.1 s", chips: ["Request hash", "Response hash", "Model named", "Attested signer"] },
  { title: "Audio deleted from this Mac", detail: "Only the encrypted transcript and notes stay", time: "0.1 s" },
  { title: "Proof recorded on NEAR", detail: "A hash only; no meeting content goes on chain", time: "1.4 s" },
];

function Processing() {
  return (
    <div className={l.proc}>
      <p className={l.procEyebrow}>Fundraise · Today · 3 min 12 s</p>
      <p className={l.procTitle}>Sync with Ada</p>
      <ol className={l.procRows}>
        {STAGES.map((s, i) => (
          <li key={s.title} className={l.procRow} style={vars({ i })}>
            <span className={l.procStatus}>
              <span className={l.procSpin} aria-hidden="true" />
              <Check size={18} className={l.procCheck} />
            </span>
            <span className={l.procText}>
              <b>{s.title}</b>
              <span>{s.detail}</span>
              {s.chips ? (
                <span className={l.chips}>
                  {s.chips.map((c, k) => (
                    <span key={c} className={l.chip} style={vars({ c: k })}>
                      {c}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
            <span className={l.procTime}>{s.time}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function NotesScreen() {
  return (
    <div className={l.notesScreen}>
      <div className={l.notesCrop}>
        <Shot name="meeting-col" w={632} h={796} sizes={MEETING_COL_SIZES} alt="The Sync with Ada notes, marked Verified, with the summary." />
      </div>
      <div className={l.strip}>
        <span className={l.stripAt}>02:14</span>
        <Face who="You" size={24} />
        <p className={l.stripLine}>
          Send Ada the recap after this call, and <mark className={l.sweep}>pay the designer the fifty dollar deposit today</mark>.
        </p>
        <p className={l.heardTag}>
          Heard <q className={l.serifQ}>fifty dollar</q> → <span className={l.mono}>50.00 USDC</span>
        </p>
      </div>
    </div>
  );
}

/** buildRecap() in packages/core/src/followups/recap.ts, on the sample meeting, shortened to what fits. */
const FOOTER = [
  "Notes made by Aftercall in secure hardware on NEAR AI Cloud, checked by the app before anything was sent. The transcript was end-to-end encrypted to that hardware.",
  "Aftercall deletes the call's audio once the notes are saved.",
];

function RecapScreen() {
  return (
    <div className={l.recapScreen}>
      <div className={l.recapCard}>
        <Face who="A" size={32} hue={2} />
        <div className={l.payWho}>
          <p className={l.payTitle}>Recap to Ada</p>
          <p className={l.recapSub}>ada@example.com · from your calendar</p>
        </div>
        <span className={`${l.btnPrimary} ${l.draftBtn}`} aria-hidden="true">
          <Glyph name="mail" size={14} />
          Draft in Mail
        </span>
      </div>
      <div className={l.compose} aria-label="The recap, drafted in Mail" role="group">
        <div className={l.composeBar}>
          <span className={l.callDots} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Recap: API fix before Friday, deck refresh</span>
          <Glyph name="send" size={14} />
        </div>
        <dl className={l.composeHead}>
          <div>
            <dt>To</dt>
            <dd>Ada &lt;ada@example.com&gt;</dd>
          </div>
          <div>
            <dt>Subject</dt>
            <dd>Recap: API fix before Friday, deck refresh</dd>
          </div>
        </dl>
        <div className={l.composeBody}>
          <p style={vars({ i: 0 })}>Hi Ada, thanks for the call. Here&apos;s what we agreed.</p>
          <ol style={vars({ i: 1 })}>
            <li>Ship the API fix before Friday&apos;s demo.</li>
            <li>Refresh the deck with the designer, with a 50 USDC deposit now.</li>
          </ol>
          <p className={l.composeItems} style={vars({ i: 2 })}>
            Send Ada the recap · You · today
            <br />
            Ship the API fix · You · by Friday
          </p>
          <div className={l.composeFoot} style={vars({ i: 3 })}>
            {FOOTER.map((f) => (
              <p key={f}>{f}</p>
            ))}
            <p>
              <span className={l.composeLink}>What was and wasn&apos;t checked →</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PaymentScreen() {
  return (
    <div className={l.paymentScreen}>
      <ApproveDemo />
      <div className={l.blocked}>
        <Face who="D" size={36} hue={5} />
        <div className={l.payWho}>
          <p className={l.payTitle}>
            Pay Designer <span className={l.mono}>5,000.00 USDC</span>
          </p>
          <p className={l.blockedLine}>Over your caps. Only your wallet can approve it.</p>
          <Said at="02:30" className={l.blockedSaid}>
            the full five thousand when the deck is done
          </Said>
        </div>
        <span className={l.btnCaution} aria-hidden="true">
          Review
        </span>
      </div>
    </div>
  );
}
