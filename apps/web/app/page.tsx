import type { ReactNode } from "react";
import { Avatar, Icon, OpenCircle, Pill, Seal, SiteFooter, SiteHeader, Tick, vars } from "./ui";
import l from "./landing.module.css";

/*
 * The landing page (docs/design-source/v2/V2Landing.dc.html): one call from the moment
 * it ends, then what the app does, how it stays private, the money rules and Verify.
 * The pictures are drawings of the app's own screens with sample data (Ines Rocha is
 * fictional); each is one image to a screen reader, described by its aria-label.
 * Motion is CSS only: entries stagger in, the meters move, checks pop and the paid
 * tick draws. With reduced motion they fade instead (tokens.css).
 */

const INES = "Ines Rocha";
const ease = (d: number, dur?: number) => vars({ d: `${d}ms`, dur: dur ? `${dur}ms` : undefined });

export default function Landing() {
  return (
    <>
      <SiteHeader />
      <main>
        <section aria-labelledby="hero" className={l.hero}>
          <div className={l.heroInner}>
            <h1 id="hero" className={`${l.heroTitle} enter`} style={ease(0, 360)}>
              Your call ends.
              <br />
              <em>The follow-through starts.</em>
            </h1>
            <div className={`${l.heroRow} enter`} style={ease(60, 360)}>
              <p className={l.heroLede}>
                Aftercall is a Mac app that makes private notes of your calls inside NEAR AI&apos;s secure hardware, then sends the recap and pays what you agreed, once you say so.
              </p>
              <div className={l.heroCta}>
                <a href="/download" className="btn btn-primary btn-lg press">
                  <Icon name="download" size={18} />
                  Download for Mac
                </a>
                <span className={l.note}>Built for NEAR HACKATHON</span>
              </div>
            </div>
          </div>
        </section>

        <Story />
        <WhatItDoes />
        <Private />
        <Money />
        <Verify />
        <Questions />

        <section aria-labelledby="close-h" className={`${l.closing} enter`} style={ease(840)}>
          <div className={l.closingInner}>
            <h2 id="close-h" className="mono" style={{ fontSize: 13, lineHeight: "18px", fontWeight: 500 }}>
              Always
            </h2>
            <p className={l.closingStatement}>
              Your words reach only secure hardware that has just proven itself, or <em>they never leave your Mac.</em> Our servers keep nothing about a meeting. Nothing said goes on chain.
            </p>
            <div className={l.closingCta}>
              <a href="/download" className="btn btn-primary btn-lg press">
                <Icon name="download" size={18} />
                Download for Mac
              </a>
              <span className="ink-2" style={{ fontSize: 14, lineHeight: "20px" }}>
                Open source · MIT · Built for NEAR HACKATHON
              </span>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

// ---------- one call, from the moment it ends ----------

function When({ time, label, children }: { time: string; label: string; children?: ReactNode }) {
  return (
    <div className={l.when}>
      <span className={l.whenTime}>{time}</span>
      <span className={l.whenLabel}>{label}</span>
      {children}
    </div>
  );
}

/** One step of the story: the time on the left, the words, and a picture of the app. */
function Step({ time, label, delay, lead, children, visual, last, extra }: { time: string; label: string; delay: number; lead: string; children: ReactNode; visual: ReactNode; last?: boolean; extra?: ReactNode }) {
  return (
    <li className={`${l.item} enter`} style={ease(delay)}>
      <When time={time} label={label}>
        {extra}
      </When>
      <div className={`${l.body}${last ? ` ${l.bodyLast}` : ""}`}>
        <span aria-hidden="true" className={`${l.dot}${last ? ` ${l.dotOpen}` : ""}`} />
        <p className={l.text}>
          <span aria-hidden="true" className={l.inlineWhen}>
            <span className="mono">{time}</span> · {label}
          </span>
          <strong>{lead}</strong> {children}
        </p>
        {visual}
      </div>
    </li>
  );
}

/** A line someone said, large, with who said it. */
function Said({ who, at, delay, children }: { who: string; at: string; delay: number; children: ReactNode }) {
  return (
    <li className={`${l.item} enter`} style={ease(delay)}>
      <div className={`${l.when} ${l.whenPerson}`} aria-hidden="true">
        <Avatar name={who} size={32} decorative />
        {who !== "You" && <span className={l.whenLabel}>{who}</span>}
      </div>
      <figure className={l.quote}>
        <span aria-hidden="true" className={l.quoteWho}>
          <Avatar name={who} size={22} decorative />
          {who}
        </span>
        <figcaption className="sr-only">{who === "You" ? "You said, at" : `${who} said, at`} {at} in the call:</figcaption>
        <blockquote>
          “{children}”{" "}
          <span className={l.quoteAt} aria-hidden="true">
            {at}
          </span>
        </blockquote>
      </figure>
    </li>
  );
}

const MIC = [
  [820, -120],
  [640, -340],
  [900, -520],
  [700, -80],
  [760, -410],
];
const CALL = [
  [1100, -300],
  [980, -700],
  [1240, -150],
  [860, -560],
  [1020, -90],
];

function Bars({ list, className }: { list: number[][]; className: string }) {
  return (
    <span className={`${l.bars} ${className}`}>
      {list.map(([t, d], i) => (
        <span key={i} className="meter-bar" style={vars({ t: `${t}ms`, d: `${d}ms` })} />
      ))}
    </span>
  );
}

function Story() {
  return (
    <section aria-labelledby="story" className={l.story}>
      <div className={l.wrap}>
        <h2 id="story" className="sr-only">
          One call, from the moment it ends
        </h2>
        <ol className={l.storyList}>
          <Step
            time="15:43"
            label="Call ends"
            delay={120}
            lead="You hang up."
            extra={
              <span role="img" aria-label={`You and ${INES}`} className={l.stack}>
                <Avatar name="You" size={26} ring="raised" decorative />
                <Avatar name={INES} size={26} ring="raised" decorative />
              </span>
            }
            visual={
              <div role="img" aria-label="The live recording pill at 12:58, with your mic and the call on separate meters, and Stop and make notes" className={`${l.visual} ${l.onGround} ${l.pillStage}`}>
                <span aria-hidden="true" className={l.livePill}>
                  <span className={`${l.recDot} breathe`} />
                  <span className={l.timer}>12:58</span>
                  <Bars list={MIC} className={l.barsMic} />
                  <Bars list={CALL} className={l.barsCall} />
                  <span className={l.divider} />
                  <span className={l.stop}>
                    <span className={l.stopSquare} />
                    <span>
                      Stop<span className={l.stopMore}>&nbsp;and make notes</span>
                    </span>
                  </span>
                </span>
                <span aria-hidden="true" className={l.legend}>
                  <span>
                    <span className={l.swatch} style={{ background: "var(--verdigris)" }} />
                    Your mic
                  </span>
                  <span>
                    <span className={l.swatch} style={{ background: "var(--ink-2)" }} />
                    The call
                  </span>
                </span>
              </div>
            }
          >
            Thirteen minutes with {INES}, a new website agreed, and no bot in the call. Aftercall recorded both sides on your Mac, sealing the audio as it went.
          </Step>

          <Step
            time="15:43:02"
            label="Checked"
            delay={180}
            lead="Before a word leaves your Mac,"
            visual={
              <div role="img" aria-label="Secure hardware checked: six kinds of check passed, and the transcript sealed to the Qwen TEE" className={`${l.visual} ${l.onRaised} ${l.checksCard}`}>
                <span aria-hidden="true" className={l.cardHead}>
                  <span className="t-section">Secure hardware checked</span>
                  <span className="ink-2" style={{ fontSize: 12 }}>
                    Gateway · Whisper · Qwen
                  </span>
                </span>
                <span aria-hidden="true" className={l.chips}>
                  {["Intel TDX quote", "Debug off", "Key bound", "Nonce bound", "Known software", "NVIDIA GPUs"].map((c, i) => (
                    <span key={c} className={`${l.chip} pop`} style={ease(520 + i * 90)}>
                      <Icon name="check" size={11} stroke={3} />
                      {c}
                    </span>
                  ))}
                </span>
                <span aria-hidden="true" className={`${l.sealed} enter`} style={ease(1100, 260)}>
                  <Icon name="lock" size={16} className="accent" />
                  <span style={{ flex: 1, fontWeight: 600 }}>Transcript sealed to the Qwen TEE</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    the relay sees ciphertext
                  </span>
                </span>
              </div>
            }
          >
            NEAR AI&apos;s secure hardware has to pass every check, against a fresh nonce. If one fails, nothing is sent. Your transcript is then sealed so only the model that passed can read it.
          </Step>

          <Step
            time="15:44"
            label="Notes ready"
            delay={240}
            lead="A minute later, the notes."
            visual={
              <div role="img" aria-label="The notes: one decision with the quote behind it, and two action items, one for you and one for Ines" className={`${l.visual} ${l.onRaised} ${l.notesCard}`}>
                <span aria-hidden="true" className={l.cardHead} style={{ alignItems: "center" }}>
                  <span className={l.notesTitle}>Website kickoff with Ines</span>
                  <Pill tone="verdigris" className={l.smallPill} icon={<Icon name="shieldCheck" size={11} />}>
                    Verified
                  </Pill>
                </span>
                <span aria-hidden="true" className={l.decision}>
                  <span>Home and booking pages first; the rest waits for phase two.</span>
                  <span className={l.evidence}>
                    “Let&apos;s agree the home page and the booking page come first” <span className={l.evidenceAt}>03:12</span>
                  </span>
                </span>
                <span aria-hidden="true" className={l.items}>
                  <span className={l.actionRow}>
                    <OpenCircle />
                    <span>Share the logo files and workshop photos</span>
                    <Avatar name="You" size={20} decorative />
                    <span className={l.due}>Wed</span>
                  </span>
                  <span className={l.actionRow}>
                    <OpenCircle />
                    <span>Send three style directions</span>
                    <Avatar name={INES} size={20} decorative />
                    <span className={l.due}>Fri</span>
                  </span>
                </span>
              </div>
            }
          >
            What you decided and who does what, each tied to the exact words from the call. Anything the model can&apos;t back with a quote is dropped.
          </Step>

          <Said who="You" at="12:31" delay={300}>
            I&apos;ll email you a short recap after this call.
          </Said>

          <Step
            time="15:45"
            label="Recap drafted"
            delay={360}
            lead="So the recap is waiting"
            visual={
              <div role="img" aria-label="A recap email to Ines Rocha, drafted in your Mail: the three things you agreed and the recording notice" className={`${l.visual} ${l.onElevated} ${l.clip}`}>
                <span aria-hidden="true" className={l.titleBar}>
                  <span className={l.lights}>
                    <span />
                    <span />
                    <span />
                  </span>
                  <span className={l.titleBarText}>Recap: website kickoff</span>
                  <span style={{ width: 42 }} />
                </span>
                <span aria-hidden="true" className={l.mailTo}>
                  <span className="muted" style={{ width: 24 }}>
                    To
                  </span>
                  <Avatar name={INES} size={20} decorative />
                  <span>{INES}</span>
                </span>
                <span aria-hidden="true" className={l.mailBody}>
                  <span style={{ fontSize: 14, lineHeight: "20px" }}>Hi Ines, thanks for the call. Here&apos;s what we agreed:</span>
                  <span className={l.mailList}>
                    <span>· Home and booking pages first, the rest in phase two</span>
                    <span>· Logo files and workshop photos from me by Wednesday</span>
                    <span>· A 40 USDC deposit today, the rest on sign-off</span>
                  </span>
                </span>
                <span aria-hidden="true" className={l.mailFoot}>
                  <Icon name="shieldCheck" size={14} stroke={1.75} className="accent" />
                  <span>Notes made by Aftercall in secure hardware on NEAR AI Cloud.</span>
                </span>
              </div>
            }
          >
            as a draft in your own Mail, addressed to Ines. Change a word, then send it. A draft made on your Mac never touches our servers.
          </Step>

          <Said who={INES} at="11:40" delay={420}>
            Forty dollars is enough to book the slot.
          </Said>

          <Step
            time="15:46"
            label="Deposit paid"
            delay={480}
            lead="One tap, and Ines is paid."
            visual={
              <div role="img" aria-label="Paid Ines Rocha 40.00 USDC at 15:46 from your agent wallet: heard the 40 dollar deposit, Ines is on your payee list, inside your caps" className={`${l.visual} ${l.onElevated} ${l.paidCard}`}>
                <span aria-hidden="true" className={l.paidHead}>
                  <Avatar name={INES} size={34} decorative />
                  <span className={l.paidWho}>
                    <span style={{ fontWeight: 600 }}>Paid {INES}</span>
                    <span className="ink-2" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
                      From your agent wallet
                    </span>
                  </span>
                  <span className={`${l.paidPill} pop`} style={ease(900, 420)}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" className={`${l.drawCheck} draw`} style={vars({ d: "1020ms" })} />
                    </svg>
                    <span className="mono" style={{ fontWeight: 500 }}>
                      40.00 USDC
                    </span>
                    paid 15:46
                  </span>
                </span>
                <span aria-hidden="true" className={l.well}>
                  <span className={l.wellRow}>
                    <span className={l.wellLabel}>Heard</span>
                    <span>
                      <span className="serif" style={{ fontStyle: "italic", fontSize: 14 }}>
                        “the 40 dollar deposit”
                      </span>{" "}
                      <span className="muted">→</span> <span className="mono">40.00 USDC</span>
                    </span>
                  </span>
                  <span className={l.wellRow}>
                    <span className={l.wellLabel}>Payee</span>
                    <span>
                      {INES} <span className="accent">· on your list</span>
                    </span>
                  </span>
                  <span className={l.wellRow}>
                    <span className={l.wellLabel}>Caps</span>
                    <span className="ink-2">Inside your daily and per-payment limits</span>
                  </span>
                </span>
              </div>
            }
          >
            The amount is read from the words spoken, not the model&apos;s guess. A NEAR contract caps what the app can ever pay, so a hijacked app or a tricked AI can&apos;t overspend.
          </Step>

          <Step
            time="Anytime"
            label="Anyone checks"
            delay={540}
            last
            lead="And anyone can check how."
            visual={
              <div role="img" aria-label="The public Verify page: a Verified seal, the proof recorded on NEAR, the summary signed in secure hardware, re-checked in this browser" className={`${l.visual} ${l.onRaised} ${l.verifyCard}`}>
                <Seal size={96} id="seal-story" className="pop" style={ease(1000, 480)} />
                <span aria-hidden="true" className={l.verifyCol}>
                  <span className="mono muted" style={{ fontSize: 11, lineHeight: "16px" }}>
                    /verify#… · proof by victor.near
                  </span>
                  <span className={`${l.checkRows} ${l.checkRowsOpen}`}>
                    <VerifiedLine size={15}>Proof recorded on NEAR</VerifiedLine>
                    <VerifiedLine size={15}>Summary signed in secure hardware</VerifiedLine>
                    <VerifiedLine size={15}>Re-checked in this browser</VerifiedLine>
                  </span>
                  <span className="ink-2" style={{ fontSize: 12, lineHeight: "17px" }}>
                    Not proven here: that the transcript is accurate.
                  </span>
                </span>
              </div>
            }
          >
            The proof sits on NEAR: a hash, never what was said. Open the link in any browser to re-run the checks, down to what the proof doesn&apos;t show.
          </Step>
        </ol>
      </div>
    </section>
  );
}

function VerifiedLine({ size, children }: { size: number; children: ReactNode }) {
  return (
    <span className={l.checkRow}>
      <Tick size={size} still decorative />
      {children}
    </span>
  );
}

// ---------- what it does for you ----------

function Feature({ label, title, soon, text, visual, visualFirst, last }: { label: string; title: string; soon?: boolean; text: ReactNode; visual: ReactNode; visualFirst?: boolean; last?: boolean }) {
  const words = (
    <div className={l.featureText}>
      <h3 className={l.featureTitle}>
        {title}
        {soon && (
          <Pill tone="muted" className={l.soon}>
            Coming soon
          </Pill>
        )}
      </h3>
      <p>{text}</p>
    </div>
  );
  return (
    <div className={`${l.feature}${last ? ` ${l.featureLast}` : ""}`}>
      <div className={l.featureLabel} aria-hidden="true">
        {label}
      </div>
      <div className={l.featureBody}>
        {visualFirst ? (
          <>
            {visual}
            {words}
          </>
        ) : (
          <>
            {words}
            {visual}
          </>
        )}
      </div>
    </div>
  );
}

function WhatItDoes() {
  return (
    <section id="does" aria-labelledby="does-h" className={`${l.section} enter`} style={ease(600)}>
      <div className={l.wrap} style={{ display: "flex", flexDirection: "column" }}>
        <div className={l.head}>
          <h2 id="does-h" className={l.h2}>
            What it does for you
          </h2>
          <p className={l.headNote}>Everything after the call, kept on your Mac. Two of these are still being built, and say so.</p>
        </div>

        <Feature
          label="Notes"
          title="Notes you can trust."
          text="Every decision and action item carries the exact words that asked for it, one click from that moment in the transcript. If the model can't quote it, it's dropped."
          visual={
            <div role="img" aria-label="An action item, Send three style directions, owned by Ines and due Friday, with the line from the call that backs it" className={`${l.featureVisual} ${l.right} ${l.onRaised} ${l.cardPad}`}>
              <span aria-hidden="true" className={l.actionRow} style={{ padding: 0 }}>
                <OpenCircle />
                <span style={{ fontSize: 15, fontWeight: 600 }}>Send three style directions</span>
                <Avatar name={INES} size={22} decorative />
                <span className="muted" style={{ fontSize: 12 }}>
                  Fri
                </span>
              </span>
              <span aria-hidden="true" className={l.well}>
                <span className={l.metaRow}>
                  <span className="ink-2" style={{ fontWeight: 600 }}>
                    {INES}
                  </span>
                  <span className="mono muted">07:48</span>
                  <span className="accent" style={{ marginLeft: "auto", fontWeight: 600 }}>
                    Open in transcript
                  </span>
                </span>
                <span className={l.lineQuote}>
                  “Perfect. <mark>I&apos;ll send you three style directions by Friday</mark>…”
                </span>
              </span>
            </div>
          }
        />

        <Feature
          label="Follow-ups"
          title="Nothing goes until you say yes."
          visualFirst
          text="Recaps open as drafts in your own Mail. Payments take one tap, go only to people on your list, and stay inside your caps. Autopilot is off until you set it."
          visual={
            <div role="img" aria-label="Two follow-ups waiting for you: a recap to Ines with Draft in Mail, and a 40.00 USDC payment to Ines with Approve payment" className={`${l.featureVisual} ${l.onElevated} ${l.clip}`}>
              <span aria-hidden="true" className={l.followRow}>
                <Avatar name={INES} size={30} decorative />
                <span className={l.followText}>
                  <span style={{ fontWeight: 600 }}>Recap to Ines</span>
                  <span className="ink-2" style={{ fontSize: 12, lineHeight: "17px" }}>
                    Draft in Mail keeps it on this Mac
                  </span>
                </span>
                <span className={l.fakeButton}>Draft in Mail</span>
              </span>
              <span aria-hidden="true" className={l.followRow}>
                <Avatar name={INES} size={30} decorative />
                <span className={l.followText}>
                  <span style={{ fontWeight: 600 }}>
                    Pay {INES}{" "}
                    <span className="mono" style={{ fontWeight: 500 }}>
                      40.00 USDC
                    </span>
                  </span>
                  <span className="ink-2" style={{ fontSize: 12, lineHeight: "17px" }}>
                    On your list · inside your caps
                  </span>
                </span>
                <span className={l.fakeButton}>Approve payment</span>
              </span>
            </div>
          }
        />

        <Feature
          label="People"
          title="Who owes whom."
          soon
          text="Every action item already has an owner and a due date. Soon each person gets a page: what you owe them, and what they owe you."
          visual={
            <div role="img" aria-label="Coming soon, a page for Ines Rocha: you owe Ines the logo files and photos by Wednesday, the 40 USDC deposit is done; Ines owes you three style directions by Friday and a first home page draft" className={`${l.featureVisual} ${l.right} ${l.onRaised} ${l.cardPad}`}>
              <span aria-hidden="true" className={l.owes}>
                <span className={l.owesCol}>
                  <span className={l.owesHead}>
                    <Avatar name="You" size={18} decorative />
                    You owe Ines
                  </span>
                  <span className={l.owesRow}>
                    <OpenCircle size={16} />
                    <span>Logo files and photos</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Wed
                    </span>
                  </span>
                  <span className={l.owesRow}>
                    <Tick size={16} still decorative />
                    <span className={l.done}>40 USDC deposit</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      paid
                    </span>
                  </span>
                </span>
                <span className={l.owesCol}>
                  <span className={l.owesHead}>
                    <Avatar name={INES} size={18} decorative />
                    Ines owes you
                  </span>
                  <span className={l.owesRow}>
                    <OpenCircle size={16} />
                    <span>Three style directions</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Fri
                    </span>
                  </span>
                  <span className={l.owesRow}>
                    <OpenCircle size={16} />
                    <span>First home page draft</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      later
                    </span>
                  </span>
                </span>
              </span>
            </div>
          }
        />

        <Feature
          label="Ask"
          title="Ask your meetings."
          soon
          visualFirst
          text="Ask in plain words, and every answer shows the quotes it stands on. Search across all your meetings already works today, on your Mac."
          visual={
            <div role="img" aria-label="Coming soon, ask your meetings: What did Ines promise this week? The answer, three style directions by Friday, comes with the quote from the call" className={`${l.featureVisual} ${l.onRaised} ${l.cardPad}`} style={{ padding: "14px 18px", gap: 8 }}>
              <span aria-hidden="true" className={l.bubbleRow}>
                <span className={l.bubble}>What did Ines promise this week?</span>
                <Avatar name="You" size={22} decorative />
              </span>
              <span aria-hidden="true" className={l.answer}>
                Three style directions, by Friday.
              </span>
              <span aria-hidden="true" className={l.quoteChip}>
                <Avatar name={INES} size={20} decorative />
                <span>“I&apos;ll send you three style directions by Friday”</span>
                <span className="mono muted" style={{ fontSize: 11 }}>
                  07:48
                </span>
              </span>
            </div>
          }
        />

        <Feature
          label="Agents"
          title="Hand the work to your own agents."
          last
          text="Claude Code or Codex can read your meetings and pick up an action item, only through the app on your Mac. It's off until you turn it on."
          visual={
            <div role="img" aria-label="Connected agents, switched on: Claude Code claimed Ship the API fix at 14:20, and Codex finished Write the release notes at 14:41" className={`${l.featureVisual} ${l.right} ${l.onRaised} ${l.cardPad}`} style={{ gap: 8 }}>
              <span aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 4 }}>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>Let agents reach my meetings</span>
                <span className="ink-2" style={{ fontSize: 12 }}>
                  You turned it on
                </span>
                <span className={l.toggle} />
              </span>
              <span aria-hidden="true" className={l.agentRow}>
                <OpenCircle />
                <span>Ship the API fix</span>
                <span className="accent" style={{ fontWeight: 600 }}>
                  Claude Code is on it · 14:20
                </span>
              </span>
              <span aria-hidden="true" className={`${l.agentRow} ${l.agentRowLast}`}>
                <Tick size={18} still decorative />
                <span className={l.done}>Write the release notes</span>
                <span className="ink-2">Codex finished it · 14:41</span>
              </span>
            </div>
          }
        />
      </div>
    </section>
  );
}

