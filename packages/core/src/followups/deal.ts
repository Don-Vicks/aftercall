import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, randomBytes, utf8ToBytes } from "@noble/hashes/utils";
import type { EscrowState, Meeting, PaymentFollowUp } from "../meeting.ts";
import { formatUsdc } from "../money.ts";
import { NETWORK_CONFIG, isNetwork, type Network } from "../network.ts";
import { isAccountId, type WalletTransaction } from "../wallet/actions.ts";
import { RECAP_FOOTER_MARK } from "./recap.ts";

/**
 * Handshake: a payment agreed on a call that both sides confirm, held in escrow on the
 * agent-wallet contract until it's released (docs/handshake.md).
 *
 * The terms (amount, the words heard, the condition and the exact quotes) never go on
 * chain. The contract keeps only `dealTermsHash` of them, with a random salt so the hash
 * can't be used to guess the quotes. The terms travel to the payee in the confirm link's
 * #fragment, which browsers never send to a server; the /deal page recomputes the hash
 * and checks it, the amount, the payee and the meeting's proof against the escrow on
 * NEAR before the payee confirms.
 */

/** Everything the payee is shown, and checks, before confirming. */
export interface DealTerms {
  v: 1;
  network: Network;
  /** The agent-wallet contract holding the escrow. */
  contract: string;
  /** The escrow's id on the contract (the follow-up's contract id). */
  escrowId: string;
  /** Who pays: the owner's NEAR account. */
  owner: string;
  /** Who is paid: their NEAR account, the one that must confirm. */
  payee: string;
  /** USDC base units (6 decimals). */
  amount: string;
  /** The words said about the amount. */
  heard: string;
  /** The exact words from the call where the payment was agreed. */
  amountQuote: string;
  /** What must happen before it's paid, in plain words; null when nothing does. */
  condition: string | null;
  /** The exact words from the call where the condition was said; null with no condition. */
  conditionQuote: string | null;
  /** The id the meeting's proof was recorded under, and its hash on NEAR. */
  meetingId: string;
  proofHash: string;
  /** 32 random hex characters, so the hash on chain says nothing about the words. */
  salt: string;
  /** Shown only, not part of the terms: what the payer calls the payee, and the meeting's title. */
  payeeName?: string;
  meetingTitle?: string;
}

/** An escrow as the contract's `get_escrow` returns it. */
export interface EscrowView {
  payee: string;
  amount: string;
  proof: { meeting_id: string; proof_hash: string };
  terms_hash: string;
  has_condition: boolean;
  state: EscrowState;
  day: number;
  opened_at: string;
  confirmed_at: string;
}

/** The terms in a fixed order, as hashed. Display-only fields are left out. */
function canonicalTerms(t: DealTerms): string {
  return JSON.stringify([
    "aftercall-deal-v1",
    t.network,
    t.contract,
    t.escrowId,
    t.owner,
    t.payee,
    t.amount,
    t.heard,
    t.amountQuote,
    t.condition,
    t.conditionQuote,
    t.meetingId,
    t.proofHash,
    t.salt,
  ]);
}

/** sha256 of the terms, 64 lowercase hex: what `open_escrow` stores and `confirm_escrow` checks. */
export function dealTermsHash(t: DealTerms): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalTerms(t))));
}

export const newDealSalt = (): string => bytesToHex(randomBytes(16));

/** Where the money is and what it waits for, in a few words for the follow-up card and the deal page. */
export function escrowStateText(state: EscrowState, payeeName: string): string {
  switch (state) {
    case "parked":
      return "Over your caps: waiting for your wallet to set it aside";
    case "open":
      return `Set aside · waiting for ${payeeName} to confirm`;
    case "confirmed":
      return `${payeeName} confirmed · waiting for you to release it`;
    case "released":
      return `Released to ${payeeName}`;
    case "cancelled":
      return "Cancelled · the money went back to your agent wallet";
    case "returned":
      return `${payeeName} gave it back · the money went back to your agent wallet`;
  }
}

/**
 * The terms of a payment follow-up, ready to hash and put in a link. Null when it can't be a deal
 * yet, and when the model heard a condition it couldn't quote (`conditionDropped`): held without
 * one, the payee's confirmation would pay them at once, as if the call had set none.
 */
