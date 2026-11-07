import { openUrl } from "@tauri-apps/plugin-opener";
import {
  buildDealEmail,
  buildRecap,
  CHAIN_NAME,
  dealLink,
  dealTermsFor,
  dealTermsHash,
  dealTermsProblem,
  decodeDeal,
  newDealSalt,
  openEscrowOrRecover,
  crossChainCapRefusal,
  recapFactsFrom,
  claimLink,
  encodePublicProof,
  formatUsdc,
  mailtoLink,
  PAY_MEMO,
  previewOf,
  waitForSettlement,
  type CrossChainPayout,
  type EmailFollowUp,
  type EscrowFollowUp,
  type FollowUp,
  type Meeting,
  type PayeeDestination,
  type PaymentFollowUp,
  type PayoutPreview,
} from "@aftercall/core";
import { HAS_BACKEND, backend } from "./backend";
import { builtInContract, contractFollowupId, near, oneClick, signInWallet, waitFor, DEAL_URL, VERIFY_URL, WEB_URL, type NearConfig } from "./near";
import type { SavedNotes } from "./nearai";
import { recapAgentWork, senderName } from "./RecapSettings";

/** A change to one follow-up; the app applies it and saves the meeting. */
export type Patch = Partial<EmailFollowUp> | Partial<PaymentFollowUp>;
export type Apply = (patch: Patch) => void;

const hhmm = () => new Date().toTimeString().slice(0, 5);

/** The public proof link for a meeting, when its proof is on NEAR. */
function verifyLink(saved?: SavedNotes): string | undefined {
  if (!saved?.onChain) return undefined;
  const { network, contract, owner } = saved.onChain;
  return `${VERIFY_URL}#${encodePublicProof({ network, contract, owner, bundle: saved.proof })}`;
}

/** The public page on what is and isn't checked; the recap footer links it when there's no proof link. */
export const HANDLING_URL = `${WEB_URL}/handling`;

/** What the recap's footer may say about this meeting, from its saved proof. No proof, no claim of checks. */
export function recapFacts(meeting: Meeting, saved?: SavedNotes) {
  const facts = recapFactsFrom(meeting, saved?.proof, HANDLING_URL, verifyLink(saved));
  return { ...facts, verified: facts.verified && !!saved?.proof };
}

/** Opens the recap as a draft in the person's own mail app. Nothing leaves the Mac. */
export async function draftInMail(meeting: Meeting, f: EmailFollowUp, saved?: SavedNotes): Promise<void> {
  await openUrl(mailtoLink(buildRecap(meeting, f, { sender: senderName() || undefined, facts: recapFacts(meeting, saved), agentWork: recapAgentWork() })));
}

/**
 * Sends the recap through the Aftercall backend (Resend), signed in with this Mac's key. Sending
 * a sent recap again is the same call; if that fails, it stays sent (it was, the first time) and
 * says what went wrong.
 */