// ---------- private by construction ----------

function Hop({ label }: { label: string }) {
  return (
    <li aria-hidden="true" className={l.hop}>
      <span className={l.hopLabel}>{label}</span>
      <svg width="60" height="10" viewBox="0 0 60 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 5h57M53 1l5 4-5 4" />
      </svg>
    </li>
  );
}

function Private() {
  return (
    <section id="private" aria-labelledby="private-h" className={`${l.section} enter`} style={ease(660)}>
      <div className={`${l.wrap} ${l.privateWrap}`}>
        <div className={l.head}>
          <h2 id="private-h" className={l.h2}>
            Private by construction
          </h2>
          <p className={l.headNote}>
            Where a meeting goes, and what each stop can see.{" "}
            <a href="/how-it-works" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
              How it works
            </a>
          </p>
        </div>

        <ol aria-label="The journey of one meeting" className={l.journey}>
          <li className={`${l.stop4} ${l.stopMac}`}>
            <span className={l.stopTitle}>
              <Icon name="laptop" size={16} stroke={1.75} />
              <span>Your Mac</span>
            </span>
            <span className={l.stopText}>Records both sides, seals the audio, keeps the notes encrypted.</span>
          </li>
          <Hop label="checks first" />
          <li className={`${l.stop4} ${l.stopTee}`}>
            <span className={l.stopTitle}>
              <Icon name="shieldCheck" size={16} stroke={1.75} />
              <span>Gateway TEE</span>
            </span>
            <span className={l.stopText}>Relays the audio over TLS, and the transcript only as ciphertext.</span>
          </li>
          <Hop label="checks first" />
          <li className={`${l.stop4} ${l.stopTee}`}>
            <span className={l.stopTitle}>
              <Icon name="shieldCheck" size={16} stroke={1.75} />
              <span>Whisper and Qwen TEEs</span>
            </span>
            <span className={l.stopText}>Transcribe, then write the notes. The reply comes back signed.</span>
          </li>
          <Hop label="hash only" />
          <li className={`${l.stop4} ${l.stopNear}`}>
            <span className={l.stopTitle}>
              <Icon name="chain" size={16} stroke={1.75} />
              <span>NEAR</span>
            </span>
            <span className={l.stopText}>Your Mac records a hash of the proof. Never what was said.</span>
          </li>
        </ol>

        <div className={l.factsRow}>
          <dl className={l.facts}>
            <div>
              <dt>Checked before it gets anything</dt>
              <dd>On a typical meeting, 24 checks on the gateway, Whisper and Qwen against a fresh nonce, then 5 on the signed reply. One failure, and nothing is sent there.</dd>
            </div>
            <div>
              <dt>End-to-end encrypted summaries</dt>
              <dd>The transcript is sealed on your Mac to the Qwen TEE&apos;s attested key. Audio isn&apos;t: NEAR AI doesn&apos;t offer that for transcription, and the app says so.</dd>
            </div>
            <div>
              <dt>Encrypted on your Mac</dt>
              <dd>Audio is sealed as it records and deleted after transcription. Notes are sealed with a key in your Keychain.</dd>
            </div>
            <div>
              <dt>Our servers keep nothing</dt>
              <dd>Nothing about a meeting is kept after a response returns. A recap you draft in Mail never reaches them.</dd>
            </div>
          </dl>
          <aside aria-labelledby="cant-h" className={l.cant}>
            <h3 id="cant-h" className="t-heading">
              What we can&apos;t prove
            </h3>
            <ul>
              <li>
                <span>That the transcript is accurate:</span> <span className="ink-2">Whisper can mishear names and numbers.</span>
              </li>
              <li>
                <span>That the attested Whisper TEE made it:</span> <span className="ink-2">NEAR AI signs chat replies, not transcriptions.</span>
              </li>
              <li>
                <span>That everyone agreed to be recorded:</span> <span className="ink-2">you confirm it; Aftercall can&apos;t check.</span>
              </li>
              <li>
                <span>Who said what:</span> <span className="ink-2">“You” is your mic, and “Others” is the call&apos;s audio.</span>
              </li>
            </ul>
          </aside>
        </div>
      </div>
    </section>
  );
}

