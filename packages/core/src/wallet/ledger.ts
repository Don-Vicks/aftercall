import { ledgerTime, type LedgerApprover, type LedgerRow, type LedgerStatus } from "../export.ts";
import { PAY_MEMO } from "../followups/boundaries.ts";
import type { EscrowView } from "../followups/deal.ts";
import type { EscrowState } from "../meeting.ts";
import type { Network } from "../network.ts";

/**
 * An owner's money trail read from NEAR: every call to their agent wallet that moves or
 * holds USDC, as ledger rows (`ledgerCsv` in export.ts). `pnpm --filter @aftercall/core
 * ledger` lists the transactions and reads each one from NEAR (scripts/ledger.ts); this
 * part is pure, so it is tested on transactions read from testnet. Statuses and amounts
 * come from the transactions and the contract's views, never from a meeting's notes.
 */

/** The agent-wallet calls on the trail: the owner's (`record_proof` links a payment to its meeting) and the payee's. */
export const LEDGER_CALLS = {
  owner: ["pay", "approve_pending", "cancel_pending", "open_escrow", "approve_escrow", "cancel_escrow", "release_escrow", "withdraw", "record_proof"],
  payee: ["confirm_escrow", "return_escrow"],
} as const;

/** One transaction, as read from NEAR: a single function call. */
export interface ChainCall {
  hash: string;
  /** Block time, ms since the epoch. */
  at: number;
  signer: string;
  receiver: string;
  method: string;
  args: Record<string, unknown>;
  /** The key that signed it: "full-access" is the account's own wallet; "limited" a function-call key, such as the Mac app's. */
  key: "full-access" | "limited" | "unknown";
  /** Null when the call went through; the contract's refusal ("PROOF_NOT_FOUND") or NEAR's error when it didn't. */
  failure: string | null;
  /** What the call returned, parsed from JSON: a PayResult, an EscrowResult, an escrow state, the USDC a deposit used. */
  value: unknown;
  /** What each callback in the transaction returned, by method: `on_pay_complete` is true when the transfer landed. */
  callbacks: Record<string, unknown>;
}

/** What the contract's views say now, for the ids on the trail. */
export interface ChainState {
  /** Follow-up ids `is_paid` says are paid. */
  paid: ReadonlySet<string>;
  /** Follow-up ids `get_pending` still holds for the owner's wallet. */
  pending: ReadonlySet<string>;
  /** `get_escrow` for each escrow id. */
  escrows: ReadonlyMap<string, Pick<EscrowView, "payee" | "amount" | "state">>;
  /** `get_payees`: each payee's label, by account. */
  labels: ReadonlyMap<string, string>;
}

/** Whose trail, on which contract. */
export interface ChainPlace {
  network: Network;
  contract: string;
  owner: string;
  /** The USDC contract, for deposits (`ft_transfer_call` to the agent wallet). */
  usdc: string;
}

export interface ChainLedger {
  rows: LedgerRow[];
  /** Calls the contract refused, or that moved nothing: not rows, but said so. */
  skipped: { hash: string; method: string; why: string }[];
}

// ---------- Reading a transaction ----------

/** The parts of an `EXPERIMENTAL_tx_status` result this reads. */
export interface RpcTxStatus {
  status: RpcOutcomeStatus;
  transaction: { hash: string; signer_id: string; receiver_id: string; public_key: string; actions: unknown[] };
  transaction_outcome: { block_hash: string };
  receipts_outcome: { id: string; outcome: { executor_id: string; status: RpcOutcomeStatus } }[];
  receipts?: { receipt_id: string; receiver_id: string; receipt: { Action?: { actions: unknown[] } } }[];
}

type RpcOutcomeStatus = { SuccessValue?: string; SuccessReceiptId?: string; Failure?: unknown };

