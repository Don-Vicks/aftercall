"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  NETWORK_CONFIG,
  NOT_PROVEN,
  WHISPER_NOTE,
  decodePublicProof,
  droppedLine,
  explorerAccountUrl,
  groupChecks,
  hasStatements,
  isNetwork,
  noticeLine,
  proofHash,
  verifyProof,
  verifyProofGpu,
  type Check,
  type CheckGroup,
  type Jwks,
  type OnChainProof,
  type ProofBundleV2,
  type PublicProof,
  type TeeCheck,
} from "@aftercall/core";
import { CopyButton } from "../client";
import { Icon, Pill, Seal, SiteFooter, SiteHeader, Tick, vars } from "../ui";
import v from "./verify.module.css";

/** NVIDIA publishes its NRAS keys to browsers (CORS allows any origin). */
async function nvidiaKeys(): Promise<Jwks | null> {
  try {
    const res = await fetch("https://nras.attestation.nvidia.com/.well-known/jwks.json");
    return res.ok ? ((await res.json()) as Jwks) : null;
  } catch {
    return null;
  }
}


/** Reads the proof straight from the agent-wallet contract, at final finality. */
async function readProof(p: PublicProof): Promise<OnChainProof | null> {
  const args = btoa(JSON.stringify({ owner: p.owner, meeting_id: p.bundle.meetingId }));
  const res = await fetch(NETWORK_CONFIG[p.network].rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "verify",
      method: "query",
      params: { request_type: "call_function", finality: "final", account_id: p.contract, method_name: "get_proof", args_base64: args },
    }),
  });
  const body = await res.json();
  const err = body.error ?? body.result?.error;
  if (err) {
    const cause = err.cause?.name ?? "";
    if (cause === "UNKNOWN_ACCOUNT") throw new Error(`the contract ${p.contract} doesn't exist on ${p.network}`);
    throw new Error(typeof err === "string" ? err : err.data ?? err.message ?? "unknown error");
  }
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(body.result.result as number[])));
}

type Done = { kind: "done"; proof: PublicProof; checks: Check[]; onChain: OnChainProof | null; rpcError?: string };
type State = { kind: "loading" } | { kind: "missing" } | { kind: "bad-link" } | { kind: "checking"; proof: PublicProof } | Done;

/** Row timing: browser checks tick in 70ms apart, then the recorded groups. */
const rowAt = (i: number) => 140 + i * 70;

