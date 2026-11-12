import type { ModelAttestation, VerifiedTee } from "../tee/attest.ts";
import type { TeeCheck } from "../tee/checks.ts";
import type { Check } from "../notes/proof.ts";
import type { ProofFetch } from "../notes/proofLink.ts";
import { functionCallArgs, lockState, type ContractEvidence, type KeyPermission, type ProofEvidence, type TxStatus } from "./evidence.ts";
import { isOutageStatus, serviceUnavailable, unavailableIn } from "./outage.ts";

/**
 * The decisions behind `pnpm check:live` (packages/core/scripts/check-live.ts), apart from
 * the network: how each check's result reads, when a failure is a service being down
 * rather than a claim being false, and the summary. Node only.
 */

/** pass, fail (a claim doesn't hold), unavailable (a service was down, so it couldn't be checked), or cantRecheck (it can never be re-run). */
export type Outcome = "pass" | "fail" | "unavailable" | "cantRecheck";

export interface Line {
  outcome: Outcome;
  text: string;
  detail?: string;
  /** 1 for a detail under the line above it: shown, but not counted on its own. */
  depth?: 0 | 1;
}

export interface Outage {
  service: string;
  error: string;
}

/** A read that worked, a service that was down, or an answer that is itself the problem. */
export type Fetched<T> = { value: T } | { unavailable: Outage } | { error: string };

export const MARK: Record<Outcome, string> = { pass: "✓", fail: "✗", unavailable: "○", cantRecheck: "–" };

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error: /, "");

/** An error as a Fetched: SERVICE_UNAVAILABLE becomes `unavailable`, anything else an error. */
export function fromError<T>(e: unknown): Fetched<T> {
  const text = errorText(e);
  const down = unavailableIn(text);
  return down ? { unavailable: down } : { error: text };
}

const down = (o: Outage) => `service unavailable (${o.service}): ${o.error}`;

export function formatLine(l: Line, indent = "    "): string {
  return `${indent}${l.depth ? "    " : ""}${MARK[l.outcome]} ${l.text}${l.detail ? ` · ${l.detail}` : ""}`;
}

// ---------- 1. attestation ----------

/** Couldn't get NVIDIA's keys: the GPU check's own words for it (nvidia.ts). */
const NO_NVIDIA_KEYS = "Couldn't get NVIDIA's signing keys";
const isGpuCheck = (id: string) => /-gpu(-nonce|-secure)?(-\d+)?$/.test(id);

/**
 * One TEE's checks as lines. Every CPU check needs the Intel quote verified, so when Intel's
 * collateral service was down they couldn't run; the GPU checks need NVIDIA NRAS and NVIDIA's
 * keys. Any other failure is a failure.
 */
export function teeLines(checks: TeeCheck[], nvidiaKeysOutage: Outage | null): Line[] {
  const tdx = checks.find((c) => /-tdx(-\d+)?$/.test(c.id));
  const intel = tdx && !tdx.ok ? unavailableIn(tdx.detail) : null;
  const gpu = checks.find((c) => /-gpu(-\d+)?$/.test(c.id));
  const nvidia = gpu && !gpu.ok ? (unavailableIn(gpu.detail) ?? (gpu.detail === NO_NVIDIA_KEYS ? nvidiaKeysOutage : null)) : null;
  return checks.map((c): Line => {
    if (c.ok) return { outcome: "pass", text: c.label, detail: c.caution ? `${c.detail} (caution)` : c.detail };
    const outage = isGpuCheck(c.id) ? nvidia : intel;
    return outage ? { outcome: "unavailable", text: c.label, detail: down(outage) } : { outcome: "fail", text: c.label, detail: c.detail };
  });
}

/** When NEAR AI's report itself couldn't be read: down, asking for a key now (not a README claim), or a real failure. */
export function attestationErrorLine(what: string, e: unknown): Line {
  const text = errorText(e);
  const outage = unavailableIn(text);
  if (outage) return { outcome: "unavailable", text: what, detail: down(outage) };
  if (/^NEAR AI 40[13]\b/.test(text)) return { outcome: "unavailable", text: what, detail: `NEAR AI now asks for an API key for its attestation report, and this check uses none (${text})` };
  return { outcome: "fail", text: what, detail: text };
}

