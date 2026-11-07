import type { ReactNode } from "react";
import { REPO_PUBLIC } from "../site";
import { REPO_URL, vars } from "../ui";
import l from "../landing.module.css";
import { AutopilotLine } from "./AutopilotLine";
import { Check, Face, SectionHead } from "./bits";
import { Moment } from "./motion";

/* Section 6: four things Aftercall is built not to do. The tests that hold each one sit behind "See the tests" (still in the HTML). */

type Row = { n: string; title: string; body: ReactNode; tests: [string, string][]; note?: string; visual: ReactNode };

const ROWS: Row[] = [
  {
    n: "01",
    title: "No quote from the call, no follow-up.",
    body: "Every follow-up needs an exact quote from the transcript, on whole words. Anything without one is dropped, listed on the meeting page and never acted on. Amounts come from the words spoken, and are kept only when the same value is in the quote.",
    tests: [
      ["keeps what the transcript backs up and drops what it doesn't", "build.test.ts"],
      ["an amount that isn't in the quote is dropped to null", "build.test.ts"],
      ["a quote must start and end on whole words", "transcript.test.ts"],
    ],
    visual: (
      <div className={l.vCard}>
        <p className={l.vDropHead}>
          <b>1 item dropped</b> · no exact quote in the transcript
        </p>
        <p className={l.vDropped}>
          <span>
            Book the launch venue for the demo
            <i className={l.strike} aria-hidden="true" />
          </span>
        </p>
        <p className={l.vReason}>Action item · quote not in the transcript</p>
      </div>
    ),
  },
  {
    n: "02",
    title: "It can't overspend.",
    body: (
      <>
        Payment rules live in a NEAR contract: listed payees, a daily cap and a per-payment cap. The key on your Mac can call only <code>pay</code> and <code>record_proof</code>, and open and release a deal held in escrow
        (built, not yet on testnet); every rule change needs your own wallet. Anything over a cap waits in the contract for your wallet.
      </>
    ),
    tests: [
      ["limited_key_cannot_change_rules", "sandbox.rs"],
      ["one_yocto_rule_holds_even_if_key_lists_owner_methods", "sandbox.rs"],
      ["over_cap_is_blocked_then_owner_approves", "sandbox.rs"],
    ],
    note: "Tested on a local NEAR node. The contract is live on NEAR testnet.",
    visual: (
      <div className={`${l.vCard} ${l.vKey}`}>
        <p className={l.vKeyHead}>This Mac&apos;s key</p>
        <p>
          <span className={l.vKeyLabel}>Can call</span>
          <span className={l.vOk}>pay · record_proof · open_escrow · release_escrow</span>
        </p>
        <p>
          <span className={l.vKeyLabel}>Can&apos;t</span>
          <span className={l.vNo}>raise a cap · add a payee · withdraw · change any rule</span>
        </p>
      </div>
    ),
  },
  {
    n: "03",
    title: "It can't act without your say.",
    body: "Nothing runs until you approve it, with five seconds to undo, unless you set autopilot rules. Autopilot is off until you do, gives you 60 seconds to undo, and never runs anything that was queued when the app closed: that waits for you.",
    tests: [
      ["a queued follow-up read from disk at launch is held for you, never run", "autopilot.test.ts"],
      ["follow_ups_are_saved_as_the_app_sent_them_and_ticks_keep_them", "notes_file.rs"],
    ],
    visual: (
      <div className={l.vCard}>
        <AutopilotLine />
      </div>
    ),
  },
  {
    n: "04",
    title: "It can't show your notes to agents.",
    body: "Connected agents are off by default and only read until you allow claiming and completing. They never send, pay or change rules, and never get your own notes. Each read, claim and refused request is listed on your Mac, with ids, never meeting content.",
    tests: [
      ["your_notes_and_their_salt_never_reach_agents", "agents.rs"],
      ["agents_read_only_by_default_and_are_told_which_switch_to_turn_on", "agents.rs"],
      ["read-only by default: reads work, claim and complete are refused by name", "tools.test.ts"],
    ],
    visual: (
      <div className={`${l.vCard} ${l.vActivity}`}>
        <Face who="CC" size={30} hue={4} />
        <span className={l.vActText}>
          <b>Ship the API fix</b>
          <span>Claude Code · Agents are read-only</span>
        </span>
        <span className={l.vRight}>
          <span className={l.tagCaution}>Refused</span>
          <span className={l.vTime}>14:12</span>
        </span>
      </div>
    ),
  },
];

export function Cant() {
  return (
    <section id="cant" aria-labelledby="cant-h" className={l.section}>
      <div className={l.wrap}>
        <SectionHead
          index="06"
          eyebrow="Limits, enforced in code"
          id="cant-h"
          title="Built so it can't."
          lead={
            <>
              Four things Aftercall is built not to do, each held by code with tests. The spending limits hold even if the app itself is hijacked: they live in a NEAR contract.
            </>
          }
        />
        <ol className={l.cantRows}>
          {ROWS.map((r) => (
            <li key={r.n}>
              <Moment as="article" className={l.cantRow} threshold={0.3} aria-labelledby={`cant-${r.n}`}>
                <div className={l.cantTitle}>
                  <span className={l.numeral} aria-hidden="true">
                    {r.n}
                  </span>
                  <h3 id={`cant-${r.n}`} className={l.h3}>
                    {r.title}
                  </h3>
                </div>
                <div className={l.cantBody}>
                  <p className={l.body}>{r.body}</p>
                  {r.note ? <p className={l.testNote}>{r.note}</p> : null}
                  <details className={l.testsBox}>
                    <summary>
                      See the tests <span className={l.mono}>{r.tests.length}</span>
                    </summary>
                    <ul className={l.tests} aria-label="Tests">
                      {r.tests.map(([t, f], i) => (
                        <li key={t} style={vars({ i })}>
                          <Check size={15} i={i} />
                          <code>{t}</code>
                          <span className={l.testFile}>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
                <div className={l.cantVisual}>{r.visual}</div>
              </Moment>
            </li>
          ))}
        </ol>
        <p className={l.cantFoot} data-reveal="">
          Each of the four maps to tests listed in the repolisted in the README&apos;s What is proven table.apos;s What is proven page.
          {REPO_PUBLIC ? (
            <>
              {" "}
              <a href={`${REPO_URL}/blob/main/docs/proven.md`} className={l.textLink}>
                What is proven
                <span aria-hidden="true"> ↗</span>
              </a>
            </>
          ) : null}
        </p>
      </div>
    </section>
  );
}