export function VerifyClient() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const latest = useRef(0);

  const run = useCallback(async () => {
    const fragment = window.location.hash;
    if (!fragment || fragment.length < 2) return setState({ kind: "missing" });
    let proof: PublicProof;
    try {
      proof = decodePublicProof(fragment);
      if (!proof.bundle || !isNetwork(proof.network)) throw new Error("bad");
    } catch {
      return setState({ kind: "bad-link" });
    }
    const id = ++latest.current;
    setState({ kind: "checking", proof });
    const gpu = verifyProofGpu(proof.bundle, await nvidiaKeys());
    const withGpu = async (checks: Check[]) => {
      const g = await gpu;
      return g ? [...checks, g] : checks;
    };
    let done: Done;
    try {
      const onChain = await readProof(proof);
      done = { kind: "done", proof, onChain, checks: await withGpu(verifyProof(proof.bundle, onChain)) };
    } catch (e) {
      done = { kind: "done", proof, onChain: null, checks: await withGpu(verifyProof(proof.bundle, null)), rpcError: String(e) };
    }
    // A newer run (the link changed, or "Run the checks again") wins.
    if (id === latest.current) setState(done);
  }, []);

  useEffect(() => {
    run();
    window.addEventListener("hashchange", run);
    return () => window.removeEventListener("hashchange", run);
  }, [run]);

  const proof = state.kind === "checking" || state.kind === "done" ? state.proof : null;

  return (
    <>
      <SiteHeader current="verify" />
      <main className={v.main}>
        <div className={v.inner}>
          {state.kind === "loading" && (
            <p className="ink-2" role="status">
              Reading the proof link…
            </p>
          )}
          {state.kind === "missing" && (
            <Message
              title="Open a proof link"
              body="A proof link is what the Copy proof link button copies from a meeting's Verify sheet in the Aftercall app. Everything after its # sign is the proof: hashes, nonces, the models, the checks the app ran, the summary's signature and the NEAR account it belongs to, never what was said. Open one here and your browser reads the proof's hash from NEAR and re-runs the checks it can."
            >
              <span className={v.messageLinks}>
                <a href="/how-it-works" className="arrow-link">
                  How it works
                  <Icon name="arrowRight" size={14} stroke={2.2} />
                </a>
                <a href="/handling" className="arrow-link">
                  How a call is handled
                  <Icon name="arrowRight" size={14} stroke={2.2} />
                </a>
              </span>
            </Message>
          )}
          {state.kind === "bad-link" && <Message title="This link is damaged" body="The proof in the link can't be read. Ask the person who shared it to copy it again from Aftercall." />}
          {proof && <Result proof={proof} done={state.kind === "done" ? state : null} onRerun={run} />}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function Result({ proof, done, onRerun }: { proof: PublicProof; done: Done | null; onRerun: () => void }) {
  const checks = done?.checks ?? [];
  const passed = checks.filter((c) => c.ok).length;
  const recorded: TeeCheck[] | null = proof.bundle.version === 2 ? proof.bundle.checks : null;
  // E2EE has its own line; "processed privately" rests on attestation and signatures.
  const allOk = !!done && passed === checks.length && (recorded ?? []).every((c) => c.ok || c.id === "response-e2ee");
  const dateOpts = { day: "numeric", month: "short", year: "numeric" } as const;
  const when = done?.onChain
    ? new Date(done.onChain.recorded_at / 1e6).toLocaleDateString([], dateOpts)
    : proof.bundle.version === 2
      ? new Date(proof.bundle.checkedAt).toLocaleDateString([], dateOpts)
      : null;
  const hash = proofHash(proof.bundle);
  const sealAt = rowAt(checks.length) + 60;

  const download = () => {
    const blob = new Blob([JSON.stringify(proof, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `aftercall-proof-${proof.bundle.meetingId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <section aria-labelledby="vh" className={`${v.hero} enter`}>
        <div className={v.heroText}>
          <span className="t-eyebrow">
            Meeting proof{when ? ` · ${when}` : ""} · recorded by {proof.owner}
          </span>
          <h1 id="vh" className={v.h1}>
            {!done ? "Checking this meeting proof" : allOk ? "This meeting was processed in secure hardware" : "This proof doesn't fully check out"}
          </h1>
          <span className="ink-2">
            {done && !allOk ? "Some checks failed; the lists below say which, and why. " : ""}This page holds the evidence only, never what was said.
          </span>
          <div className={v.pills} aria-live="polite">
            {done ? (
              <Pill tone={allOk ? "verdigris" : "caution"} className="pop" style={vars({ d: `${sealAt}ms`, dur: "320ms" })} icon={<Icon name={allOk ? "check" : "info"} size={12} stroke={2.5} />}>
                {passed} of {checks.length} passed in your browser
              </Pill>
            ) : (
              <Pill tone="muted" icon={<span aria-hidden="true" className={`spinner ${v.smallSpinner}`} />}>
                Checking
              </Pill>
            )}
          </div>
        </div>
        {(!done || allOk) && (
          <div className={v.sealBox}>
            <svg viewBox="0 0 148 148" aria-hidden="true">
              <circle cx="74" cy="74" r="70" fill="none" strokeWidth="1.5" strokeDasharray="3 6" stroke="var(--border)" opacity=".6" />
            </svg>
            {allOk && (
              <div role="img" aria-label="Verified" className="pop" style={vars({ d: `${sealAt}ms`, dur: "460ms", "pop-ease": "cubic-bezier(.3,1.4,.5,1)" })}>
                <Seal id="verify-seal" fine />
              </div>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="vb" className={v.block}>
        <div className={v.blockHead}>
          <h2 id="vb" className="t-section">
            Re-checked in your browser <span className="count">{done ? "just now, from NEAR and the link" : "from NEAR and the link"}</span>
          </h2>
          {done && <span>{checks.length} checks</span>}
        </div>
        {done ? (
          <ol className={v.list}>
            {checks.map((c, i) => (
              <CheckRow key={c.id} check={c} at={rowAt(i)} />
            ))}
          </ol>
        ) : (
          <div role="status" className={`${v.status} enter`} style={vars({ dur: "240ms" })}>
            <span aria-hidden="true" className="spinner" />
            Reading the proof from NEAR and checking it in your browser…
          </div>
        )}
        {done?.rpcError && <p style={{ color: "var(--caution)", overflowWrap: "anywhere" }}>Couldn&apos;t read NEAR: {done.rpcError.replace(/^Error: /, "")}</p>}
      </section>

      {recorded ? (
        <Recorded key={hash} proof={proof} recorded={recorded} start={done ? checks.length : 0} />
      ) : (
        <p className="ink-2">This proof was made before Aftercall verified attestation quotes. The app checked the signature and that attestation evidence came back with a fresh nonce.</p>
      )}

      {/* Proofs made before the app kept these have none: an empty notice there means "not kept", not "nobody was told". */}
      {hasStatements(proof.bundle) && <Statements bundle={proof.bundle} />}

      <section aria-label="On-chain proof" className={`${v.onChain} enter`} style={vars({ d: "120ms" })}>
        <div className={v.onChainTop}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
            <Icon name="chain" size={16} stroke={1.75} className="accent" />
            {done && !done.onChain ? "Proof hash" : "Proof on NEAR"}
          </span>
          <span className="mono" title={hash} style={{ fontSize: 13 }}>
            {hash.slice(0, 12)}…{hash.slice(-10)}
          </span>
          <CopyButton text={hash} label="Copy proof hash" />
          <a href={explorerAccountUrl(proof.network, proof.contract)} target="_blank" rel="noreferrer" className="arrow-link">
            View on NEAR Explorer
            <Icon name="external" size={13} />
          </a>
        </div>
        <div className={v.onChainMeta}>
          <span>
            Contract{" "}
            <span className="mono ink" style={{ overflowWrap: "anywhere" }}>
              {proof.contract}
            </span>
          </span>
          <span className="muted">·</span>
          <span>{proof.network}</span>
          <span className="muted">·</span>
          <span>
            Recorded by <span className="mono ink">{proof.owner}</span>
          </span>
          <span className="muted">·</span>
          <button type="button" onClick={download} className="link-button" style={{ fontSize: 13 }}>
            Download bundle (JSON)
          </button>
        </div>
      </section>

      <section aria-labelledby="vn" className={`${v.block} enter`} style={vars({ d: "160ms" })}>
        <h2 id="vn" className="t-section">
          What this does not prove <span className="count">read this too</span>
        </h2>
        <ul className={v.notProven}>
          {[
            ...NOT_PROVEN,
            recorded
              ? "That the Intel quotes were genuine: the app verified them with Intel when the meeting was processed; this page trusts that record and re-checks what it can."
              : "That the secure-hardware evidence itself is genuine: the app checked it was present and fresh when the meeting was processed; this page trusts that record.",
          ].map((n) => {
            const cut = n.indexOf(": ");
            return (
              <li key={n}>
                {cut > 0 ? (
                  <>
                    <strong>{n.slice(0, cut + 1)}</strong>
                    {n.slice(cut + 1)}
                  </>
                ) : (
                  n
                )}
              </li>
            );
          })}
        </ul>
        <a href="/handling" className="arrow-link" style={{ alignSelf: "flex-start", marginTop: 4 }}>
          How a call is handled
          <Icon name="arrowRight" size={14} stroke={2.2} />
        </a>
      </section>

      <div className={v.foot}>
        <button type="button" onClick={onRerun} disabled={!done} className="btn btn-secondary press">
          <Icon name="refresh" size={14} />
          Run the checks again
        </button>
        <a href="/" style={{ fontWeight: 600 }}>
          What is Aftercall?
        </a>
      </div>
    </>
  );
}

/** One check, ticking in at `at` ms. */
function CheckRow({ check: c, at }: { check: Check | TeeCheck; at: number }) {
  return (
    <li className={`${v.row} enter`} style={vars({ d: `${at}ms`, dur: "280ms" })}>
      <Tick ok={c.ok} d1={`${at + 60}ms`} d2={`${at + 180}ms`} />
      <span className={v.label}>{c.label}</span>
      <span className={`${v.detail}${c.ok ? "" : ` ${v.failedDetail}`}`} title={c.detail}>
        <Detail text={c.detail} />
      </span>
    </li>
  );
}

/** Hashes, keys, model names and times in a check's detail are set in mono. */
function Detail({ text }: { text: string }) {
  const parts = text.split(/((?:0x)?[0-9a-f]{10,}…?(?:[0-9a-f]{4,})?|\b(?:Qwen|openai)\/[\w.-]+|\d{4}-\d{2}-\d{2} \d{2}:\d{2}|\b\d{2}:\d{2} UTC)/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="mono">
            {p}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

const GROUP_DETAIL: Record<CheckGroup["key"], (g: CheckGroup) => string> = {
  gateway: () => "Intel TDX quote, debug off, key and nonce, boot log, software",
  whisper: (g) => `The same CPU checks${g.checks.some((c) => /GPU/.test(c.label)) ? ", plus NVIDIA GPU evidence" : ""}`,
  summary: (g) => `The same checks${g.checks.some((c) => /GPU/.test(c.label)) ? ", plus NVIDIA GPU evidence" : ""}`,
  response: () => "Signed over exactly what was sent and what came back",
};

/** The app's own checks from the proof, grouped as the Mac's Verify sheet shows them. */
function Recorded({ proof, recorded, start }: { proof: PublicProof; recorded: TeeCheck[]; start: number }) {
  const groups = groupChecks(recorded, proof.bundle);
  // Groups with a failure start open, so nothing that failed is hidden behind a click.
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(groups.map((g) => [g.key, g.checks.some((c) => !c.ok)])));
  const checkedAt =
    proof.bundle.version === 2 ? new Date(proof.bundle.checkedAt).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <section aria-labelledby="vr" className={v.block}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className={v.blockHead}>
          <h2 id="vr" className="t-section">
            As recorded by the app <span className="count">on the Mac, {checkedAt}</span>
          </h2>
          <span>{recorded.length} checks</span>
        </div>
        <div className={v.whyLine}>
          <span>Your browser can&apos;t repeat the Intel quote check, so these are shown as the app ran them.</span>
          <details className="why">
            <summary>Why?</summary>
            <span className="why-body" style={{ display: "block", marginTop: 6 }}>
              Intel&apos;s collateral service doesn&apos;t accept browser requests, and the quotes aren&apos;t in the link. The checks above re-use the values the app read from them.
            </span>
          </details>
        </div>
      </div>

      <div className={v.groups}>
        {groups.map((g, j) => {
          const at = rowAt(start + j);
          const failed = g.checks.filter((c) => !c.ok);
          const isOpen = !!open[g.key];
          return (
            <div key={g.key} className={`${v.group}${isOpen ? ` ${v.groupOpen}` : ""} enter`} style={vars({ d: `${at}ms`, dur: "280ms" })}>
              <button type="button" onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))} aria-expanded={isOpen} aria-controls={`group-${g.key}`} className={v.groupButton}>
                <Tick ok={failed.length === 0} label={failed.length === 0 ? "All passed" : "Some failed"} d1={`${at + 60}ms`} d2={`${at + 180}ms`} />
                <span className={v.groupTitle}>
                  <span>{g.title}</span>
                  <span>{failed.length === 0 ? `${g.checks.length} passed` : `${failed.length} of ${g.checks.length} failed`}</span>
                </span>
                <span className={v.detail}>{failed.length ? `Failed: ${failed.map((c) => c.label).join(", ")}` : GROUP_DETAIL[g.key](g)}</span>
                <Icon name="chevronRight" size={16} className={v.chev} />
              </button>
              {isOpen && (
                <div id={`group-${g.key}`} className={v.groupBody}>
                  <ul className={v.subList}>
                    {g.checks.map((c, k) => (
                      <li key={c.id} className={`${v.subRow} enter`} style={vars({ d: `${k * 40}ms`, dur: "240ms" })}>
                        <Tick ok={c.ok} size={16} d1={`${k * 40 + 40}ms`} d2={`${k * 40 + 160}ms`} />
                        <span className={v.label}>{c.label}</span>
                        <span className={`${v.detail}${c.ok ? "" : ` ${v.failedDetail}`}`} title={c.detail}>
                          <Detail text={c.detail} />
                        </span>
                      </li>
                    ))}
                  </ul>
                  {g.key === "whisper" && <p className={v.note}>{WHISPER_NOTE}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * What the app wrote into the proof as statements: the items it dropped and the notice
 * the person who recorded logged. The hash on NEAR covers them, but nobody can re-run
 * them from the link (the transcript isn't in it), so they get a note mark, not a tick.
 */
function Statements({ bundle }: { bundle: ProofBundleV2 }) {
  const dropped = droppedLine(bundle);
  const rows: [string, string][] = [
    ...(dropped ? ([["Items without a quote", dropped]] as [string, string][]) : []),
    ["Notice before recording", noticeLine(bundle.notice)],
  ];
  return (
    <section aria-labelledby="vs" className={`${v.block} enter`} style={vars({ d: "100ms" })}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 id="vs" className="t-section">
          Stated in the proof <span className="count">not re-run</span>
        </h2>
        <p className="ink-2" style={{ maxWidth: 640 }}>
          The app wrote these into the proof when it made the notes. The proof hash covers them, so if it matches NEAR they haven&apos;t changed since. They aren&apos;t checks: the transcript isn&apos;t in the link, so nobody can re-run them.
        </p>
      </div>
      <ul className={v.statements}>
        {rows.map(([label, text]) => (
          <li key={label} className={v.statement}>
            <span className={v.statementMark}>
              <Icon name="note" size={13} stroke={1.75} />
            </span>
            <span className={v.label}>{label}</span>
            <span className={v.statementText}>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Message({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className={`${v.message} enter`}>
      <h1 className="t-display">{title}</h1>
      <p>{body}</p>
      {children}
    </div>
  );
}
