import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { formatUsdc } from "../money.ts";

/**
 * docs/evidence.json: every NEAR transaction and proof link the README cites, with what
 * each must show, and the pure matchers `pnpm check:live` runs them through. A
 * transaction is read back from archival RPC (`EXPERIMENTAL_tx_status`); the key that
 * signed it with `view_access_key` at the transaction's block, which works for keys
 * deleted since. Node only, like the rest of src/node.
 */

const base58Hash = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/, "a base58 hash");

const KeyExpectation = z
  .object({
    /** FullAccess: the account's own key (its owner's wallet). FunctionCall: a limited key, such as the app's. */
    permission: z.enum(["FullAccess", "FunctionCall"]),
    /** For a FunctionCall key: the only contract it may call, and exactly the methods it may call there. */
    receiver: z.string().optional(),
    methods: z.array(z.string()).optional(),
    /** What the key is today: "same" (unchanged) or "deleted". Not checked when absent. */
    now: z.enum(["same", "deleted"]).optional(),
  })
  .strict()
  .refine((k) => k.permission === "FullAccess" || (k.receiver && k.methods), "a FunctionCall key names its receiver and methods");

const TxExpectation = z
  .object({
    hash: base58Hash,
    signer: z.string(),
    receiver: z.string(),
    /** The function call's method; or `deploy` for a contract deployment. */
    method: z.string().optional(),
    deploy: z.object({ codeHash: base58Hash }).strict().optional(),
    /** Each argument listed has exactly this value; others aren't checked. */
    args: z.record(z.unknown()).optional(),
    outcome: z.enum(["success", "failure"]),
    /** For a failure: text its error must contain. */
    failure: z.string().optional(),
    /** The return value: an object's listed fields, or the whole value otherwise. */
    returns: z.unknown().optional(),
    /** A NEP-141 transfer of the network's USDC from `receiver` that succeeded. */
    transfer: z.object({ to: z.string(), amount: z.string().regex(/^\d+$/) }).strict().optional(),
    /** Nothing moved: no token transfer in any receipt. */
    noTransfer: z.literal(true).optional(),
    key: KeyExpectation.optional(),
    claim: z.string(),
    citedIn: z.array(z.string()).min(1),
  })
  .strict()
  .refine((t) => !!t.method !== !!t.deploy, "a transaction has a method or a deploy, not both");

const ProofExpectation = z
  .object({
    file: z.string(),
    owner: z.string(),
    meetingId: z.string(),
    /** /verify's count: checks passed of the checks it re-runs, and the ones it can't re-check. */
    passed: z.number().int().nonnegative(),
    of: z.number().int().positive(),
    cantRecheck: z.number().int().nonnegative(),
    /** Transactions in `transactions` that belong to this meeting: same owner, meeting_id, and proof_hash when they carry one. */
    txs: z.array(base58Hash),
    claim: z.string(),
    citedIn: z.array(z.string()).min(1),
  })
  .strict();

const ContractExpectation = z
  .object({
    account: z.string(),
    /** base58 sha256 of the deployed code, as `view_account` gives it. */
    codeHash: base58Hash,
    usdc: z.string(),
    /** Locked: no full-access key on the contract account, so its code can't change. */
    locked: z.boolean(),
    claim: z.string(),
    citedIn: z.array(z.string()).min(1),
  })
  .strict();

export const EvidenceFile = z
  .object({
    about: z.string(),
    network: z.literal("testnet"),
    contract: ContractExpectation,
    transactions: z.array(TxExpectation),
    proofs: z.array(ProofExpectation),
  })
  .strict()
  .superRefine((e, ctx) => {
    const hashes = new Set(e.transactions.map((t) => t.hash));
    if (hashes.size !== e.transactions.length) ctx.addIssue({ code: "custom", message: "a transaction is listed twice" });
    for (const p of e.proofs) for (const h of p.txs) if (!hashes.has(h)) ctx.addIssue({ code: "custom", message: `${p.file} names ${h}, which isn't in transactions` });
  });