export function dealTermsFor(
  meeting: Pick<Meeting, "title">,
  f: PaymentFollowUp,
  at: { network: Network; contract: string; owner: string; escrowId: string; meetingId: string; proofHash: string; salt: string },
): DealTerms | null {
  if (f.amount === null || !f.payeeListed || !f.payeeAccount || !f.evidence || f.conditionDropped) return null;
  return {
    v: 1,
    network: at.network,
    contract: at.contract,
    escrowId: at.escrowId,
    owner: at.owner,
    payee: f.payeeAccount,
    amount: f.amount.toString(),
    heard: f.heard,
    amountQuote: f.evidence.quote,
    condition: f.condition?.text ?? null,
    conditionQuote: f.condition?.evidence.quote ?? null,
    meetingId: at.meetingId,
    proofHash: at.proofHash,
    salt: at.salt,
    payeeName: f.payeeName,
    meetingTitle: meeting.title,
  };
}

// ---------- the confirm link ----------

function toBase64Url(text: string): string {
  let s = "";
  for (const b of new TextEncoder().encode(text)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
}

const LIMITS = { heard: 200, amountQuote: 600, condition: 200, conditionQuote: 600, payeeName: 80, meetingTitle: 120 } as const;
const HEX = (n: number) => new RegExp(`^[0-9a-f]{${n}}$`);

/** The payee's confirm page with the terms in its #fragment, never in a query string. */
export function dealLink(dealPageUrl: string, t: DealTerms): string {
  return `${dealPageUrl}#${toBase64Url(JSON.stringify(t))}`;
}

/** Reads and checks the terms from a confirm link's fragment. Anything unexpected is refused. */
export function decodeDeal(fragment: string): DealTerms {
  const t = JSON.parse(fromBase64Url(fragment.replace(/^#/, ""))) as DealTerms;
  if (t === null || typeof t !== "object" || t.v !== 1) throw new Error("BAD_DEAL");
  if (!isNetwork(t.network)) throw new Error("BAD_NETWORK");
  if (!isAccountId(t.contract) || !isAccountId(t.owner) || !isAccountId(t.payee)) throw new Error("BAD_ACCOUNT");
  if (typeof t.escrowId !== "string" || !t.escrowId || t.escrowId.length > 64 || typeof t.meetingId !== "string" || !t.meetingId || t.meetingId.length > 64) throw new Error("BAD_DEAL");
  if (typeof t.amount !== "string" || !/^[1-9]\d{0,29}$/.test(t.amount)) throw new Error("BAD_AMOUNT");
  if (typeof t.proofHash !== "string" || !t.proofHash || t.proofHash.length > 128 || typeof t.salt !== "string" || !HEX(32).test(t.salt)) throw new Error("BAD_DEAL");
  for (const k of ["heard", "amountQuote"] as const) if (typeof t[k] !== "string" || !t[k] || t[k].length > LIMITS[k]) throw new Error("BAD_DEAL");
  if ((t.condition === null) !== (t.conditionQuote === null)) throw new Error("BAD_DEAL");
  for (const k of ["condition", "conditionQuote"] as const) if (t[k] !== null && (typeof t[k] !== "string" || !t[k] || t[k]!.length > LIMITS[k])) throw new Error("BAD_DEAL");
  for (const k of ["payeeName", "meetingTitle"] as const) if (t[k] !== undefined && (typeof t[k] !== "string" || t[k]!.length > LIMITS[k])) throw new Error("BAD_DEAL");
  return t;
}

// ---------- checking the link against NEAR ----------

export interface DealCheck {
  label: string;
  ok: boolean;
  detail: string;
}

/**
 * The link's terms against the escrow and the proof on NEAR. Every line must pass before
 * the payee may confirm: the contract must be Aftercall's own on that network (any other could
 * claim to hold anything), the hash on chain must be the hash of exactly these terms, and the
 * amount, payee, condition and the meeting's proof must be the escrow's own.
 */
export function checkDeal(t: DealTerms, escrow: EscrowView | null, proof: { proof_hash: string } | null): DealCheck[] {
  // Any contract can answer get_escrow with whatever it likes: only Aftercall's own holds the money by its rules.
  const ours = NETWORK_CONFIG[t.network].agentWallet;
  const contract: DealCheck =
    t.contract === ours
      ? { label: "Aftercall's contract", ok: true, detail: `${t.contract} on ${t.network}` }
      : { label: "Aftercall's contract", ok: false, detail: `${t.contract} isn't Aftercall's contract on ${t.network}, so what it says it holds can't be trusted` };
  if (!escrow) return [contract, { label: "Held on NEAR", ok: false, detail: `No escrow ${t.escrowId} for ${t.owner} on ${t.contract}` }];
  const hash = dealTermsHash(t);
  const amount = BigInt(escrow.amount);
  return [
    contract,
    { label: "Held on NEAR", ok: true, detail: `Escrow ${t.escrowId} on ${t.contract}` },
    { label: "These exact terms", ok: escrow.terms_hash === hash, detail: escrow.terms_hash === hash ? `sha256 ${hash.slice(0, 16)}… matches` : "The hash on NEAR is of different terms" },
    { label: "Amount", ok: escrow.amount === t.amount, detail: `${formatUsdc(amount)} USDC on NEAR` },
    { label: "Paid to", ok: escrow.payee === t.payee, detail: escrow.payee },
    {
      label: "Condition",
      ok: escrow.has_condition === (t.condition !== null),
      detail: escrow.has_condition ? "On NEAR: it waits for the payer to release it" : "On NEAR: none, so confirming pays you",
    },
    {
      label: "The meeting's proof",
      ok: escrow.proof.meeting_id === t.meetingId && escrow.proof.proof_hash === t.proofHash && proof?.proof_hash === t.proofHash,
      detail: proof ? `sha256 ${t.proofHash.slice(0, 16)}… recorded by ${t.owner}` : "No proof on NEAR for this meeting",
    },
  ];
}

/**
 * Reads the escrow and the meeting's proof straight from the contract over NEAR RPC, at final
 * finality, for the /deal page. Read-only; `fetchImpl` is swapped in tests.
 */
export async function readDealOnChain(t: DealTerms, rpcUrl: string, fetchImpl: typeof fetch = fetch): Promise<{ escrow: EscrowView | null; proof: { proof_hash: string } | null }> {
  const view = async <T>(method: string, args: Record<string, string>): Promise<T> => {
    const res = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "deal",
        method: "query",
        params: { request_type: "call_function", finality: "final", account_id: t.contract, method_name: method, args_base64: btoa(JSON.stringify(args)) },
      }),
    });
    const body = (await res.json()) as { error?: unknown; result?: { error?: unknown; result?: number[] } };
    const err = body.error ?? body.result?.error;
    if (err) throw new Error(typeof err === "string" ? err : JSON.stringify(err));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(body.result?.result ?? []))) as T;
  };
  const [escrow, proof] = await Promise.all([
    view<EscrowView | null>("get_escrow", { owner: t.owner, escrow_id: t.escrowId }),
    view<{ proof_hash: string } | null>("get_proof", { owner: t.owner, meeting_id: t.meetingId }),
  ]);
  return { escrow, proof };
}

