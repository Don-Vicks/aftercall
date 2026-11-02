import { vars } from "../ui";
import l from "../landing.module.css";
import { Face, SectionHead } from "./bits";
import { Moment } from "./motion";

/*
 * Section 7: the agent wallet (WalletScreen.tsx strings). Moment 5: Deposit is pressed,
 * "+25.00 USDC" rises, the balance rolls from 387.50 to 412.50 right to left, and the
 * spent-today bar fills to half. Rendered finished; the roll is CSS on data-state.
 */

const FROM = "387.50";
const TO = "412.50";

function Balance() {
  const digits = TO.split("");
  const order = digits.map((_, i) => digits.slice(i + 1).filter((c) => c !== ".").length);
  return (
    <span className={l.balance}>
      <span className="sr-only">Balance 412.50 USDC</span>
      <span aria-hidden="true" className={l.balanceDigits}>
        {digits.map((c, i) =>
          c === "." ? (
            <span key={i}>.</span>
          ) : (
            <span key={i} className={l.bDigit}>
              <span className={l.bCol} style={vars({ from: Number(FROM[i]), to: Number(c), ri: order[i] })}>
                {"0123456789".split("").map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
              <span className={l.digitSizer}>0</span>
            </span>
          ),
        )}
      </span>
    </span>
  );
}

const POINTS: [string, string][] = [
  ["Over the cap", "A payment over your caps waits in the contract until your own wallet approves or declines it."],
  ["New payee", "Send a single-use claim link, and they say where they want to be paid."],
  ["Autopilot", "Optional. Rules you set, 60 seconds to undo, never more than the per-payment cap."],
];

export function Money() {
  return (
    <section id="money" aria-labelledby="money-h" className={l.section}>
      <div className={l.wrap}>
        <SectionHead
          index="07"
          eyebrow="The agent wallet"
          id="money-h"
          title="Pays what was agreed. Never more than you allow."
          lead="Fund an agent wallet from your own NEAR wallet. Aftercall pays in USDC, only to people on your list, inside a daily cap and a per-payment cap that a NEAR contract holds. Every change to the rules is signed in your wallet."
        />
        <div className={l.moneyGrid}>
          <Moment className={l.walletWell} threshold={0.35} replay replayLabel="Replay deposit">
            <div className={l.wallet} role="group" aria-label="Agent wallet, sample">
              <p className={l.walletTitle}>
                Agent wallet <span className={l.tagMuted}>Sample</span>
              </p>
              <p className={l.walletSub}>Aftercall pays only the people below, within your caps. Every change is signed in your wallet.</p>
              <div className={l.balanceCard}>
                <div className={l.balanceTop}>
                  <div>
                    <p className={l.walletEyebrow}>Balance</p>
                    <p className={l.balanceLine}>
                      <Balance />
                      <span className={l.balanceUnit}>USDC</span>
                    </p>
                  </div>
                  <div className={l.walletButtons} aria-hidden="true">
                    <span className={l.btnOutline}>Withdraw</span>
                    <span className={`${l.btnPrimary} ${l.depositBtn}`}>
                      + Deposit
                      <span className={l.depositChip}>+25.00 USDC</span>
                    </span>
                  </div>
                </div>
                <p className="sr-only">Deposited 25.00 USDC</p>
                <div className={l.spent}>
                  <p>
                    <b>Spent today</b>
                    <span className={l.mono}>
                      50.00 <span className={l.mutedText}>of</span> 100.00
                    </span>
                  </p>
                  <span className={l.spentTrack}>
                    <span className={l.spentFill} />
                  </span>
                  <p className={l.leftToday}>
                    <span className={l.mono}>50.00</span> left today
                  </p>
                </div>
              </div>
              <p className={l.walletSection}>
                Limits <span>signed by you</span>
              </p>
              <div className={l.limitsGrid}>
                <div>
                  <p className={l.limitLabel}>Daily cap</p>
                  <p className={l.limitValue}>
                    100.00 <span>USDC</span>
                  </p>
                  <p className={l.limitHint}>Everything Aftercall pays in a day, together.</p>
                </div>
                <div>
                  <p className={l.limitLabel}>Per payment, for autopilot</p>
                  <p className={l.limitValue}>
                    25.00 <span>USDC</span>
                  </p>
                  <p className={l.limitHint}>Bigger payments wait for you to approve.</p>
                </div>
              </div>
              <p className={l.walletSection}>Payees</p>
              <div className={l.payee}>
                <Face who="D" size={28} hue={5} />
                <span>
                  <b>Designer</b>
                  <span className={l.mono}>designer.near</span>
                </span>
              </div>
            </div>
          </Moment>
          <div className={l.moneyPoints}>
            <ul>
              {POINTS.map(([k, v], i) => (
                <li key={k} data-reveal="" style={vars({ rd: `${200 + i * 60}ms` })}>
                  <span className={l.pointLabel}>{k}</span>
                  <p>{v}</p>
                </li>
              ))}
            </ul>
            <p className={l.status} data-reveal="" style={vars({ rd: "380ms" })}>
              Tested on a local NEAR node; testnet deploy pending. Payments in the sample are simulated.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