/** The app's last rule before anything is sent: a verified summary node whose E2EE key is the key bound in its quote. */
export function e2eeLine(node: VerifiedTee | undefined, summaryLines: Line[]): Line {
  const text = "An attested summary node offers its end-to-end encryption key";
  if (node) return { outcome: "pass", text, detail: `Ed25519 key ${node.evidence.signingAddress.slice(0, 10)}…, the signing key bound in its quote: the app would encrypt the transcript to it` };
  if (summaryLines.some((l) => l.outcome === "unavailable")) return { outcome: "unavailable", text, detail: "the summary model's checks couldn't all run" };
  return { outcome: "fail", text, detail: "No verified summary node offers a key bound in its quote, so the app would send nothing" };
}

/** Every TEE's lines for one model, a failing line when NEAR AI returned none. */
export function modelLines(a: ModelAttestation, nvidiaKeysOutage: Outage | null): { title: string; lines: Line[] }[] {
  if (a.nodes.length === 0) return [{ title: a.model, lines: [{ outcome: "fail", text: "Model attestation returned", detail: "NEAR AI returned no TEE for this model" }] }];
  return a.nodes.map((n, i) => ({
    title: `${a.model}${a.nodes.length > 1 ? ` node ${i + 1}` : ""} (${a.algo}, fresh nonce ${a.nonce.slice(0, 8)}…)`,
    lines: teeLines(n.checks, nvidiaKeysOutage),
  }));
}

// ---------- 2. transactions: NEAR's RPC ----------

export const ARCHIVAL_RPC = ["https://archival-rpc.testnet.fastnear.com", "https://archival-rpc.testnet.near.org"];

/** NEAR RPC errors that are about the node, not the request. */
const RPC_OUTAGES = new Set(["INTERNAL_ERROR", "TIMEOUT_ERROR", "NO_SYNCED_BLOCKS", "NOT_SYNCED_YET"]);

export type Rpc = <T>(method: string, params: Record<string, unknown>) => Promise<T>;

/**
 * JSON-RPC over `endpoints`, in order, twice: a network error, a 408, 429 or 5xx, an answer
 * that isn't JSON or a node-side error moves on to the next. When every try was like that it
 * rejects with SERVICE_UNAVAILABLE (NEAR RPC); a JSON-RPC error about the request rejects as is.
 */
export function nearRpc(endpoints: string[], doFetch: typeof fetch = fetch, retryDelayMs = 1500): Rpc {
  return async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
    const tried: string[] = [];
    for (let round = 0; round < 2; round++) {
      if (round) await new Promise((r) => setTimeout(r, retryDelayMs));
      for (const url of endpoints) {
        const host = new URL(url).host;
        let body: { result?: T; error?: { name?: string; cause?: { name?: string; info?: unknown }; data?: unknown; message?: string } };
        try {
          const res = await doFetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: "check-live", method, params }),
            signal: AbortSignal.timeout(30_000),
          });
          if (res.status === 408 || isOutageStatus(res.status)) {
            tried.push(`${host} HTTP ${res.status}`);
            continue;
          }
          body = await res.json();
        } catch (e) {
          tried.push(`${host} ${errorText(e)}`);
          continue;
        }
        if (body.error) {
          const name = body.error.cause?.name ?? body.error.name ?? "ERROR";
          if (RPC_OUTAGES.has(name)) {
            tried.push(`${host} ${name}`);
            continue;
          }
          const data = body.error.data ?? body.error.message;
          throw new Error(`${name}${data ? `: ${typeof data === "string" ? data : JSON.stringify(data)}` : ""}`);
        }
        return body.result as T;
      }
    }
    throw serviceUnavailable("NEAR RPC", tried.join("; "));
  };
}