export type Evidence = z.infer<typeof EvidenceFile>;
export type TxEvidence = z.infer<typeof TxExpectation>;
export type KeyEvidence = z.infer<typeof KeyExpectation>;
export type ProofEvidence = z.infer<typeof ProofExpectation>;
export type ContractEvidence = z.infer<typeof ContractExpectation>;

/** docs/evidence.json, checked; throws with every problem when it doesn't fit. */
export function parseEvidence(json: unknown): Evidence {
  const r = EvidenceFile.safeParse(json);
  if (!r.success) throw new Error(`docs/evidence.json: ${r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  return r.data;
}

// ---------- what NEAR's RPC answers ----------

export interface ExecutionStatus {
  SuccessValue?: string;
  SuccessReceiptId?: string;
  Failure?: unknown;
}

export type TxAction = string | { FunctionCall?: { method_name: string; args: string; deposit?: string }; DeployContract?: { code: string }; [other: string]: unknown };

/** The parts of `EXPERIMENTAL_tx_status` read here. */
export interface TxStatus {
  status: ExecutionStatus;
  transaction: { signer_id: string; receiver_id: string; public_key: string; actions: TxAction[] };
  transaction_outcome: { block_hash: string };
  receipts_outcome: { outcome: { executor_id: string; logs: string[]; status: ExecutionStatus } }[];
}

export type KeyPermission = "FullAccess" | { FunctionCall: { allowance?: string | null; receiver_id: string; method_names: string[] } };

/** `view_access_key`'s answer: the key's permission, or the error NEAR gives when the account has no such key. */
export type AccessKeyView = { permission: KeyPermission } | { error: string };

// ---------- helpers ----------

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 (Bitcoin alphabet), as NEAR writes hashes and keys. */
export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** A base64 value as JSON when it is JSON, else as text; undefined when empty. */
export function decodeBase64Json(b64: string | undefined): unknown {
  if (!b64) return undefined;
  const text = Buffer.from(b64, "base64").toString("utf8");
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const short = (s: string) => (s.length > 14 ? `${s.slice(0, 8)}…` : s);
const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
const succeeded = (s: ExecutionStatus) => s.SuccessValue !== undefined || s.SuccessReceiptId !== undefined;

/** Whether `got` has every field of an object `want` (recursively), or equals a non-object `want`. */
export function includes(got: unknown, want: unknown): boolean {
  if (want && typeof want === "object" && !Array.isArray(want)) {
    if (!got || typeof got !== "object" || Array.isArray(got)) return false;
    return Object.entries(want).every(([k, v]) => includes((got as Record<string, unknown>)[k], v));
  }
  return isDeepStrictEqual(got, want);
}

/** NEP-141 `ft_transfer` events logged by `token`'s receipts, with whether each receipt succeeded. */
export function tokenTransfers(tx: TxStatus, token: string): { from: string; to: string; amount: string; ok: boolean }[] {
  const out: { from: string; to: string; amount: string; ok: boolean }[] = [];
  for (const r of tx.receipts_outcome) {
    for (const log of r.outcome.logs) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      let ev: { standard?: string; event?: string; data?: { old_owner_id?: string; new_owner_id?: string; amount?: string }[] };
      try {
        ev = JSON.parse(log.slice("EVENT_JSON:".length));
      } catch {
        continue;
      }
      if (ev.standard !== "nep141" || ev.event !== "ft_transfer" || !Array.isArray(ev.data)) continue;
      // Only the token contract's own events count: any contract can log anything.
      if (r.outcome.executor_id !== token) continue;
      for (const d of ev.data) out.push({ from: String(d.old_owner_id), to: String(d.new_owner_id), amount: String(d.amount), ok: succeeded(r.outcome.status) });
    }
  }
  return out;
}

const anyTransfer = (tx: TxStatus) => tx.receipts_outcome.some((r) => r.outcome.logs.some((l) => /^EVENT_JSON:.*"event"\s*:\s*"ft_transfer"/.test(l)));

export interface Match {
  /** Every expectation held. */
  ok: boolean;
  /** What doesn't match, in words. Empty when ok. */
  problems: string[];
  /** What NEAR shows, in one line. */
  found: string;
}

// ---------- transactions ----------

/** The function call or deployment in a transaction, as the evidence describes them. */
function actionOf(tx: TxStatus): { method?: string; args?: unknown; codeHash?: string; kinds: string[] } {
  const kinds = tx.transaction.actions.map((a) => (typeof a === "string" ? a : Object.keys(a)[0]));
  for (const a of tx.transaction.actions) {
    if (typeof a === "string") continue;
    if (a.FunctionCall) return { method: a.FunctionCall.method_name, args: decodeBase64Json(a.FunctionCall.args), kinds };
    // RPC shows a deployment's code as its sha256, in base64.
    if (a.DeployContract) return { codeHash: base58(Buffer.from(a.DeployContract.code, "base64")), kinds };
  }
  return { kinds };
}

/** The function call's arguments, when the transaction is one and they are a JSON object. */
export function functionCallArgs(tx: TxStatus): Record<string, unknown> | null {
  const { args } = actionOf(tx);
  return args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : null;
}

/**
 * Checks one transaction, read back from NEAR, against its evidence: who signed it and
 * for which contract, the method and arguments (or the deployed code's hash), success or
 * failure, the return value, and any USDC that moved (`usdc` is the token's contract).
 */
export function matchTransaction(e: TxEvidence, tx: TxStatus, usdc: string): Match {
  const problems: string[] = [];
  const t = tx.transaction;
  if (t.signer_id !== e.signer) problems.push(`signed by ${t.signer_id}, not ${e.signer}`);
  if (t.receiver_id !== e.receiver) problems.push(`sent to ${t.receiver_id}, not ${e.receiver}`);

  const act = actionOf(tx);
  if (t.actions.length !== 1) problems.push(`${t.actions.length} actions (${act.kinds.join(", ")}), not one`);
  if (e.method !== undefined && act.method !== e.method) problems.push(`calls ${act.method ?? act.kinds.join(", ")}, not ${e.method}`);
  if (e.deploy && act.codeHash !== e.deploy.codeHash) problems.push(act.codeHash ? `deploys code ${act.codeHash}, not ${e.deploy.codeHash}` : `has no deployment (${act.kinds.join(", ")})`);
  for (const [k, v] of Object.entries(e.args ?? {})) {
    const got = act.args && typeof act.args === "object" ? (act.args as Record<string, unknown>)[k] : undefined;
    if (!isDeepStrictEqual(got, v)) problems.push(`argument ${k} is ${got === undefined ? "missing" : show(got)}, not ${show(v)}`);
  }

  const ok = succeeded(tx.status);
  const returned = decodeBase64Json(tx.status.SuccessValue);
  if (e.outcome === "success") {
    if (!ok) problems.push(`failed: ${show(tx.status.Failure)}`);
    const failed = tx.receipts_outcome.filter((r) => r.outcome.status.Failure !== undefined);
    if (ok && failed.length) problems.push(`${failed.length} receipt${failed.length === 1 ? "" : "s"} failed (${failed.map((r) => r.outcome.executor_id).join(", ")})`);
  } else {
    if (ok) problems.push("succeeded, but should have failed");
    else if (e.failure && !show(tx.status.Failure).includes(e.failure)) problems.push(`failed with ${show(tx.status.Failure)}, not ${e.failure}`);
  }
  if ("returns" in e && !includes(returned, e.returns)) problems.push(`returned ${returned === undefined ? "nothing" : show(returned)}, not ${show(e.returns)}`);

  const moved = tokenTransfers(tx, usdc);
  if (e.transfer) {
    const want = e.transfer;
    const hit = moved.find((m) => m.ok && m.from === e.receiver && m.to === want.to && m.amount === want.amount);
    if (!hit) problems.push(`no USDC transfer of ${want.amount} from ${e.receiver} to ${want.to}${moved.length ? ` (moved: ${moved.map((m) => `${m.amount} to ${m.to}${m.ok ? "" : ", failed"}`).join("; ")})` : ""}`);
  }
  if (e.noTransfer && anyTransfer(tx)) problems.push("a token moved, but nothing should have");

  const parts = [
    `${act.method ?? (act.codeHash ? "deploy" : act.kinds.join(", "))} by ${t.signer_id}`,
    ok ? "success" : "failure",
    act.codeHash ? `code ${act.codeHash}` : "",
    returned !== undefined ? `returned ${show(returned)}` : "",
    ...moved.filter((m) => m.ok).map((m) => `${formatUsdc(BigInt(m.amount))} USDC to ${m.to}`),
    e.noTransfer && !anyTransfer(tx) ? "nothing moved" : "",
  ].filter(Boolean);
  return { ok: problems.length === 0, problems, found: parts.join("; ") };
}

// ---------- access keys ----------

const describeKey = (p: KeyPermission) => (p === "FullAccess" ? "FullAccess" : `FunctionCall on ${p.FunctionCall.receiver_id}: ${p.FunctionCall.method_names.join(", ") || "any method"}`);

function permissionProblems(want: KeyEvidence, got: KeyPermission): string[] {
  if (want.permission === "FullAccess") return got === "FullAccess" ? [] : [`was ${describeKey(got)}, not FullAccess`];
  if (got === "FullAccess") return ["was a FullAccess key, not a limited one"];
  const fc = got.FunctionCall;
  const problems: string[] = [];
  if (fc.receiver_id !== want.receiver) problems.push(`may call ${fc.receiver_id}, not ${want.receiver}`);
  const sorted = (m: string[]) => [...m].sort().join(", ");
  // An empty list lets the key call any method of its receiver.
  if (sorted(fc.method_names) !== sorted(want.methods ?? [])) problems.push(`may call ${fc.method_names.length ? fc.method_names.join(", ") : "any method"}, not ${(want.methods ?? []).join(", ")}`);
  return problems;
}

/** The key that signed a transaction, as it was at the transaction's block, against the evidence. */
export function matchAccessKey(want: KeyEvidence, publicKey: string, atBlock: AccessKeyView): Match {
  const k = `key ${short(publicKey.replace(/^ed25519:/, ""))}`;
  if ("error" in atBlock) return { ok: false, problems: [`${k} wasn't on the account at that block: ${atBlock.error}`], found: `${k}: none` };
  const problems = permissionProblems(want, atBlock.permission).map((p) => `${k} ${p}`);
  return { ok: problems.length === 0, problems, found: `${k} was ${describeKey(atBlock.permission)}` };
}

/** The same key today, for evidence that says it is unchanged or deleted. */
export function matchKeyNow(want: KeyEvidence, publicKey: string, now: AccessKeyView): Match {
  const k = `key ${short(publicKey.replace(/^ed25519:/, ""))}`;
  if (want.now === "deleted") {
    const gone = "error" in now && /does not exist/.test(now.error);
    return gone ? { ok: true, problems: [], found: `${k} deleted since` } : { ok: false, problems: [`${k} is still on the account (${"error" in now ? now.error : describeKey(now.permission)})`], found: `${k} still there` };
  }
  if ("error" in now) return { ok: false, problems: [`${k} isn't on the account any more: ${now.error}`], found: `${k}: none today` };
  const problems = permissionProblems(want, now.permission).map((p) => `${k} today ${p.replace(/^was /, "is ")}`);
  return { ok: problems.length === 0, problems, found: `${k} unchanged today` };
}

// ---------- the contract account ----------

/** Locked when no full-access key is left on the account: then nobody can deploy new code to it. */
export function lockState(keys: { public_key: string; access_key: { permission: KeyPermission } }[]): { locked: boolean; fullAccess: string[] } {
  const fullAccess = keys.filter((k) => k.access_key.permission === "FullAccess").map((k) => k.public_key);
  return { locked: fullAccess.length === 0, fullAccess };
}
