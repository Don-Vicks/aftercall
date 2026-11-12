// pnpm --filter @aftercall/core ledger -- <owner> [--network testnet|mainnet] [--contract <account>] [--out <file.csv>]
//
// An agent-wallet owner's money trail as CSV a bookkeeper can read (docs/bookkeeping.md): a
// row per payment, deal held in escrow, deposit and withdrawal, where it stands now, with its
// transaction. Read-only: it signs nothing and needs no key or account.
//
//   1. The owner's transactions come from the NearBlocks API (no key needed), and the payees'
//      `confirm_escrow` and `return_escrow` calls from theirs.
//   2. Each one is read from NEAR's archival RPC (`EXPERIMENTAL_tx_status`): method, args,
//      return value and callbacks, and the kind of key that signed it at that block.
//   3. The contract's views (`is_paid`, `get_pending`, `get_escrow`, `get_payees`) say where
//      each payment stands now.
//
// Writes the CSV to stdout, or to --out (relative to where you ran pnpm). Calls the contract
// refused moved nothing: they're listed on stderr, not as rows.
//
// Example: pnpm --filter @aftercall/core ledger -- demo-owner.aftercall.testnet --out docs/ledger-demo-owner.csv

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ledgerCsv } from "../src/export.ts";
import { NETWORK_CONFIG, parseNetwork, type Network } from "../src/network.ts";
import { chainCallFrom, ledgerFromChain, LEDGER_CALLS, type ChainCall, type ChainState, type RpcTxStatus } from "../src/wallet/ledger.ts";
import type { EscrowView } from "../src/followups/deal.ts";

const NEARBLOCKS: Record<Network, string> = { testnet: "https://api-testnet.nearblocks.io", mainnet: "https://api.nearblocks.io" };
/** FastNEAR's archival nodes: transactions older than a few epochs are gone from the regular RPC. */
const ARCHIVAL: Record<Network, string> = { testnet: "https://archival-rpc.testnet.fastnear.com", mainnet: "https://archival-rpc.mainnet.fastnear.com" };
/** Calls that need a deposit of 1 yoctoNEAR, so only the account's own full-access key can make them. */
const ONE_YOCTO = new Set(["approve_pending", "cancel_pending", "approve_escrow", "cancel_escrow", "withdraw", "ft_transfer_call"]);

function usage(problem: string): never {
  console.error(`${problem}\nUsage: pnpm --filter @aftercall/core ledger -- <owner> [--network testnet|mainnet] [--contract <account>] [--out <file.csv>]`);
  process.exit(2);
}

const argv = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const value = argv[i + 1];
  if (!value || value.startsWith("--")) usage(`--${name} needs a value.`);
  argv.splice(i, 2);
  return value;
};
const network = parseNetwork(flag("network"));
const contract = flag("contract") ?? NETWORK_CONFIG[network].agentWallet ?? usage(`Aftercall has no contract on ${network} yet: pass --contract.`);
const out = flag("out");
const [owner, ...extra] = argv;
if (!owner || extra.length) usage(owner ? `Unexpected: ${extra.join(" ")}` : "Name the owner account.");
const usdc = NETWORK_CONFIG[network].usdc;
const say = (s: string) => console.error(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- NearBlocks: which transactions ----------

interface NearBlocksTxn {
  transaction_hash: string;
  signer_account_id: string;
  receiver_account_id: string;
  /** Nanoseconds, as a string. */
  block_timestamp: string;
  actions: { action: string; method: string | null }[] | null;
}

/** One NearBlocks page. The free API allows a few calls a minute: waits and tries again when it says so. */
async function nearblocksPage(url: string): Promise<NearBlocksTxn[]> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const body = (await res.json().catch(() => null)) as { data?: NearBlocksTxn[]; message?: string } | null;
    if (res.ok && Array.isArray(body?.data)) return body.data;
    const limited = res.status === 429 || /limit/i.test(body?.message ?? "");
    if (!limited || attempt === 6) throw new Error(`NearBlocks answered ${res.status}: ${body?.message ?? "no list"} (${url})`);
    say(`  NearBlocks asks to slow down; waiting 20 s (try ${attempt} of 5)…`);
    await sleep(20_000);
  }
}

/**
 * Every transaction of `account`, newest first, back to `since` (ns) if given. Pages step back
 * with `before_ts`, from the oldest time on the last page plus one nanosecond, so a block holding
 * several of the account's transactions isn't cut in half; repeats are dropped.
 */
async function accountTxns(account: string, since = 0n): Promise<NearBlocksTxn[]> {
  const all = new Map<string, NearBlocksTxn>();
  let before: bigint | null = null;
  for (;;) {
    const page = await nearblocksPage(`${NEARBLOCKS[network]}/v3/accounts/${account}/txns?per_page=25&order=desc${before === null ? "" : `&before_ts=${before}`}`);
    const fresh = page.filter((t) => !all.has(t.transaction_hash));
    for (const t of fresh) all.set(t.transaction_hash, t);
    const oldest = page.length ? BigInt(page[page.length - 1].block_timestamp) : 0n;
    if (page.length < 25 || fresh.length === 0 || oldest < since) break;
    before = oldest + 1n;
    await sleep(1500);
  }
  return [...all.values()];
}

const methodOf = (t: NearBlocksTxn) => (t.actions?.length === 1 ? (t.actions[0].method ?? "") : "");

// ---------- NEAR RPC: what each one did ----------