// ---------- money ----------

function Money() {
  return (
    <section id="money" aria-labelledby="money-h" className={`${l.section} enter`} style={ease(720)}>
      <div className={`${l.wrap} ${l.split}`}>
        <div className={l.splitText}>
          <h2 id="money-h" className={l.h2}>
            Money that can&apos;t run away
          </h2>
          <p className={l.reading}>
            Payments come from an agent wallet, not your own. A NEAR contract caps each day and each payment, and pays only people on your list. Over the caps, it waits for your own wallet, so a hijacked app or a tricked AI can&apos;t overspend.
          </p>
          <ul className={l.ticks}>
            <li>
              <Icon name="check" size={14} stroke={2.4} className="accent" />
              The app&apos;s key can only pay and record proofs
            </li>
            <li>
              <Icon name="check" size={14} stroke={2.4} className="accent" />
              Every rule change needs your own wallet
            </li>
          </ul>
        </div>
        <div role="img" aria-label="Paid Ines Rocha 40.00 USDC. A 5,000.00 USDC payment to Ines is blocked: over your caps, only your own wallet can approve it, with a Review button" className={`${l.splitVisual} ${l.onElevated} ${l.right}`}>
          <span aria-hidden="true" className={l.payRow}>
            <Avatar name={INES} size={30} decorative />
            <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>Paid {INES}</span>
            <Pill tone="verdigris" style={{ fontSize: 12, letterSpacing: 0, textTransform: "none" }} icon={<Icon name="check" size={12} stroke={2.5} />}>
              <span className="mono" style={{ fontWeight: 500 }}>
                40.00 USDC
              </span>
            </Pill>
          </span>
          <span aria-hidden="true" className={`${l.payRow} ${l.payBlocked}`}>
            <Avatar name={INES} size={30} decorative />
            <span className={l.followText} style={{ gap: 1 }}>
              <span style={{ fontWeight: 600 }}>
                Pay {INES}{" "}
                <span className="mono" style={{ fontWeight: 500 }}>
                  5,000.00 USDC
                </span>
              </span>
              <span style={{ fontSize: 12, lineHeight: "17px", color: "var(--caution)" }}>Over your caps. The contract refused it; only your own wallet can approve.</span>
            </span>
            <span className={l.review}>Review</span>
          </span>
        </div>
      </div>
    </section>
  );
}