export async function sendRecap(meeting: Meeting, f: EmailFollowUp, apply: Apply, saved?: SavedNotes): Promise<void> {
  if (!HAS_BACKEND) return apply({ error: "Sending through Aftercall isn't available in this build. Use Draft in Mail." });
  const before = f.status === "sent" ? { status: "sent" as const, doneAt: f.doneAt, ref: f.ref } : { status: "proposed" as const };
  apply({ status: "sending", error: undefined });
  try {
    const config = await near.getConfig();
    const name = senderName();
    const recap = buildRecap(meeting, f, { sender: name || undefined, facts: recapFacts(meeting, saved), agentWork: recapAgentWork() });
    const { id } = await backend.sendRecap({ ...recap, senderName: name || config?.account });
    apply({ status: "sent", doneAt: hhmm(), ref: id });
  } catch (e) {
    apply({ ...before, error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * The meeting's proof as recorded on this network, contract and account, if it is: a payment
 * or escrow there can point to it. A proof recorded elsewhere isn't on this contract.
 */
export function proofHere(saved: SavedNotes | undefined, config: NearConfig | null): { meetingId: string; proofHash: string } | null {
  const on = saved?.onChain;
  if (!on || !config || on.network !== config.network || on.contract !== config.contract || on.owner !== config.account) return null;
  return { meetingId: saved.proof.meetingId, proofHash: on.proofHash };
}

/**
 * Pays through the agent-wallet contract with this Mac's limited key. The contract
 * decides: paid within the caps, blocked for the owner's wallet, or failed and
 * refunded if the transfer bounced. With the meeting's proof on this contract, the
 * payment records which proof it came from.
 */
export async function pay(meeting: Meeting, f: PaymentFollowUp, apply: Apply, saved?: SavedNotes): Promise<void> {
  if (f.amount === null || !f.payeeListed || f.escrow) return;
  apply({ status: "sending", error: undefined });
  try {
    // Kept on a held payment: only this contract and account can say it was declined (`heldPaymentOutcome`).
    const config = await near.getConfig();
    const proof = proofHere(saved, config);
    const out = await near.pay(f.payeeAccount, f.amount, PAY_MEMO, contractFollowupId(meeting.id, f.id), proof?.meetingId);
    if (out.status === "paid") apply({ status: "paid", doneAt: hhmm(), ref: out.txHash });
    else if (out.status === "blocked") apply({ status: "blocked", ref: out.txHash, heldOn: config ? { network: config.network, contract: config.contract, account: config.account } : undefined });
    else apply({ status: "failed", ref: out.txHash, error: "The transfer bounced and the amount went back to your agent wallet. Check the payee can receive USDC." });
  } catch (e) {
    apply({ status: "proposed", error: plainPayError(e) });
  }
}

function plainPayError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes("STORAGE_CREDIT_LOW")) return "Your agent wallet's storage credit has run out. Top it up from your NEAR wallet, then try again.";
  if (message.includes("ESCROW_EXISTS")) return "This payment is held in escrow already. It's paid when you release it.";
  if (message.includes("PROOF_NOT_FOUND")) return "This meeting's proof isn't on your agent wallet's contract. Record it from Verify, then try again.";
  return message.includes("NO_DESTINATION")
    ? "This payee isn't set up to be paid on another chain any more. Check them in your agent wallet."
    : message.includes("UNKNOWN_PAYEE")
      ? "That payee isn't on your agent wallet's list."
      : message.includes("LOW_BALANCE")
        ? "Not enough USDC in your agent wallet. Deposit some first."
        : message.includes("PAUSED")
          ? "Payments are paused in your agent wallet."
          : message.includes("ALREADY_PAID")
            ? "This follow-up was already paid."
            : message;
}

/** 1Click runs on NEAR mainnet only. Returns the owner's account, where refunds go. */
async function intentsOwner(): Promise<string> {
  const config = await near.getConfig();
  if (!config) throw new Error("Connect your NEAR account first.");
  if (config.network !== "mainnet") throw new Error("NEAR Intents runs on NEAR mainnet only; this agent wallet is on testnet.");
  return config.account;
}

/**
 * 1Click quotes only with a refund account that exists on NEAR mainnet. A dry quote creates
 * no deposit address and never refunds anything, so off mainnet (testnet, or the browser
 * preview) it asks with the `near` account in that place; the amounts don't depend on it.
 */
const DRY_QUOTE_REFUND = "near";

/** A live quote; `quoteOnly` when this agent wallet can't send it (not on mainnet). */
export type RoutePreview = PayoutPreview & { quoteOnly?: boolean };

/** The latest preview per route and amount, for a paired phone's snapshot (`quoted`). Approving always asks again. */
const previews = new Map<string, { amountOut: string; at: number }>();
const previewKey = (f: PaymentFollowUp, dest: PayeeDestination) => `${dest.chain}:${dest.address}:${f.amount}`;
export const latestPreview = (f: PaymentFollowUp, dest: PayeeDestination) => previews.get(previewKey(f, dest));

/** A dry 1Click quote: what the payee would get, without creating a deposit address. */
export async function previewCrossChain(f: PaymentFollowUp, dest: PayeeDestination): Promise<RoutePreview> {
  if (f.amount === null) throw new Error("Amount unclear");
  const config = await near.getConfig().catch(() => null);
  const mainnet = config?.network === "mainnet";
  const refundTo = mainnet && config ? config.account : DRY_QUOTE_REFUND;
  const preview = previewOf(await oneClick.quote({ amount: f.amount, chain: dest.chain, recipient: dest.address, refundTo, dry: true }));
  previews.set(previewKey(f, dest), { amountOut: preview.amountOut.toString(), at: Date.now() });
  return mainnet ? preview : { ...preview, quoteOnly: true };
}

/** Refuse a quote that keeps more than 3% of the amount (USDC to USDC should cost cents). */
const MAX_FEE_BPS = 300n;

/**
 * Pays a payee's Solana or Base address through NEAR Intents: a fresh 1Click quote,
 * then the contract's `pay` with that quote's deposit address (same limited key, same
 * caps), then 1Click's status until the USDC lands or is refunded. Never on autopilot.
 */
export async function payCrossChain(meeting: Meeting, f: PaymentFollowUp, dest: PayeeDestination, apply: Apply, saved?: SavedNotes): Promise<void> {
  if (f.amount === null || !f.payeeListed || f.escrow) return;
  apply({ status: "sending", error: undefined });
  let route: CrossChainPayout;
  try {
    const owner = await intentsOwner();
    // Refunds go to the owner's own NEAR account: a plain transfer can't credit the agent wallet.
    const q = await oneClick.quote({ amount: f.amount, chain: dest.chain, recipient: dest.address, refundTo: owner, dry: false });
    const p = previewOf(q);
    if (p.fee * 10_000n > f.amount * MAX_FEE_BPS) throw new Error(`NEAR Intents quoted ${formatUsdc(p.fee)} USDC in fees, over 3%. Nothing was sent.`);
    route = { chain: dest.chain, address: dest.address, depositAddress: q.quote.depositAddress!, quoteId: q.correlationId, amountOut: q.quote.amountOut, swapStatus: "PENDING_DEPOSIT" };
    const proof = proofHere(saved, await near.getConfig());
    const out = await near.payCrossChain(f.payeeAccount, f.amount, PAY_MEMO, contractFollowupId(meeting.id, f.id), route.depositAddress, route.quoteId, proof?.meetingId);
    if (out.status === "blocked") {
      // Nothing is parked: the quote would expire before the owner could approve it. The daily
      // cap says whether waiting for the next day could ever let it through.
      const w = (await near.wallet().catch(() => null))?.wallet;
      const dailyCap = w ? BigInt(w.daily_cap) : null;
      const leftToday = out.leftToday === null ? null : BigInt(out.leftToday);
      // The refused pay rolled the contract's day, so the wallet's cross-chain spending is today's.
      const crossCap = w ? BigInt(w.cross_chain_daily_cap) : 0n;
      const crossSpent = w ? BigInt(w.cross_chain_spent_today) : 0n;
      const crossChain = w ? { cap: crossCap, left: crossCap > crossSpent ? crossCap - crossSpent : 0n } : null;
      return apply({ status: "proposed", error: crossChainCapRefusal(f.amount, out.reason, leftToday, dailyCap, crossChain) });
    }
    if (out.status === "failed") {
      return apply({ status: "failed", ref: out.txHash, error: "The transfer to NEAR Intents bounced and the amount went back to your agent wallet." });
    }
    apply({ ref: out.txHash, crossChain: route });
    oneClick.submitDeposit(out.txHash, route.depositAddress, owner).catch(() => {});
  } catch (e) {
    return apply({ status: "proposed", error: plainPayError(e) });
  }
  await followCrossChain(route, apply);
}

/** Polls 1Click until the payout settles, updating the follow-up as it goes. */
export async function followCrossChain(route: CrossChainPayout, apply: Apply): Promise<void> {
  const where = CHAIN_NAME[route.chain];
  try {
    const s = await waitForSettlement(oneClick, route.depositAddress, {
      onStatus: (x) => apply({ crossChain: { ...route, swapStatus: x.status } }),
    });
    const payoutTxUrl = s.swapDetails.destinationChainTxHashes[0]?.explorerUrl;
    const done = { ...route, swapStatus: s.status, payoutTxUrl };
    if (s.status === "SUCCESS") apply({ status: "paid", doneAt: hhmm(), crossChain: done });
    else if (s.status === "REFUNDED") apply({ status: "failed", crossChain: done, error: `NEAR Intents couldn't pay on ${where} and refunded your NEAR account (not the agent wallet).` });
    else if (s.status === "FAILED") apply({ status: "failed", crossChain: done, error: `NEAR Intents reported the ${where} payout failed. Look the deposit address up on the NEAR Intents explorer.` });
    else apply({ crossChain: done, error: `Still ${s.status.toLowerCase().replace(/_/g, " ")} on NEAR Intents after 10 minutes.` });
  } catch (e) {
    apply({ error: `Couldn't read the NEAR Intents status: ${e instanceof Error ? e.message : String(e)}` });
  }
}

/**
 * Creates a claim link for a payee who isn't on the list, and copies it. The backend
 * gets only the amount; the payee's name and the meeting title go in the link's
 * #fragment, which never reaches a server (see packages/core claimLink.ts).
 */
export async function createClaim(meeting: Meeting, f: PaymentFollowUp, apply: Apply): Promise<void> {
  if (f.amount === null) return;
  try {
    const { id, token } = await backend.createClaim({ amount: f.amount.toString() });
    const link = claimLink(`${WEB_URL}/claim`, token, { payeeName: f.payeeName, meeting: meeting.title });
    await navigator.clipboard.writeText(link).catch(() => {});
    apply({ claim: { id, link }, error: undefined });
  } catch (e) {
    apply({ error: e instanceof Error ? e.message : String(e) });
  }
}

/** The owner confirms the shared account in their wallet; once it's a payee, the payment can go. */
export async function confirmClaim(f: PaymentFollowUp, apply: Apply): Promise<void> {
  const account = f.claim?.account;
  if (!account) return;
  try {
    const check = await near.checkPayee(account);
    if (!check.exists) return apply({ error: `${account} doesn't exist on NEAR.` });
    await signInWallet({ kind: "add-payee", account, label: f.payeeName, registerWithUsdc: !check.usdcReady });
    const added = await waitFor(async () => (await near.wallet()).payees.some((p) => p.account === account));
    if (added) apply({ payeeListed: true, payeeAccount: account, error: undefined });
    else apply({ error: "Didn't see the new payee on NEAR yet. If you signed, it will show up in a moment." });
  } catch (e) {
    apply({ error: e instanceof Error ? e.message : String(e) });
  }
}

/** Accounts payees have shared through claim links, by claim id. */
export async function claimedAccounts(): Promise<Record<string, string>> {
  if (!HAS_BACKEND) return {};
  const claims = await backend.claims();
  return Object.fromEntries(claims.filter((c) => c.claimedAccount).map((c) => [c.id, c.claimedAccount!]));
}

export function waitingForClaims(meetings: Meeting[]): boolean {
  return meetings.some((m) => m.followUps.some((f: FollowUp) => f.kind === "payment" && f.claim && !f.claim.account && !f.payeeListed));
}

// ---------- Handshake: a deal both sides confirm, held in escrow ----------

/** Thrown when this Mac's key was added before escrows: the owner's wallet updates it once. */
export class KeyNeedsUpdate extends Error {}

/**
 * Holds a payment in escrow for the payee to confirm, and copies their confirm link. The
 * contract sets the money aside within the caps (or parks it for your wallet) and keeps the
 * meeting's proof hash and a salted hash of the terms; the terms themselves ride in the link's
 * #fragment. Needs the meeting's proof on this contract, and a key that may open escrows.
 */
export async function holdInEscrow(meeting: Meeting, f: PaymentFollowUp, apply: Apply, saved?: SavedNotes): Promise<void> {
  if (f.amount === null || !f.payeeListed || f.escrow) return;
  apply({ status: "sending", error: undefined });
  try {
    const config = await near.getConfig();
    if (!config) throw new Error("Connect your NEAR account first.");
    // /deal vouches only for Aftercall's own contract, so a deal elsewhere could never be confirmed there.
    if (config.contract !== builtInContract(config.network)) throw new Error(`Deals held in escrow work only on Aftercall's own contract on ${config.network}; the payee's confirm page won't vouch for ${config.contract}.`);
    const proof = proofHere(saved, config);
    if (!proof) throw new Error("Record this meeting's proof on NEAR first (Verify), so the deal points to it.");
    const status = await near.status();
    if (!status.registered || !status.keyAdded) throw new Error("Finish setting up payments in Settings first: this Mac's key isn't on your account.");
    if (!status.keyEscrow) {
      await signInWallet({ kind: "update-key", publicKey: status.publicKey });
      throw new KeyNeedsUpdate("This Mac's key was added before deals in escrow. Approve the update in your wallet, then ask again.");
    }
    const escrowId = contractFollowupId(meeting.id, f.id);
    const terms = dealTermsFor(meeting, f, { network: config.network, contract: config.contract, owner: config.account, escrowId, ...proof, salt: newDealSalt() });
    if (!terms)
      throw new Error(
        f.conditionDropped
          ? "The call may have set a condition that isn't in the transcript, so this can't be held as a deal without one: confirming would pay at once. Check the call, then pay it yourself when it's met."
          : "This payment needs an amount and a listed payee first.",
      );
    // Once the money is set aside, a link the confirm page refuses could never be confirmed.
    const problem = dealTermsProblem(terms);
    if (problem) throw new Error(problem);
    const termsHash = dealTermsHash(terms);
    const amount = f.amount;
    // If the answer is lost but the escrow landed, keep its link: without it nobody could confirm it.
    const out = await openEscrowOrRecover(
      () => near.openEscrow(escrowId, f.payeeAccount, amount, proof.meetingId, termsHash, terms.condition !== null),
      () => near.escrow(escrowId),
      termsHash,
    );
    const link = dealLink(DEAL_URL, terms);
    const ref = "txHash" in out ? out.txHash : undefined;
    const escrow: EscrowFollowUp = { id: escrowId, state: out.state, link, termsHash, on: { network: config.network, contract: config.contract, account: config.account }, ref };
    apply({ status: "proposed", escrow, error: undefined, autopilotAt: undefined });
    await navigator.clipboard.writeText(link).catch(() => {});
  } catch (e) {
    apply({ status: "proposed", error: e instanceof KeyNeedsUpdate ? e.message : plainPayError(e) });
  }
}

/** The escrow's state as the contract has it now; released means paid. */
export async function refreshEscrow(f: PaymentFollowUp, apply: Apply): Promise<void> {
  if (!f.escrow) return;
  const config = await near.getConfig().catch(() => null);
  // Only the contract and account it was opened on know it.
  if (!config || config.network !== f.escrow.on.network || config.contract !== f.escrow.on.contract || config.account !== f.escrow.on.account) return;
  const view = await near.escrow(f.escrow.id).catch(() => null);
  if (!view || view.state === f.escrow.state) return;
  apply({ escrow: { ...f.escrow, state: view.state }, ...(view.state === "released" && f.status !== "paid" ? { status: "paid" as const, doneAt: hhmm() } : {}) });
}

/** Pays a confirmed escrow to the payee with this Mac's key. Its amount was counted against the caps when it was set aside. */
export async function releaseEscrow(f: PaymentFollowUp, apply: Apply): Promise<void> {
  if (!f.escrow || f.escrow.state !== "confirmed") return;
  apply({ status: "sending", error: undefined });
  try {
    const out = await near.releaseEscrow(f.escrow.id);
    if (out.state === "released") apply({ status: "paid", doneAt: hhmm(), ref: out.txHash, escrow: { ...f.escrow, state: "released", releasedRef: out.txHash } });
    else apply({ status: "proposed", escrow: { ...f.escrow, state: out.state }, error: "The transfer bounced, so the money is still held. Check the payee can receive USDC, then release it again." });
  } catch (e) {
    apply({ status: "proposed", error: plainPayError(e) });
  }
}

/** Opens your wallet to set aside a deal the contract parked over a cap, or to take one back. */
export async function escrowInWallet(f: PaymentFollowUp, kind: "approve-escrow" | "cancel-escrow", apply: Apply): Promise<void> {
  if (!f.escrow || f.amount === null) return;
  try {
    await signInWallet({ kind, escrowId: f.escrow.id, payee: f.payeeAccount, amount: f.amount.toString(), payeeName: f.payeeName });
  } catch (e) {
    apply({ error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Emails the confirm link through Aftercall's backend, the recap's way: in memory for one
 * request, then Resend, under the same 50-a-day limit. The link carries the terms, quotes
 * included, so they pass through both, as a recap's text does.
 */
export async function emailDealLink(f: PaymentFollowUp, to: string, apply: Apply): Promise<void> {
  if (!f.escrow) return;
  if (!HAS_BACKEND) return apply({ error: "Sending through Aftercall isn't available in this build. Copy the link instead." });
  try {
    const terms = decodeDeal(f.escrow.link.split("#")[1] ?? "");
    const name = senderName();
    const config = await near.getConfig();
    const mail = buildDealEmail(terms, f.escrow.link, name || undefined);
    await backend.sendRecap({ to: to.trim(), ...mail, senderName: name || config?.account });
    apply({ escrow: { ...f.escrow, emailedAt: hhmm() }, error: undefined });
  } catch (e) {
    apply({ error: e instanceof Error ? e.message : String(e) });
  }
}

export function waitingOnEscrows(meetings: Meeting[]): boolean {
  return meetings.some((m) => m.followUps.some((f: FollowUp) => f.kind === "payment" && !!f.escrow && ["parked", "open", "confirmed"].includes(f.escrow.state)));
}