/** One JSON-RPC call, paced for FastNEAR's free tier: a rate-limit answer waits and tries again. */
async function rpc<T>(url: string, method: string, params: unknown): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    await sleep(250);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "ledger", method, params }) });
    const body = (await res.json().catch(() => null)) as { result?: T; error?: { code?: number } } | null;
    if (body?.result !== undefined) return body.result;
    const limited = res.status === 429 || body?.error?.code === -429;
    if (attempt === 6 || (body?.error && !limited)) throw new Error(`${method}: ${JSON.stringify(body?.error ?? res.status)}`);
    if (limited) say(`  NEAR RPC asks to slow down; waiting ${attempt * 5} s…`);
    await sleep(attempt * 5000);
  }
}

/** The kind of key that signed: read at the transaction's own block, since a key can be deleted later. */
async function keyKind(tx: RpcTxStatus, method: string): Promise<ChainCall["key"]> {
  if (ONE_YOCTO.has(method)) return "full-access";
  try {
    const key = await rpc<{ permission: unknown }>(ARCHIVAL[network], "query", {
      request_type: "view_access_key",
      account_id: tx.transaction.signer_id,
      public_key: tx.transaction.public_key,
      block_id: tx.transaction_outcome.block_hash,
    });
    return key.permission === "FullAccess" ? "full-access" : "limited";
  } catch {
    return "unknown";
  }
}

async function readCall(t: NearBlocksTxn, keyMatters: boolean): Promise<ChainCall | null> {
  const tx = await rpc<RpcTxStatus>(ARCHIVAL[network], "EXPERIMENTAL_tx_status", { tx_hash: t.transaction_hash, sender_account_id: t.signer_account_id, wait_until: "FINAL" });
  const key = keyMatters ? await keyKind(tx, methodOf(t)) : "unknown";
  return chainCallFrom(tx, Number(BigInt(t.block_timestamp) / 1_000_000n), key);
}

/** A view on the contract, at final finality, over the regular RPC. */
async function view<T>(method: string, args: unknown): Promise<T> {
  const r = await rpc<{ result: number[] }>(NETWORK_CONFIG[network].rpcUrl, "query", {
    request_type: "call_function",
    finality: "final",
    account_id: contract,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString()) as T;
}

// ---------- The run ----------

say(`Ledger for ${owner} on ${contract} (NEAR ${network})`);
const ownerList = (await accountTxns(owner)).filter(
  (t) =>
    t.signer_account_id === owner &&
    ((t.receiver_account_id === contract && (LEDGER_CALLS.owner as readonly string[]).includes(methodOf(t))) || (t.receiver_account_id === usdc && methodOf(t) === "ft_transfer_call")),
);
say(`  ${ownerList.length} of the owner's transactions to read`);
const calls: ChainCall[] = [];
for (const t of ownerList) {
  const c = await readCall(t, ["pay", "open_escrow", "release_escrow"].includes(methodOf(t)));
  if (c) calls.push(c);
}

// The payees' own calls name the owner in their args: read the payees of this owner's deals, from when the first deal opened.
const deals = calls.filter((c) => c.method === "open_escrow");
if (deals.length) {
  const payees = new Set(deals.map((c) => String(c.args.payee)));
  const since = BigInt(Math.min(...deals.map((c) => c.at))) * 1_000_000n;
  for (const payee of payees) {
    await sleep(1500);
    const theirs = (await accountTxns(payee, since)).filter(
      (t) => t.signer_account_id === payee && t.receiver_account_id === contract && (LEDGER_CALLS.payee as readonly string[]).includes(methodOf(t)) && BigInt(t.block_timestamp) >= since,
    );
    say(`  ${theirs.length} of ${payee}'s confirm or return calls to read`);
    for (const t of theirs) {
      const c = await readCall(t, false);
      if (c && c.args.owner === owner) calls.push(c);
    }
  }
}

// Where each payment and deal stands now, from the contract itself.
const paymentIds = new Set(calls.filter((c) => ["pay", "approve_pending", "cancel_pending"].includes(c.method) && !c.failure).map((c) => String(c.args.followup_id)));
const escrowIds = new Set(calls.filter((c) => c.method.endsWith("_escrow") && !c.failure).map((c) => String(c.args.escrow_id)));
const state: ChainState = { paid: new Set(), pending: new Set(), escrows: new Map(), labels: new Map() };
for (const p of await view<{ account: string; label: string }[]>("get_payees", { owner })) (state.labels as Map<string, string>).set(p.account, p.label);
for (const id of paymentIds) {
  if (await view<boolean>("is_paid", { owner, followup_id: id })) (state.paid as Set<string>).add(id);
  if (await view<unknown>("get_pending", { owner, followup_id: id })) (state.pending as Set<string>).add(id);
}
for (const id of escrowIds) {
  const e = await view<EscrowView | null>("get_escrow", { owner, escrow_id: id });
  if (e) (state.escrows as Map<string, EscrowView>).set(id, e);
}

const { rows, skipped } = ledgerFromChain(calls, state, { network, contract, owner, usdc });
const csv = ledgerCsv(rows);
for (const s of skipped) say(`  not a row: ${s.method} ${s.hash} moved nothing (${s.why})`);
if (out) {
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), out);
  writeFileSync(path, csv);
  say(`${rows.length} rows written to ${path}`);
} else {
  process.stdout.write(csv);
  say(`${rows.length} rows`);
}