// ---------- verify ----------

function Verify() {
  return (
    <section id="verify" aria-labelledby="verify-h" className={`${l.section} enter`} style={ease(750)}>
      <div className={`${l.wrap} ${l.split}`}>
        <div role="img" aria-label="The public Verify page: Verified in secure hardware, proof recorded on NEAR, summary signed in secure hardware, re-checked in this browser" className={`${l.splitVisual} ${l.onRaised}`}>
          <span aria-hidden="true" className={l.browserBar}>
            <span className={l.lights}>
              <span />
              <span />
              <span />
            </span>
            <span style={{ flex: 1, display: "flex", justifyContent: "center" }}>
              <span className={l.url}>/verify#…</span>
            </span>
            <span style={{ width: 37 }} />
          </span>
          <span aria-hidden="true" className={l.browserBody}>
            <Seal size={68} id="seal-verify" />
            <span className={`${l.checkRows} ${l.checkRowsBare}`} style={{ flex: 1, minWidth: 0 }}>
              <VerifiedLine size={14}>Proof recorded on NEAR</VerifiedLine>
              <VerifiedLine size={14}>Summary signed in secure hardware</VerifiedLine>
              <VerifiedLine size={14}>Re-checked in this browser</VerifiedLine>
            </span>
          </span>
        </div>
        <div className={`${l.splitText} ${l.splitTextRight}`}>
          <h2 id="verify-h" className={l.h2}>
            Check any meeting
          </h2>
          <p className={l.reading}>Each proof sits on NEAR as a hash. Share the link, and anyone&apos;s browser re-checks what it can, without seeing a word of the meeting.</p>
          <a href="/verify" className="arrow-link" style={{ alignSelf: "flex-start" }}>
            Open a sample proof
            <Icon name="arrowRight" size={14} stroke={2.2} />
          </a>
        </div>
      </div>
    </section>
  );
}

