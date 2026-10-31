"use client";

import { useCallback, useEffect, useState } from "react";
import {
  NETWORK_CONFIG,
  NOT_PROVEN,
  WHISPER_NOTE,
  decodePublicProof,
  explorerAccountUrl,
  groupChecks,
  isNetwork,
  proofHash,
  verifyProof,
  verifyProofGpu,
  type Check,
  type Jwks,
  type OnChainProof,
  type PublicProof,
  type TeeCheck,
} from "@aftercall/core";

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

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "bad-link" }
  | { kind: "done"; proof: PublicProof; checks: Check[]; onChain: OnChainProof | null; rpcError?: string };

export function VerifyClient() {
  const [state, setState] = useState<State>({ kind: "loading" });

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
    setState({ kind: "loading" });
    const gpu = verifyProofGpu(proof.bundle, await nvidiaKeys());
    const withGpu = async (checks: Check[]) => {
      const g = await gpu;
      return g ? [...checks, g] : checks;
    };
    try {
      const onChain = await readProof(proof);
      setState({ kind: "done", proof, onChain, checks: await withGpu(verifyProof(proof.bundle, onChain)) });
    } catch (e) {
      setState({ kind: "done", proof, onChain: null, checks: await withGpu(verifyProof(proof.bundle, null)), rpcError: String(e) });
    }
  }, []);

  useEffect(() => {
    run();
    window.addEventListener("hashchange", run);
    return () => window.removeEventListener("hashchange", run);
  }, [run]);

  return (
    <div style={{ minHeight: "100vh" }}>
      <header style={{ maxWidth: 880, margin: "0 auto", padding: 24, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo />
          <span className="serif" style={{ fontSize: 20, fontWeight: 500 }}>Aftercall</span>
        </span>
        <span className="mono muted" style={{ fontSize: 12 }}>
          {state.kind === "done" ? `proof ${proofHash(state.proof.bundle).slice(0, 4)}…${proofHash(state.proof.bundle).slice(-4)}` : "verify"}
        </span>
      </header>

      <main style={{ maxWidth: 880, margin: "0 auto", padding: "40px 24px 80px", display: "flex", flexDirection: "column", gap: 36 }}>
        {state.kind === "loading" && <p className="muted">Reading the proof from NEAR and checking it in your browser…</p>}
        {state.kind === "missing" && <Message title="Open a proof link" body="This page checks a meeting proof shared from the Aftercall app. The link carries the evidence after the # sign." />}
        {state.kind === "bad-link" && <Message title="This link is damaged" body="The proof in the link can't be read. Ask the person who shared it to copy it again from Aftercall." />}
        {state.kind === "done" && <Result state={state} onRerun={run} />}
      </main>
    </div>
  );
}

function Result({ state, onRerun }: { state: Extract<State, { kind: "done" }>; onRerun: () => void }) {
  const { proof, checks, onChain } = state;
  const passed = checks.filter((c) => c.ok).length;
  const recorded: TeeCheck[] | null = proof.bundle.version === 2 ? proof.bundle.checks : null;
  // E2EE has its own line; "processed privately" rests on attestation and signatures.
  const allOk = passed === checks.length && (recorded ?? []).every((c) => c.ok || c.id === "response-e2ee");
  const when = onChain ? new Date(onChain.recorded_at / 1e6).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : null;

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
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <span
          className="label"
          style={{
            alignSelf: "flex-start",
            display: "inline-flex",
            alignItems: "center",
            minHeight: 26,
            padding: "4px 11px",
            borderRadius: 999,
            background: allOk ? "var(--verdigris-tint)" : "var(--caution-tint)",
            color: allOk ? "var(--verdigris)" : "var(--caution)",
          }}
        >
          {passed} of {checks.length} checks passed in your browser
        </span>
        <h1 className="serif" style={{ margin: 0, fontSize: 44, lineHeight: "50px", fontWeight: 500, letterSpacing: "-0.02em" }}>
          {allOk ? "This meeting was processed privately." : "This proof doesn't fully check out."}
        </h1>
        <p className="serif muted" style={{ margin: 0, maxWidth: 640, fontSize: 19, lineHeight: "30px" }}>
          {allOk
            ? `A meeting recorded with Aftercall${when ? ` on ${when}` : ""} was summarised inside attested secure hardware on NEAR AI Cloud. This page holds no meeting content, only the evidence. Your browser has just re-checked what it can; the rest is shown as the app recorded it.`
            : "Some checks failed. The list below says which, and why. This page holds no meeting content."}
        </p>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 className="label" style={{ margin: 0 }}>Re-checked in your browser</h2>
        <CheckList checks={checks} />
      </section>

      {recorded ? (
        <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h2 className="label" style={{ margin: 0 }}>As recorded by the app</h2>
            <p className="muted" style={{ margin: 0, maxWidth: 680 }}>
              The app ran these on the Mac when the meeting was processed{proof.bundle.version === 2 ? `, ${new Date(proof.bundle.checkedAt).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}. Your
              browser can&apos;t repeat the Intel quote check: Intel&apos;s collateral service doesn&apos;t accept browser requests, and the quotes aren&apos;t in the link.
              The checks above re-use the values the app read from them.
            </p>
          </div>
          {groupChecks(recorded, proof.bundle).map((g) => (
            <div key={g.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{g.title}</h3>
              <CheckList checks={g.checks} />
              {g.key === "whisper" && <p className="muted" style={{ margin: "8px 0 0" }}>{WHISPER_NOTE}</p>}
            </div>
          ))}
        </section>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          This proof was made before Aftercall verified attestation quotes. The app checked the signature and that attestation evidence came back with a fresh nonce.
        </p>
      )}

      {state.rpcError && <p style={{ margin: 0, color: "var(--caution)", overflowWrap: "anywhere" }}>Couldn't read NEAR: {state.rpcError.replace(/^Error: /, "")}</p>}

      <dl className="facts" style={{ margin: 0, display: "grid", gridTemplateColumns: "160px minmax(0, 1fr)", gap: "12px 20px", padding: "20px 24px", borderRadius: 10, background: "var(--well)" }}>
        <dt className="label" style={{ lineHeight: "22px" }}>Proof hash</dt>
        <dd className="mono" style={{ margin: 0, wordBreak: "break-all" }}>{proofHash(proof.bundle)}</dd>
        <dt className="label" style={{ lineHeight: "22px" }}>Contract</dt>
        <dd style={{ margin: 0 }}>
          <a className="mono" href={explorerAccountUrl(proof.network, proof.contract)} target="_blank" rel="noreferrer">
            {proof.contract}
          </a>{" "}
          <span className="muted">· {proof.network}</span>
        </dd>
        <dt className="label" style={{ lineHeight: "22px" }}>Recorded by</dt>
        <dd className="mono" style={{ margin: 0 }}>{proof.owner}</dd>
        <dt className="label" style={{ lineHeight: "22px" }}>Raw evidence</dt>
        <dd style={{ margin: 0 }}>
          <button onClick={download} style={{ border: 0, padding: 0, background: "none", color: "var(--verdigris)", fontWeight: 600, fontSize: 14 }}>
            Download bundle (JSON)
          </button>
        </dd>
      </dl>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 className="label" style={{ margin: 0 }}>What this does not prove</h2>
        <ul className="muted" style={{ margin: 0, paddingLeft: 20 }}>
          {NOT_PROVEN.map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>
            {recorded
              ? "That the Intel quotes were genuine: the app verified them with Intel when the meeting was processed; this page trusts that record and re-checks what it can."
              : "That the secure-hardware evidence itself is genuine: the app checked it was present and fresh when the meeting was processed; this page trusts that record."}
          </li>
        </ul>
      </section>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, paddingTop: 24, borderTop: "1px solid var(--hairline)" }}>
        <button onClick={onRerun} style={{ height: 40, padding: "0 18px", border: "1px solid var(--border)", borderRadius: 6, background: "transparent", color: "var(--ink)", fontSize: 14, fontWeight: 600 }}>
          Run the checks again
        </button>
        <a href="/">What is Aftercall?</a>
      </div>
    </>
  );
}

function CheckList({ checks }: { checks: (Check | TeeCheck)[] }) {
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {checks.map((c, i) => (
        <li
          key={c.id}
          style={{
            display: "grid",
            gridTemplateColumns: "28px minmax(0, 1fr)",
            gap: 12,
            padding: "16px 0",
            borderTop: "1px solid var(--hairline)",
            borderBottom: i === checks.length - 1 ? "1px solid var(--hairline)" : undefined,
          }}
        >
          <span aria-label={c.ok ? "Passed" : "Failed"} style={{ color: c.ok ? "var(--verdigris)" : "var(--caution)", fontWeight: 600 }}>
            {c.ok ? "✓" : "✕"}
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontWeight: 600 }}>{c.label}</span>
            <span className="muted" style={{ overflowWrap: "anywhere" }}>{c.detail}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h1 className="serif" style={{ margin: 0, fontSize: 40, lineHeight: "46px", fontWeight: 500 }}>{title}</h1>
      <p className="serif muted" style={{ margin: 0, fontSize: 19, lineHeight: "30px", maxWidth: 640 }}>{body}</p>
    </div>
  );
}

function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="115" fill="#24221e" />
      <rect x="128" y="92" width="256" height="328" rx="28" fill="#ede9e1" />
      <g fill="#24221e">
        <rect x="167" y="200" width="28" height="80" rx="14" />
        <rect x="214" y="160" width="28" height="160" rx="14" />
        <rect x="261" y="185" width="28" height="110" rx="14" />
        <rect x="308" y="205" width="28" height="70" rx="14" />
      </g>
      <circle cx="378" cy="398" r="56" fill="#24221e" />
      <circle cx="378" cy="398" r="44" fill="#8dbfa8" />
    </svg>
  );
}