/** The payee's own transaction: confirm exactly these terms. 1 yoctoNEAR, so only a full-access key can sign it. */
export function confirmEscrowTransaction(t: DealTerms): WalletTransaction {
  return {
    receiverId: t.contract,
    actions: [
      {
        type: "FunctionCall",
        params: { methodName: "confirm_escrow", args: { owner: t.owner, escrow_id: t.escrowId, terms_hash: dealTermsHash(t) }, gas: "100000000000000", deposit: "1" },
      },
    ],
  };
}

/** The payee gives the money back to the payer (both agree to call it off). */
export function returnEscrowTransaction(t: DealTerms): WalletTransaction {
  return {
    receiverId: t.contract,
    actions: [{ type: "FunctionCall", params: { methodName: "return_escrow", args: { owner: t.owner, escrow_id: t.escrowId }, gas: "30000000000000", deposit: "1" } }],
  };
}

/**
 * The email that carries the confirm link when it's sent through Aftercall. It goes the
 * recap's way (the backend's 50-a-day limit, held in memory for one request), so it ends with
 * a footer holding the recap's mark, saying only what the page checks.
 */
export function buildDealEmail(t: DealTerms, link: string, sender?: string): { subject: string; text: string } {
  const who = sender?.trim() || t.owner;
  const amount = `${formatUsdc(BigInt(t.amount))} USDC`;
  const lines = [
    `${who} agreed to pay you ${amount} on a call${t.meetingTitle ? ` (${t.meetingTitle})` : ""}${t.condition ? `, ${t.condition}` : ""}. The money is held in escrow on NEAR.`,
    "",
    "Check the terms and confirm them with your own NEAR wallet:",
    link,
    "",
    t.condition
      ? `Once you confirm, ${who} releases it to ${t.payee} when the condition is met.`
      : `Once you confirm, it's paid to ${t.payee} straight away.`,
    "",
    "—",
    RECAP_FOOTER_MARK,
    "The page checks the terms in the link against the escrow on NEAR: the hash of these exact terms, the amount, your account and the meeting's proof. Aftercall can't check whether a condition was met; only the payer can release the money. The words quoted are from the call, as transcribed.",
  ];
  return { subject: `Confirm: ${amount} from ${who}`, text: lines.join("\n") };
}
