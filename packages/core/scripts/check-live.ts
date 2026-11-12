// pnpm check:live
//
// Re-proves every live claim in the README with no API key and no wallet. Every call is
// a read: NEAR AI Cloud's attestation report (no completion, no transcription, nothing that
// spends credit), Intel's collateral, NVIDIA NRAS and NVIDIA's keys, and NEAR testnet's
// archival RPC. What it checks, and against what: docs/evidence.json.
//
//   1. NEAR AI attestation: the gateway, the summary model and Whisper, with fresh nonces,
//      through the same checks the app runs before it sends anything (tee/attest.ts).
//   2. On-chain evidence: each transaction the README cites, read back from archival RPC,
//      and the key that signed it as it was at that block.
//   3. Proof links: /verify's own checks (runLinkChecks) on every published proof link.
//   4. The contract: its code hash, token, counts and whether it is locked.
//
// ✓ holds · ✗ doesn't hold · ○ a service was down or rate-limited, so it couldn't be
// checked (not a failure) · – can't be re-checked. Exits 1 only when a claim doesn't hold.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { attestModel, gatewayChecks } from "../src/tee/attest.ts";
import type { Jwks } from "../src/tee/nvidia.ts";
import { SUMMARY_MODEL, WHISPER_MODEL, e2eeNode } from "../src/notes/pipeline.ts";
import { decodeVerifyLink, type VerifyLink } from "../src/notes/disclosure.ts";
import { allChecksPassed, runLinkChecks } from "../src/notes/proofLink.ts";
import { proofHash } from "../src/notes/proof.ts";
import { hasFullChecks } from "../src/notes/bundle.ts";
import { nodeAttestationTransport } from "../src/node/nearai.ts";
import { unavailableIn } from "../src/node/outage.ts";
import { matchAccessKey, matchKeyNow, matchTransaction, parseEvidence, type AccessKeyView, type KeyPermission, type TxEvidence, type TxStatus } from "../src/node/evidence.ts";
import {
  ARCHIVAL_RPC,
  MARK,
  attestationErrorLine,
  contractLines,
  e2eeLine,
  errorText,
  formatLine,
  fromError,
  limiter,
  modelLines,
  nearRpc,
  proofLines,
  recordingFetch,
  summarize,
  teeLines,
  type Fetched,
  type Line,
  type Outage,
  type TxRead,
} from "../src/node/checkLive.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const evidence = parseEvidence(JSON.parse(readFileSync(join(root, "docs", "evidence.json"), "utf8")));
const rpc = nearRpc(ARCHIVAL_RPC);
// A few RPC calls at a time, so a free public endpoint doesn't rate-limit the run.
const slot = limiter(4);

interface Group {
  title?: string;
  lines: Line[];
  /** The claim the lines check, shown under them. */
  claim?: string;
}
interface Section {
  title: string;
  groups: Group[];
}

const outageLine = (text: string, o: Outage): Line => ({ outcome: "unavailable", text, detail: `service unavailable (${o.service}): ${o.error}` });
/** An argument for a line: hashes shortened, account names and ids in full. */
const short = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return /^[0-9a-f]{32,}$/.test(s) ? `${s.slice(0, 12)}…` : s;
};

// ---------- 1. NEAR AI attestation ----------

async function attestation(): Promise<Section> {
  const t = nodeAttestationTransport();
  let jwks: Jwks | null = null;
  let keysOutage: Outage | null = null;
  try {
    const parsed = JSON.parse(await t.nvidiaKeys()) as Jwks;
    jwks = Array.isArray(parsed?.keys) ? parsed : null;
  } catch (e) {
    keysOutage = unavailableIn(errorText(e));
  }
  // As processRecording does: the summary model with the gateway (its TLS key bound), Whisper on its own.
  const [summary, whisper] = await Promise.allSettled([
    attestModel(t, SUMMARY_MODEL, "ed25519", { withGateway: true, jwks }),
    attestModel(t, WHISPER_MODEL, "ecdsa", { withGateway: false, jwks }),
  ]);
  const groups: Group[] = [];
  const summaryLines: Line[] = [];
  if (summary.status === "fulfilled") {
    groups.push({ title: `Gateway (in the ${SUMMARY_MODEL} report, with its TLS key; fresh nonce ${summary.value.nonce.slice(0, 8)}…)`, lines: teeLines(gatewayChecks(summary.value), keysOutage) });
    for (const g of modelLines(summary.value, keysOutage)) {
      groups.push(g);
      summaryLines.push(...g.lines);
    }
  } else groups.push({ title: `Gateway and ${SUMMARY_MODEL}`, lines: [attestationErrorLine(`NEAR AI's attestation report for ${SUMMARY_MODEL}`, summary.reason)] });
  if (whisper.status === "fulfilled") groups.push(...modelLines(whisper.value, keysOutage));
  else groups.push({ title: WHISPER_MODEL, lines: [attestationErrorLine(`NEAR AI's attestation report for ${WHISPER_MODEL}`, whisper.reason)] });
  if (summary.status === "fulfilled") groups.push({ title: "The app's last rule before sending", lines: [e2eeLine(e2eeNode(summary.value), summaryLines)] });
  return { title: "1. NEAR AI Cloud attestation, with no API key: the checks the app runs before anything leaves the Mac", groups };
}

