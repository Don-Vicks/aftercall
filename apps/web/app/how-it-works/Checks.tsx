"use client";

import { useState } from "react";
import { Icon, Pill, Tick } from "../ui";
import h from "./how.module.css";

interface Group {
  key: string;
  title: string;
  meta: string;
  where: string;
  means: string;
  cant: string;
  checks: string[];
}

const ALL3 = "gateway, Whisper, Qwen";

/** The checks the pipeline runs (packages/core/src/tee/checks.ts, nvidia.ts), counted for one node per model. */
const BEFORE: Group[] = [
  { key: "tdx", title: "Intel TDX", meta: `6 checks · ${ALL3}`, where: ALL3, means: "Each machine's Intel quote verifies against Intel's collateral, and debug mode is off.", cant: "pass off an ordinary server, or one in debug mode, as secure hardware.", checks: ["Genuine Intel TDX confidential VM", "Debug mode off"] },
  { key: "bind", title: "Key and nonce binding", meta: `6 checks · ${ALL3}`, where: ALL3, means: "The quote holds the TEE's signing key and the nonce your Mac made for this run.", cant: "replay an old quote, or sign with a key made outside the TEE.", checks: ["The TEE made its signing key", "Evidence is fresh"] },
  { key: "boot", title: "Boot log", meta: `3 checks · ${ALL3}`, where: ALL3, means: "Every boot event in the log replays to the RTMR3 value in the quote.", cant: "hide what the machine loaded when it booted.", checks: ["Boot log matches the quote"] },
  { key: "sw", title: "Software", meta: `3 checks · ${ALL3}`, where: ALL3, means: "The sha256 of the TEE's Docker compose matches the mr_config in its quote.", cant: "show one Docker compose while running another.", checks: ["Known software is running"] },
  { key: "gpu", title: "NVIDIA GPUs", meta: "6 checks · Whisper, Qwen", where: "Whisper, Qwen", means: "NVIDIA signs a token for each GPU, with this run's nonce, secure boot on and debug off.", cant: "use a GPU outside confidential mode, or replay old GPU evidence.", checks: ["Genuine NVIDIA confidential GPU", "GPU evidence is fresh", "GPUs in secure mode"] },
];
const AFTER: Group[] = [
  { key: "sig", title: "Response signature", meta: "4 checks · Qwen", where: "Qwen", means: "The Ed25519 signature covers the exact request, response and model, from a key in a verified quote.", cant: "change the notes in transit, or answer from another model or machine.", checks: ["Signed over exactly what was sent", "Signed over exactly what came back", "Signed for the model asked for", "Signed by an attested TEE"] },
  { key: "enc", title: "Encryption", meta: "1 check · Qwen", where: "Qwen", means: "The transcript was encrypted on your Mac to the key in Qwen's verified quote.", cant: "read the transcript at the gateway. It only relays ciphertext.", checks: ["Transcript encrypted to the attested model"] },
];

function Groups({ list, base, open, toggle }: { list: Group[]; base: number; open: Record<string, boolean>; toggle: (k: string) => void }) {
  return (
    <ol className={h.groups}>
      {list.map((g, i) => {
        const isOpen = !!open[g.key];
        return (
          <li key={g.key} className={`${h.group}${isOpen ? ` ${h.open}` : ""} enter`} style={{ ["--d" as string]: `${base + i * 60}ms`, ["--dur" as string]: "280ms" }}>
            <div className={h.groupTitleCol}>
              <button type="button" onClick={() => toggle(g.key)} aria-expanded={isOpen} aria-controls={`checks-${g.key}`} className={`${h.toggle} press`}>
                {g.title}
                <Icon name="chevronRight" size={14} className={h.chev} />
              </button>
              <span className={h.meta}>{g.meta}</span>
            </div>
            <div className={h.groupText}>
              <p className={h.means}>{g.means}</p>
              <p className={h.cant}>
                <Icon name="shield" size={16} stroke={1.9} />
                <span>
                  <strong>So an attacker can&apos;t</strong>
                  {g.cant}
                </span>
              </p>
              {isOpen && (
                <ul id={`checks-${g.key}`} className={h.checkList} aria-label={`${g.title} checks`}>
                  {g.checks.map((label, k) => (
                    <li key={label} className="enter" style={{ ["--d" as string]: `${k * 40}ms`, ["--dur" as string]: "240ms" }}>
                      <Tick size={16} d1={`${k * 40 + 40}ms`} d2={`${k * 40 + 160}ms`} decorative />
                      <span>{label}</span>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {g.where}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** "Checked every time": the 24 checks before sending and 5 on the reply, each group opening to its checks. */
export function Checks() {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState(false);
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  return (
    <>
      <div className={h.checksWrap} style={{ gap: 6 }}>
        <div className={h.groupHead}>
          <h3 className="t-section">
            Before anything leaves your Mac <span className="count">24 checks</span>
          </h3>
          <span className="muted" style={{ fontSize: 12 }}>
            Counted for one node per model; each extra node adds its own set
          </span>
        </div>
        <Groups list={BEFORE} base={80} open={open} toggle={toggle} />
      </div>

      <div className={h.checksWrap} style={{ gap: 6 }}>
        <h3 className="t-section">
          When the notes come back <span className="count">5 checks</span>
        </h3>
        <Groups list={AFTER} base={400} open={open} toggle={toggle} />
      </div>

      <div className={h.checksWrap} style={{ gap: 8 }}>
        <div className={h.failRow}>
          <Icon name="lock" size={18} stroke={1.75} className="accent" />
          <p>
            <span className="ink" style={{ fontWeight: 600 }}>
              If a check fails, it stops there.
            </span>{" "}
            Nothing is sent unless the gateway, every Whisper node and the Qwen node you use all pass.
          </p>
          <button type="button" onClick={() => setFailed((f) => !f)} aria-expanded={failed} aria-controls="failed-example" className="btn btn-secondary press" style={{ height: 34 }}>
            {failed ? "Hide it" : "Show a failed check"}
          </button>
        </div>
        <div id="failed-example" role="status">
          {failed && (
            <div className={`${h.failed} enter`} style={{ ["--dur" as string]: "260ms" }}>
              <Pill tone="record" className={`${h.failedPill} pop`} style={{ ["--d" as string]: "120ms", ["--dur" as string]: "320ms" }} icon={<Icon name="x" size={12} stroke={2.5} />}>
                Failed
              </Pill>
              <span>Secure hardware check failed for Whisper (Boot log matches the quote). Nothing was sent.</span>
              <span className="muted" style={{ fontSize: 12 }}>
                As the app says it
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
