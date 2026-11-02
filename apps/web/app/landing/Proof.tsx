import { CopyButton } from "../client";
import { vars } from "../ui";
import l from "../landing.module.css";
import { Check, SectionHead } from "./bits";
import { Moment } from "./motion";

/*
 * Section 6: the receipt in full. Check labels verbatim from packages/core/src/tee/checks.ts,
 * nvidia.ts and pipeline.ts. The live run is stated, not linked: its proof isn't on NEAR.
 */

const TDX = ["Genuine Intel TDX confidential VM", "Debug mode off", "The TEE made its signing key", "Evidence is fresh", "Boot log matches the quote", "Known software is running"];
const GPU = ["Genuine NVIDIA confidential GPU", "GPU evidence is fresh", "GPUs in secure mode"];
const GROUPS: { name: string; n: number; checks: string[]; extra?: string }[] = [
  { name: "Gateway TEE", n: 6, checks: TDX },
  { name: "Whisper TEE", n: 9, checks: GPU, extra: "The six above, plus" },
  { name: "Qwen TEE", n: 9, checks: GPU, extra: "The six above, plus" },
  {
    name: "Signed reply",
    n: 5,
    checks: ["Transcript encrypted to the attested model", "Signed over exactly what was sent", "Signed over exactly what came back", "Signed for the model asked for", "Signed by an attested TEE"],
  },
];

const COMMANDS: [string, string][] = [
  [
    "pnpm install && pnpm verify --quick",
    "Typechecks every package and runs 269 core, 28 backend and 20 MCP server tests, the desktop Rust tests and the contract's unit tests. Nothing calls NEAR AI.",
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
          index="06"
          eyebrow="The receipt"
          id="proof-h"
          title="Checked by name, every run."
          lead="These are the checks your Mac runs on NEAR AI's secure hardware for each recording. The Verify sheet lists them for every meeting, and the proof's hash goes in a NEAR contract so anyone with the link can re-run the checks in a browser at /verify."
        >
          <p className={l.status}>Proof recording is tested on a local NEAR node; testnet deploy pending.</p>
        </SectionHead>
        <div className={l.proofGrid}>
          <div className={l.checksCol}>
            <Moment className={l.groups} threshold={0.2}>
              {GROUPS.map((g, gi) => (
                <div key={g.name} className={l.group}>
                  <p className={l.groupHead}>
                    {g.name} <span>{g.n}</span>
                  </p>
                  {g.extra ? <p className={l.groupExtra}>{g.extra}</p> : null}
                  <ul>
                    {g.checks.map((c, i) => (
                      <li key={c} style={vars({ i: gi * 3 + i })}>
                        <Check size={15} i={gi * 3 + i} />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </Moment>
            <p className={l.small} data-reveal="">
              24 before anything is sent, 5 on the reply, with one node per model. If any of the first 24 fails, nothing leaves your Mac.
            </p>
            <p className={l.caveat} data-reveal="">
              Audio goes over TLS through the checked gateway, not end-to-end encrypted; the transcript is end-to-end encrypted or not sent.
            </p>
          </div>

          <div className={l.runCol}>
            <div className={l.liveCard} data-reveal="">
              <p className={l.liveHead}>
                <span className={l.liveDot} aria-hidden="true" />
                Ran live once
              </p>
              <p>
                On 1 Nov 2026 the Mac app made notes from a sample call on live NEAR AI Cloud. All 29 checks passed, with one node per model. That run&apos;s proof isn&apos;t on NEAR yet, so it can&apos;t be
                re-checked from outside.
              </p>
            </div>
            <div data-reveal="" style={vars({ rd: "60ms" })}>
              <h3 className={l.h4}>Check it in five minutes</h3>
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