// ---------- 2. On-chain evidence ----------

/** Every cited transaction, read once and shared with the proof-link section. */
const txReads = new Map<string, Promise<TxRead>>(
  evidence.transactions.map((e) => [
    e.hash,
    slot(() => rpc<TxStatus>("EXPERIMENTAL_tx_status", { tx_hash: e.hash, sender_account_id: e.signer, wait_until: "NONE" })).then(
      (value): TxRead => ({ value }),
      (err): TxRead => fromError(err),
    ),
  ]),
);

/** view_access_key at a block (or today): the key's permission, or NEAR's word that there is no such key. */
async function accessKey(account: string, publicKey: string, block: string | "final"): Promise<Fetched<AccessKeyView>> {
  try {
    const r = await slot(() =>
      rpc<{ permission?: KeyPermission; error?: string }>("query", { request_type: "view_access_key", account_id: account, public_key: publicKey, ...(block === "final" ? { finality: "final" } : { block_id: block }) }),
    );
    return { value: r.error !== undefined ? { error: r.error } : { permission: r.permission as KeyPermission } };
  } catch (e) {
    const f = fromError<AccessKeyView>(e);
    // Newer nodes answer a missing key with an RPC error rather than a result.
    return "error" in f && /UNKNOWN_ACCESS_KEY|does not exist/.test(f.error) ? { value: { error: f.error } } : f;
  }
}

async function transactionGroup(e: TxEvidence): Promise<Group> {
  const label = `${e.hash.slice(0, 8)}…`;
  const read = await txReads.get(e.hash)!;
  if ("unavailable" in read) return { lines: [outageLine(label, read.unavailable)], claim: e.claim };
  if ("error" in read) return { lines: [{ outcome: "fail", text: label, detail: `NEAR doesn't return it as cited: ${read.error}` }], claim: e.claim };
  const tx = read.value;
  const m = matchTransaction(e, tx, evidence.contract.usdc);
  const args = Object.entries(e.args ?? {}).map(([k, v]) => `${k} ${short(v)}`);
  const lines: Line[] = [{ outcome: m.ok ? "pass" : "fail", text: label, detail: m.ok ? `${m.found}${args.length ? `; with ${args.join(", ")}` : ""}` : m.problems.join("; ") }];
  if (e.key) {
    const keyText = `${label} signing key`;
    const at = await accessKey(tx.transaction.signer_id, tx.transaction.public_key, tx.transaction_outcome.block_hash);
    if ("value" in at) {
      const k = matchAccessKey(e.key, tx.transaction.public_key, at.value);
      lines.push({ outcome: k.ok ? "pass" : "fail", text: keyText, detail: `${k.ok ? k.found : k.problems.join("; ")}, at block ${tx.transaction_outcome.block_hash.slice(0, 8)}…` });
    } else lines.push("unavailable" in at ? outageLine(keyText, at.unavailable) : { outcome: "fail", text: keyText, detail: at.error });
    if (e.key.now) {
      const nowText = `${label} signing key today`;
      const now = await accessKey(tx.transaction.signer_id, tx.transaction.public_key, "final");
      if ("value" in now) {
        const k = matchKeyNow(e.key, tx.transaction.public_key, now.value);
        lines.push({ outcome: k.ok ? "pass" : "fail", text: nowText, detail: k.ok ? k.found : k.problems.join("; ") });
      } else lines.push("unavailable" in now ? outageLine(nowText, now.unavailable) : { outcome: "fail", text: nowText, detail: now.error });
    }
  }
  return { lines, claim: e.claim };
}

async function transactions(): Promise<Section> {
  return {
    title: `2. On-chain evidence: ${evidence.transactions.length} transactions from docs/evidence.json, read back from archival RPC`,
    groups: await Promise.all(evidence.transactions.map(transactionGroup)),
  };
}

// ---------- 3. Proof links ----------