// ---------- questions ----------

const FAQ: [string, string][] = [
  ["Does a bot join my call?", "No. Aftercall records on your Mac, from your mic and your Mac's audio. You tell people it's recorded, and the app asks you to confirm."],
  ["Who can read my notes?", "You. Notes stay on your Mac, sealed with a key in your Keychain. What NEAR AI keeps while making them is set by its own policy."],
  ["Which call apps work?", "Any app on your Mac, including calls in a browser. Aftercall records what your Mac plays and what your mic hears."],
  ["What does it cost?", "Notes use NEAR AI on your own key, about [cost] per hour of calls. Aftercall is [price]. Payments use the USDC in your agent wallet."],
  ["What if a check fails?", "Nothing goes to hardware that failed. If the gateway or Whisper fails a check, your audio stays on your Mac."],
  ["Can I delete everything?", "Yes, on your Mac: deleting a meeting removes its notes and audio. A proof on NEAR stays, but holds only a hash."],
];

function Questions() {
  return (
    <section id="faq" aria-labelledby="faq-h" className={`${l.section} enter`} style={ease(780)}>
      <div className={`${l.wrap} ${l.faq}`}>
        <h2 id="faq-h" className={l.faqTitle}>
          Questions
        </h2>
        <div className={l.faqGrid}>
          {FAQ.map(([q, a]) => (
            <details key={q} open>
              <summary>
                {q}
                <Icon name="minus" size={14} className={l.minus} />
                <Icon name="plus" size={14} className={l.plus} />
              </summary>
              <p className="reveal">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