function fromBase64(b64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

/** A returned value: JSON when it parses, the text when it doesn't, null when empty. */
function returned(b64: string): unknown {
  const text = fromBase64(b64);
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The one function call in a list of actions, or null. */
function functionCall(actions: readonly unknown[]): { method_name: string; args: string } | null {
  if (actions.length !== 1) return null;
  const fc = (actions[0] as { FunctionCall?: { method_name?: unknown; args?: unknown } } | null)?.FunctionCall;
  return fc && typeof fc.method_name === "string" && typeof fc.args === "string" ? { method_name: fc.method_name, args: fc.args } : null;
}

/** "PROOF_NOT_FOUND" from a contract panic, or NEAR's failure as JSON. */
function failureText(failure: unknown): string {
  const text = JSON.stringify(failure);
  return /Smart contract panicked: ([^"\\]+)/.exec(text)?.[1] ?? text;
}

/**
 * One transaction from `EXPERIMENTAL_tx_status`, with its block time and the kind of key
 * that signed it. Null when it isn't a single function call (a key added, an account made).
 */
export function chainCallFrom(tx: RpcTxStatus, at: number, key: ChainCall["key"]): ChainCall | null {
  const call = functionCall(tx.transaction.actions);
  if (!call) return null;
  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(fromBase64(call.args)) as unknown;
    if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
  } catch {
    // Not JSON: no args this reads.
  }
  // Callbacks are the contract's calls to itself, after the first.
  const methods = new Map<string, string>();
  for (const r of tx.receipts ?? []) {
    const fc = r.receiver_id === tx.transaction.receiver_id ? functionCall(r.receipt.Action?.actions ?? []) : null;
    if (fc && fc.method_name !== call.method_name) methods.set(r.receipt_id, fc.method_name);
  }
  const callbacks: Record<string, unknown> = {};
  for (const r of tx.receipts_outcome) {
    const method = methods.get(r.id);
    if (!method) continue;
    const s = r.outcome.status;
    callbacks[method] = s.SuccessValue !== undefined ? returned(s.SuccessValue) : s.Failure ? false : null;
  }
  return {
    hash: tx.transaction.hash,
    at,
    signer: tx.transaction.signer_id,
    receiver: tx.transaction.receiver_id,
    method: call.method_name,
    args,
    key,
    failure: tx.status.Failure ? failureText(tx.status.Failure) : null,
    value: tx.status.SuccessValue !== undefined ? returned(tx.status.SuccessValue) : null,
    callbacks,
  };
}

// ---------- The trail ----------

type StepKind =
  | "held"
  | "paid"
  | "approved"
  | "declined"
  | "refunded"
  | "parked"
  | "set-aside"
  | "confirmed"
  | "released"
  | "released-on-confirm"
  | "release-bounced"
  | "cancelled"
  | "returned";

interface Step {
  kind: StepKind;
  call: ChainCall;
}

interface Trail {
  id: string;
  escrow: boolean;
  payee: string;
  amount: bigint | null;
  meetingId: string;
  memo: string;
  /** Why the contract held it: OVER_PAYMENT_CAP, OVER_CAP… */
  reason: string;
  crossChain: boolean;
  steps: Step[];
}

const CAPS: Record<string, string> = {
  OVER_PAYMENT_CAP: "per-payment cap",
  OVER_CAP: "daily cap",
  OVER_CROSS_CHAIN_CAP: "cap for other chains",
};
const capName = (reason: string) => CAPS[reason] ?? "caps";

const str = (v: unknown) => (typeof v === "string" ? v : "");
function amountOf(v: unknown): bigint | null {
  try {
    return typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : null;
  } catch {
    return null;
  }
}

/** "on 2026-11-12T09:02:21Z (transaction CGqt…)": where a step on the trail is, for a note. */
const when = (s: Step) => `on ${ledgerTime(s.call.at)} (transaction ${s.call.hash})`;

/** Who signed a payment or an escrow's opening: the owner's wallet, or a limited key (the Mac app's: you, or autopilot for a payment). */
function signedBy(call: ChainCall, payment: boolean): LedgerApprover {
  if (call.key === "full-access") return "your wallet";
  if (call.key === "limited") return payment ? "you or autopilot" : "you";
  return "";
}

function last<T>(list: readonly T[], test: (x: T) => boolean): T | undefined {
  for (let i = list.length - 1; i >= 0; i--) if (test(list[i])) return list[i];
  return undefined;
}

/** A payment's status from the contract's views, when they say: paid (perhaps after being held) or still held. */
function paymentNow(t: Trail, state: ChainState): LedgerStatus | null {
  if (state.paid.has(t.id)) return t.steps.some((s) => s.kind === "held") ? "approved and paid" : "paid";
  if (state.pending.has(t.id)) return "held for approval";
  return null;
}

const STEP_STATUS: Record<StepKind, LedgerStatus> = {
  held: "held for approval",
  paid: "paid",
  approved: "approved and paid",
  declined: "declined",
  refunded: "failed and refunded",
  parked: "held for approval",
  "set-aside": "in escrow",
  confirmed: "in escrow",
  released: "released",
  "released-on-confirm": "released",
  "release-bounced": "in escrow",
  cancelled: "returned",
  returned: "returned",
};

const ESCROW_STATUS: Record<EscrowState, LedgerStatus> = {
  parked: "held for approval",
  open: "in escrow",
  confirmed: "in escrow",
  released: "released",
  cancelled: "returned",
  returned: "returned",
};

function paymentRow(t: Trail, state: ChainState, base: Omit<LedgerRow, "status" | "approvedBy" | "tx" | "date" | "note">): LedgerRow {
  const fromTrail = STEP_STATUS[t.steps[t.steps.length - 1].kind];
  const status = paymentNow(t, state) ?? fromTrail;
  const held = t.steps.find((s) => s.kind === "held");
  const sent = last(t.steps, (s) => s.kind === "paid" || s.kind === "approved" || s.kind === "refunded");
  const cap = capName(t.reason);
  let step: Step;
  let approvedBy: LedgerApprover;
  let note: string;
  switch (status) {
    case "paid":
      step = sent ?? t.steps[0];
      approvedBy = signedBy(step.call, true);
      note = t.crossChain ? "Sent from your agent wallet within your caps to NEAR Intents, which pays the payee on Solana or Base." : "Paid from your agent wallet within your caps.";
      break;
    case "approved and paid":
      step = last(t.steps, (s) => s.kind === "approved") ?? sent ?? t.steps[t.steps.length - 1];
      approvedBy = "your wallet";
      note = `Over your ${cap}, so the contract held it ${held ? when(held) : ""}; you approved it in your wallet, which paid it.`;
      break;
    case "held for approval":
      step = last(t.steps, (s) => s.kind === "held") ?? t.steps[t.steps.length - 1];
      approvedBy = "";
      note = `Over your ${cap}, so the contract holds it for your wallet. Nothing has been paid.`;
      break;
    case "declined":
      step = last(t.steps, (s) => s.kind === "declined") ?? t.steps[t.steps.length - 1];
      approvedBy = "your wallet";
      note = `Over your ${cap}, so the contract held it ${held ? when(held) : ""}; you declined it in your wallet. Nothing was paid.`;
      break;
    default:
      step = last(t.steps, (s) => s.kind === "refunded") ?? t.steps[t.steps.length - 1];
      approvedBy = signedBy(step.call, step.call.method === "pay");
      note = "The transfer didn't land, so the contract put the amount back in your agent wallet.";
  }
  if (status !== fromTrail) note += ` (The transactions read here end with it ${fromTrail}; the contract says ${status} now.)`;
  return { ...base, date: ledgerTime(step.call.at), status, approvedBy, tx: step.call.hash, note: note.replace(/\s+;/g, ";") };
}

function escrowRow(t: Trail, state: ChainState, base: Omit<LedgerRow, "status" | "approvedBy" | "tx" | "date" | "note">): LedgerRow {
  const fromTrail = STEP_STATUS[t.steps[t.steps.length - 1].kind];
  const view = state.escrows.get(t.id);
  const status = view ? ESCROW_STATUS[view.state] : fromTrail;
  const aside = last(t.steps, (s) => s.kind === "set-aside");
  const confirmed = last(t.steps, (s) => s.kind === "confirmed" || s.kind === "released-on-confirm");
  const setAside = aside ? `Set aside in the contract ${when(aside)}` : "Set aside in the contract";
  const byPayee = confirmed ? `the payee confirmed the terms from their own NEAR account ${when(confirmed)}` : "";
  let step: Step;
  let approvedBy: LedgerApprover;
  let note: string;
  switch (status) {
    case "held for approval":
      step = last(t.steps, (s) => s.kind === "parked") ?? t.steps[t.steps.length - 1];
      approvedBy = "";
      note = `Over your ${capName(t.reason)}, so the deal waits for your wallet before its money is set aside. Nothing has moved.`;
      break;
    case "in escrow":
      step = aside ?? t.steps[t.steps.length - 1];
      approvedBy = signedBy(step.call, false);
      note = byPayee ? `${setAside}; ${byPayee}. It's paid when you release it. Not paid yet.` : `${setAside}; waits for the payee to confirm the terms from their own NEAR account. Not paid yet.`;
      break;
    case "released": {
      const onConfirm = last(t.steps, (s) => s.kind === "released" || s.kind === "released-on-confirm");
      step = onConfirm ?? t.steps[t.steps.length - 1];
      approvedBy = step.kind === "released-on-confirm" ? "the payee confirmed" : "the payee confirmed, then you released it";
      note = step.kind === "released-on-confirm" ? `${setAside}; ${byPayee}, which released it to them.` : `${setAside}; ${byPayee || "the payee confirmed the terms"}; then you released it to them.`;
      break;
    }
    default: {
      step = last(t.steps, (s) => s.kind === "cancelled" || s.kind === "returned") ?? t.steps[t.steps.length - 1];
      const payeeGave = step.kind === "returned" || view?.state === "returned";
      approvedBy = payeeGave ? "the payee" : "your wallet";
      note = `${setAside}; ${payeeGave ? "the payee gave it back" : "you took it back in your wallet"}. The amount is back in your agent wallet; nothing was paid.`;
    }
  }
  if (status !== fromTrail) note += ` (The transactions read here end with it ${fromTrail}; the contract says ${status} now.)`;
  return { ...base, amount: base.amount ?? amountOf(view?.amount), date: ledgerTime(step.call.at), status, approvedBy, tx: step.call.hash, note };
}

/**
 * The ledger for one owner: a row per payment, escrow, deposit and withdrawal, where it
 * stands now. The contract's views (`state`) say where a payment or escrow is; the
 * transactions say when, through which transaction, and who signed. Calls the contract
 * refused moved nothing, so they are listed in `skipped` rather than as rows. Oldest first.
 */
export function ledgerFromChain(calls: readonly ChainCall[], state: ChainState, at: ChainPlace): ChainLedger {
  const skipped: ChainLedger["skipped"] = [];
  const proofs = new Map<string, string>();
  const trails = new Map<string, Trail>();
  const own: { at: number; row: LedgerRow }[] = [];

  const trail = (id: string, escrow: boolean, args: Record<string, unknown> = {}): Trail => {
    let t = trails.get(id);
    if (!t) {
      t = { id, escrow, payee: "", amount: null, meetingId: "", memo: "", reason: "", crossChain: false, steps: [] };
      trails.set(id, t);
    }
    t.payee ||= str(args.payee);
    t.amount ??= amountOf(args.amount);
    t.meetingId ||= str(args.meeting_id);
    t.memo ||= str(args.memo);
    t.crossChain ||= Boolean(args.cross_chain);
    return t;
  };
  const step = (t: Trail, kind: StepKind, call: ChainCall) => t.steps.push({ kind, call });
  const ownRow = (call: ChainCall, row: Omit<LedgerRow, "date" | "network" | "tx" | "proofTx" | "meeting">) =>
    own.push({ at: call.at, row: { ...row, date: ledgerTime(call.at), network: at.network, tx: call.hash, proofTx: "", meeting: "" } });

  for (const c of [...calls].sort((a, b) => a.at - b.at)) {
    const a = c.args;
    const byOwner = c.signer === at.owner;
    if (c.receiver === at.usdc && byOwner && c.method === "ft_transfer_call" && a.receiver_id === at.contract) {
      if (c.failure) {
        skipped.push({ hash: c.hash, method: c.method, why: c.failure });
        continue;
      }
      const used = amountOf(c.value);
      if (!used) {
        skipped.push({ hash: c.hash, method: c.method, why: "Not credited (the agent wallet wasn't registered), so the USDC went back" });
        continue;
      }
      ownRow(c, {
        payee: "Your agent wallet",
        payeeAccount: at.contract,
        amount: used,
        status: "deposited",
        approvedBy: "your wallet",
        note: `USDC from your NEAR account ${at.owner} into your agent wallet.`,
      });
      continue;
    }
    if (c.receiver !== at.contract) continue;
    const byPayee = !byOwner && a.owner === at.owner && (LEDGER_CALLS.payee as readonly string[]).includes(c.method);
    if (!(byOwner && (LEDGER_CALLS.owner as readonly string[]).includes(c.method)) && !byPayee) continue;
    if (c.failure) {
      skipped.push({ hash: c.hash, method: c.method, why: c.failure });
      continue;
    }
    const id = str(a.followup_id) || str(a.escrow_id);
    switch (c.method) {
      case "record_proof":
        proofs.set(str(a.meeting_id), c.hash);
        break;
      case "pay": {
        const t = trail(id, false, a);
        const v = (c.value ?? {}) as { status?: unknown; reason?: unknown };
        if (v.status === "blocked") {
          t.reason = str(v.reason);
          step(t, "held", c);
        } else step(t, c.callbacks.on_pay_complete === false || c.callbacks.on_deposit_address_registered === false ? "refunded" : "paid", c);
        break;
      }
      case "approve_pending":
        step(trail(id, false), c.callbacks.on_pay_complete === false ? "refunded" : "approved", c);
        break;
      case "cancel_pending":
        step(trail(id, false), "declined", c);
        break;
      case "open_escrow": {
        const t = trail(id, true, a);
        const v = (c.value ?? {}) as { state?: unknown; reason?: unknown };
        if (v.state === "parked") {
          t.reason = str(v.reason);
          step(t, "parked", c);
        } else step(t, "set-aside", c);
        break;
      }
      case "approve_escrow":
        step(trail(id, true), "set-aside", c);
        break;
      case "confirm_escrow":
        step(trail(id, true), c.value === "released" && c.callbacks.on_escrow_released !== false ? "released-on-confirm" : "confirmed", c);
        break;
      case "release_escrow":
        step(trail(id, true), c.callbacks.on_escrow_released === false ? "release-bounced" : "released", c);
        break;
      case "return_escrow":
        step(trail(id, true), "returned", c);
        break;
      case "cancel_escrow":
        step(trail(id, true), "cancelled", c);
        break;
      case "withdraw": {
        const landed = c.callbacks.on_withdraw_complete !== false;
        ownRow(c, {
          payee: "You",
          payeeAccount: at.owner,
          amount: amountOf(a.amount),
          status: landed ? "withdrawn" : "failed and refunded",
          approvedBy: "your wallet",
          note: landed ? "USDC from your agent wallet back to your NEAR account." : "The withdrawal didn't land, so the contract put the amount back in your agent wallet.",
        });
        break;
      }
    }
  }

  const rows = [...trails.values()].map((t) => {
    const view = state.escrows.get(t.id);
    const payee = t.payee || view?.payee || "";
    const meeting = t.meetingId;
    const base = { meeting, payee: state.labels.get(payee) ?? "", payeeAccount: payee, amount: t.amount, network: at.network, proofTx: proofs.get(meeting) ?? "" };
    const row = t.escrow ? escrowRow(t, state, base) : paymentRow(t, state, base);
    // The Mac app's own memo says nothing a row doesn't; any other is someone's words, kept.
    const extra = [t.memo && t.memo !== PAY_MEMO ? `Memo: "${t.memo}".` : "", meeting ? "" : "No meeting proof is linked to it on NEAR."].filter(Boolean).join(" ");
    return { at: Date.parse(row.date), row: extra ? { ...row, note: `${row.note} ${extra}` } : row };
  });
  return {
    rows: [...rows, ...own].sort((x, y) => x.at - y.at || x.row.tx.localeCompare(y.row.tx)).map((x) => x.row),
    skipped,
  };
}