/** At most `n` of the calls run at once. */
export function limiter(n: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(f: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
      return await f();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

// ---------- 3. proof links ----------

/**
 * `fetch` for /verify's own code (runLinkChecks), keeping a note of each service that
 * was down or rate-limited, so a check that failed because of it can say so.
 */
export function recordingFetch(outages: Outage[], doFetch: typeof fetch = fetch): ProofFetch {
  return async (url, init) => {
    const service = new URL(url).host.includes("nvidia") ? "NVIDIA keys" : "NEAR RPC";
    try {
      const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
      if (isOutageStatus(res.status)) outages.push({ service, error: `${new URL(url).host} HTTP ${res.status}` });
      return res;
    } catch (e) {
      outages.push({ service, error: `${new URL(url).host} ${errorText(e)}` });
      throw e;
    }
  };
}

export interface ProofRun {
  /** runLinkChecks' checks, in /verify's order. */
  checks: Check[];
  /** allChecksPassed: /verify's headline. */
  allPassed: boolean;
  /** The checks the app recorded in the proof, or null for a proof without them. */
  recorded: { id: string; label: string; ok: boolean }[] | null;
  rpcError?: string;
  owner: string;
  meetingId: string;
  proofHash: string;
  /** Services that were down during this run (recordingFetch). */
  outages: Outage[];
}

/** A transaction as section 2 read it. */
export type TxRead = Fetched<TxStatus>;

/**
 * One proof link: /verify's count against the README's, each check that didn't pass, and
 * whether the transactions cited for this meeting name it (same owner, meeting id and, for
 * record_proof, the same proof hash).
 */
export function proofLines(e: ProofEvidence, run: ProofRun, txs: Map<string, TxRead>): Line[] {
  const rpcOutage = run.rpcError ? (run.outages.find((o) => o.service === "NEAR RPC") ?? (/JSON|Unexpected (token|end)/.test(run.rpcError) ? { service: "NEAR RPC", error: run.rpcError } : null)) : null;
  const keysOutage = run.outages.find((o) => o.service === "NVIDIA keys") ?? null;
  const details: Line[] = [];
  for (const c of run.checks) {
    if (c.cantRecheck) details.push({ outcome: "cantRecheck", text: c.label, detail: c.detail, depth: 1 });
    else if (!c.ok) {
      const outage = (c.id === "on-chain" || c.id === "matches") && rpcOutage ? rpcOutage : c.id === "gpu" && c.detail === NO_NVIDIA_KEYS && keysOutage ? keysOutage : null;
      details.push(outage ? { outcome: "unavailable", text: c.label, detail: down(outage), depth: 1 } : { outcome: "fail", text: c.label, detail: c.detail, depth: 1 });
    }
  }
  for (const c of run.recorded ?? []) {
    if (!c.ok && c.id !== "response-e2ee") details.push({ outcome: "fail", text: `Recorded by the app: ${c.label}`, detail: "failed when the notes were made", depth: 1 });
  }

  if (run.owner !== e.owner || run.meetingId !== e.meetingId) {
    details.push({ outcome: "fail", text: "The link is the meeting the evidence names", detail: `link: ${run.owner}, ${run.meetingId}; evidence: ${e.owner}, ${e.meetingId}`, depth: 1 });
  }
  for (const hash of e.txs) {
    const read = txs.get(hash);
    const text = `${hash.slice(0, 8)}… names this meeting`;
    if (!read || "error" in read) {
      details.push({ outcome: "fail", text, detail: read ? read.error : "not read", depth: 1 });
      continue;
    }
    if ("unavailable" in read) {
      details.push({ outcome: "unavailable", text, detail: down(read.unavailable), depth: 1 });
      continue;
    }
    const args = functionCallArgs(read.value) ?? {};
    const problems = [
      read.value.transaction.signer_id !== run.owner ? `signed by ${read.value.transaction.signer_id}` : "",
      args.meeting_id !== run.meetingId ? `meeting_id ${String(args.meeting_id)}` : "",
      args.proof_hash !== undefined && args.proof_hash !== run.proofHash ? `proof_hash ${String(args.proof_hash).slice(0, 12)}…, the link's is ${run.proofHash.slice(0, 12)}…` : "",
    ].filter(Boolean);
    if (problems.length) details.push({ outcome: "fail", text, detail: problems.join("; "), depth: 1 });
  }

  const rerun = run.checks.filter((c) => !c.cantRecheck);
  const passed = rerun.filter((c) => c.ok).length;
  const cant = run.checks.length - rerun.length;
  const recorded = run.recorded ? `; the app's ${run.recorded.length} recorded checks: ${run.recorded.filter((c) => c.ok || c.id === "response-e2ee").length} passed` : "";
  const counts = `${passed} of ${rerun.length} passed${cant ? `, ${cant} can't be re-checked` : ""}${recorded}; ${run.allPassed ? "Checks out" : "Doesn't check out"}`;
  const readme = `${e.passed} of ${e.of}${e.cantRecheck ? `, ${e.cantRecheck} can't be re-checked` : ""}`;
  const tied = e.txs.length ? `; ${e.txs.length === 1 ? "the transaction cited for it names" : `the ${e.txs.length} transactions cited for it name`} this meeting` : "";

  let outcome: Outcome;
  let detail: string;
  if (details.some((d) => d.outcome === "fail")) [outcome, detail] = ["fail", `the README says ${readme}`];
  else if (details.some((d) => d.outcome === "unavailable")) [outcome, detail] = ["unavailable", "a service was down, so not every check could run"];
  else if (passed !== e.passed || rerun.length !== e.of || cant !== e.cantRecheck || !run.allPassed) [outcome, detail] = ["fail", `the README says ${readme}`];
  else [outcome, detail] = ["pass", `as the README says${tied}`];
  return [{ outcome, text: `${e.file}: ${counts}`, detail }, ...details];
}

// ---------- 4. the contract ----------

export interface ContractRead {
  codeHash: Fetched<string>;
  usdc: Fetched<unknown>;
  stats: Fetched<unknown>;
  keys: Fetched<{ public_key: string; access_key: { permission: KeyPermission } }[]>;
}

function fetchedLine<T>(text: string, r: Fetched<T>, judge: (v: T) => { ok: boolean; detail: string }): Line {
  if ("unavailable" in r) return { outcome: "unavailable", text, detail: down(r.unavailable) };
  if ("error" in r) return { outcome: "fail", text, detail: r.error };
  const j = judge(r.value);
  return { outcome: j.ok ? "pass" : "fail", text, detail: j.detail };
}

const STAT_KEYS = ["wallets", "proofs", "payments", "parked"] as const;

/** The deployed code against the README's hash, the token, the counts, and whether the account is locked. */
export function contractLines(e: ContractEvidence, r: ContractRead): Line[] {
  return [
    fetchedLine("Deployed code hash", r.codeHash, (h) => ({ ok: h === e.codeHash, detail: h === e.codeHash ? `${h}, the hash the README states` : `${h}, but the README states ${e.codeHash}` })),
    fetchedLine("get_usdc", r.usdc, (u) => ({ ok: u === e.usdc, detail: u === e.usdc ? `${String(u).slice(0, 10)}…, Circle's USDC on testnet` : `${JSON.stringify(u)}, not ${e.usdc}` })),
    fetchedLine("get_stats", r.stats, (s) => {
      const rec = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
      const ok = STAT_KEYS.every((k) => Number.isInteger(rec[k]));
      return { ok, detail: ok ? STAT_KEYS.map((k) => `${rec[k]} ${k}`).join(", ") : `unexpected answer ${JSON.stringify(s)}` };
    }),
    fetchedLine(e.locked ? "Locked" : "Not locked", r.keys, (keys) => {
      const { locked, fullAccess } = lockState(keys);
      const what = locked ? "no full-access key: nobody can deploy new code to it" : `${fullAccess.length} full-access key${fullAccess.length === 1 ? "" : "s"} (${fullAccess.map((k) => `${k.slice(0, 16)}…`).join(", ")}), so its code can still be upgraded`;
      return { ok: locked === e.locked, detail: locked === e.locked ? `${what}, as the README says` : `${what}, but the README says it is ${e.locked ? "" : "not "}locked` };
    }),
  ];
}

// ---------- the end ----------

/**
 * Counts the lines (a detail under another line isn't counted, apart from a check that
 * can't be re-run) and the exit code: 1 only when a claim doesn't hold.
 */
export function summarize(lines: Line[]): { counts: Record<Outcome, number>; exitCode: 0 | 1; text: string } {
  const counts: Record<Outcome, number> = { pass: 0, fail: 0, unavailable: 0, cantRecheck: 0 };
  for (const l of lines) if (!l.depth || l.outcome === "cantRecheck") counts[l.outcome]++;
  const tally = `${counts.pass} passed, ${counts.fail} failed, ${counts.unavailable} service unavailable, ${counts.cantRecheck} can't be re-checked`;
  const verdict = counts.fail
    ? "Some live claims don't match what the README says: see the ✗ lines."
    : counts.unavailable
      ? "No claim was found false, but some couldn't be checked because a service was down (○): run it again later."
      : "Every live claim checked holds.";
  return { counts, exitCode: counts.fail ? 1 : 0, text: `${tally}. ${verdict}` };
}