async function proofs(): Promise<Section> {
  const groups = await Promise.all(
    evidence.proofs.map(async (p): Promise<Group> => {
      const link = readFileSync(join(root, p.file), "utf8").match(/https?:\/\/\S+\/verify#\S+/)?.[0];
      if (!link) return { lines: [{ outcome: "fail", text: p.file, detail: "no /verify link in the file" }], claim: p.claim };
      let decoded: VerifyLink;
      try {
        decoded = decodeVerifyLink(link);
      } catch (e) {
        return { lines: [{ outcome: "fail", text: p.file, detail: `the link doesn't decode (${errorText(e)})` }], claim: p.claim };
      }
      const outages: Outage[] = [];
      const run = await runLinkChecks(decoded, recordingFetch(outages));
      const { bundle } = decoded.proof;
      const txs = new Map(await Promise.all(p.txs.map(async (h) => [h, await txReads.get(h)!] as const)));
      const lines = proofLines(
        p,
        {
          checks: run.checks,
          allPassed: allChecksPassed(bundle, run.checks),
          recorded: hasFullChecks(bundle) ? bundle.checks : null,
          ...(run.rpcError ? { rpcError: run.rpcError } : {}),
          owner: decoded.proof.owner,
          meetingId: bundle.meetingId,
          proofHash: proofHash(bundle),
          outages,
        },
        txs,
      );
      return { lines, claim: p.claim };
    }),
  );
  return { title: "3. Proof links, re-checked with /verify's own code (runLinkChecks, as @aftercall/receipts does)", groups };
}

// ---------- 4. The contract ----------

async function contract(): Promise<Section> {
  const c = evidence.contract;
  const query = <T>(params: Record<string, unknown>) => slot(() => rpc<T>("query", { finality: "final", account_id: c.account, ...params }));
  const view = async (method: string): Promise<Fetched<unknown>> => {
    try {
      const r = await query<{ result?: number[]; error?: string }>({ request_type: "call_function", method_name: method, args_base64: "e30=" });
      if (!r.result) return { error: r.error ?? `${method} returned nothing` };
      return { value: JSON.parse(Buffer.from(r.result).toString("utf8")) };
    } catch (e) {
      return fromError(e);
    }
  };
  const [codeHash, usdc, stats, keys] = await Promise.all([
    query<{ code_hash: string }>({ request_type: "view_account" }).then((r): Fetched<string> => ({ value: r.code_hash }), fromError<string>),
    view("get_usdc"),
    view("get_stats"),
    query<{ keys: { public_key: string; access_key: { permission: KeyPermission } }[] }>({ request_type: "view_access_key_list" }).then(
      (r): Fetched<{ public_key: string; access_key: { permission: KeyPermission } }[]> => ({ value: r.keys }),
      fromError<{ public_key: string; access_key: { permission: KeyPermission } }[]>,
    ),
  ]);
  return { title: `4. The contract, ${c.account}`, groups: [{ lines: contractLines(c, { codeHash, usdc, stats, keys }), claim: c.claim }] };
}

// ---------- run ----------

/** A section that threw is a bug in this check, and says so as a failure. */
const guarded = (title: string, run: () => Promise<Section>) =>
  run().catch((e): Section => ({ title, groups: [{ lines: [{ outcome: "fail", text: "This check itself stopped", detail: errorText(e) }] }] }));

// Intel's collateral fetch has no timeout of its own, so the attestation section gets one.
const ATTESTATION_LIMIT_MS = 240_000;
const attestationOrTimeout = Promise.race([
  guarded("1. NEAR AI Cloud attestation", attestation),
  new Promise<Section>((resolve) =>
    setTimeout(
      () => resolve({ title: "1. NEAR AI Cloud attestation", groups: [{ lines: [{ outcome: "unavailable", text: "Attestation", detail: `service unavailable (NEAR AI, Intel or NVIDIA): no answer within ${ATTESTATION_LIMIT_MS / 60_000} minutes` }] }] }),
      ATTESTATION_LIMIT_MS,
    ).unref(),
  ),
]);
const sections = [attestationOrTimeout, guarded("2. On-chain evidence", transactions), guarded("3. Proof links", proofs), guarded("4. The contract", contract)];

console.log(`Aftercall live check, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`);
console.log("No API key and no wallet: read-only calls to NEAR AI Cloud (its attestation report only), Intel, NVIDIA and NEAR testnet.");
console.log(`${MARK.pass} holds   ${MARK.fail} doesn't hold   ${MARK.unavailable} service down or rate-limited, so not checked (not a failure)   ${MARK.cantRecheck} can't be re-checked`);

const all: Line[] = [];
for (const pending of sections) {
  const s = await pending;
  console.log(`\n${s.title}`);
  for (const g of s.groups) {
    if (g.title) console.log(`  ${g.title}`);
    for (const l of g.lines) console.log(formatLine(l, g.title ? "    " : "  "));
    if (g.claim) console.log(`${g.title ? "      " : "    "}${g.claim}`);
    all.push(...g.lines);
  }
}
const { text, exitCode } = summarize(all);
console.log(`\nSummary: ${text}`);
process.exit(exitCode);
