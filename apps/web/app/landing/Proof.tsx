import { CopyButton } from "../client";
import { REPO_PUBLIC } from "../site";
import { vars } from "../ui";
import l from "../landing.module.css";
import { Check, SectionHead } from "./bits";
import { SealMark } from "./Hero";
import { Moment } from "./motion";

/*
 * Section 7: check it yourself. The seal and the four check groups (moment 4 again, as a
 * band), the full list by name behind a disclosure (labels verbatim from
 * packages/core/src/tee/checks.ts, nvidia.ts and pipeline.ts), the one live run, the two
 * commands and what it can't prove. The live run is stated, not linked: its proof isn't on NEAR.
 */

const TDX = ["Genuine Intel TDX confidential VM", "Debug mode off", "The TEE made its signing key", "Evidence is fresh", "Boot log matches the quote", "Known software is running"];
const GPU = ["Genuine NVIDIA confidential GPU", "GPU evidence is fresh", "GPUs in secure mode"];
const GROUPS: { name: string; n: number; checks: string[]; extra?: string }[] = [
  { name: "Gateway TEE", n: 6, checks: TDX },
  { name: "Whisper TEE", n: 9, checks: GPU, extra: "The gateway's six, plus" },
  { name: "Qwen TEE", n: 9, checks: GPU, extra: "The gateway's six, plus" },
  {
    name: "On the reply",
    n: 5,
    checks: ["Transcript encrypted to the attested model", "Signed over exactly what was sent", "Signed over exactly what came back", "Signed for the model asked for", "Signed by an attested TEE"],
  },
];

const COMMANDS: [string, string][] = [
  [
    "pnpm install && pnpm verify --quick",
    "Typechecks every package and runs 272 core, 28 backend and 20 MCP server tests, the desktop Rust tests and the contract's unit tests. Nothing calls NEAR AI.",
  ],
  ["pnpm dev:ui", "The whole Mac interface in a browser at localhost:1420, on the sample meeting. Recording is simulated there."],
];

const LIMITS = [
  "The transcript can mishear; a quote is checked against what Whisper wrote.",
  "Transcriptions aren't signed per response.",
  "The notice to others is your statement.",
  "What NEAR AI keeps is set by NEAR AI's policy.",
];

export function Proof() {
  return (
    <section id="proof" aria-labelledby="proof-h" className={l.section}>
      <div className={l.wrap}>
        <SectionHead
          index="07"
          eyebrow="Check it yourself"
          id="proof-h"
          title="Checked by name, every run."
          lead="Your Mac runs these checks on NEAR AI's secure hardware for every recording, and the Verify sheet lists them for each meeting. A proof's hash goes in a NEAR contract, so anyone with the link can re-check it in a browser at /verify; what a browser can't re-run is marked as recorded by the app."
        >
          <p className={l.status}>Proof recording is tested on a local NEAR node; testnet deploy pending.</p>
        </SectionHead>
        <div className={l.proofGrid}>
          <Moment className={l.proofBand} threshold={0.4} role="group" aria-labelledby="band-h">
            <div className={l.bandTop}>
              <SealMark size={88} id="seal-proof" />
              <div>
                <p id="band-h" className={l.bandTitle}>
                  29 checks with one node per model
                </p>
                <p className={l.bandSub}>24 before anything is sent. If the gateway or Whisper fails, or no Qwen node passes, nothing leaves your Mac. 5 more on the reply.</p>
              </div>
            </div>
            <ul className={l.bandChips}>
              {GROUPS.map((g, i) => (
                <li key={g.name} style={vars({ i })}>
                  <Check size={16} i={i} />
                  <span>{g.name}</span>
                  <span className={l.mono}>{g.n}</span>
                </li>
              ))}
            </ul>
            <details className={l.allChecks}>
              <summary>See every check by name</summary>
              <div className={l.groups}>
                {GROUPS.map((g) => (
                  <div key={g.name} className={l.group}>
                    <p className={l.groupHead}>
                      {g.name} <span>{g.n}</span>
                    </p>
                    {g.extra ? <p className={l.groupExtra}>{g.extra}</p> : null}
                    <ul>
                      {g.checks.map((c) => (
                        <li key={c}>
                          <Check size={14} />
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
            <p className={l.bandCaveat}>Audio goes over TLS through the checked gateway and isn&apos;t end-to-end encrypted. The transcript is end-to-end encrypted to the checked model, or not sent.</p>
          </Moment>

          <div className={l.runCol}>
            <div className={l.liveCard} data-reveal="">
              <p className={l.liveHead}>
                <span className={l.liveDot} aria-hidden="true" />
                Ran live once
              </p>
              <p>
                On 1 Nov 2026 the Mac app made notes from another sample call, a designer kickoff, on live NEAR AI Cloud. All 29 checks passed, with one node per model. That run&apos;s proof isn&apos;t on NEAR
                yet, so it can&apos;t be re-checked from outside.
              </p>
            </div>
            <div data-reveal="" style={vars({ rd: "60ms" })}>
              <h3 className={l.h4}>{REPO_PUBLIC ? "Check it in five minutes" : "Check it in five minutes, once the source opens"}</h3>
              <ul className={l.commands}>
                {COMMANDS.map(([cmd, what]) => (
                  <li key={cmd}>
                    <div className={l.cmd}>
                      <code>{cmd}</code>
                      <CopyButton text={cmd} label={`Copy ${cmd}`} />
                    </div>
                    <p>{what}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div data-reveal="" style={vars({ rd: "120ms" })}>
              <h3 className={l.h4}>What it can&apos;t prove</h3>
              <ul className={l.limits}>
                {LIMITS.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <a href="/handling" className={l.textLink}>
                How a call is handled, step by step <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
