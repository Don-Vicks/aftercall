import { openUrl } from "@tauri-apps/plugin-opener";
import {
  buildRecap,
  CHAIN_NAME,
  encodePublicProof,
  formatUsdc,
  mailtoLink,
  previewOf,
  waitForSettlement,
  type CrossChainPayout,
  type EmailFollowUp,
  type FollowUp,
  type Meeting,
  type PayeeDestination,
  type PaymentFollowUp,
  type PayoutPreview,
} from "@aftercall/core";
import { backend } from "./backend";
import { contractFollowupId, near, oneClick, signInWallet, waitFor, VERIFY_URL, WEB_URL } from "./near";
import type { SavedNotes } from "./nearai";

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

/** Opens the recap as a draft in the person's own mail app. Nothing leaves the Mac. */
export async function draftInMail(meeting: Meeting, f: EmailFollowUp, saved?: SavedNotes): Promise<void> {
  await openUrl(mailtoLink(buildRecap(meeting, f, { verifyUrl: verifyLink(saved) })));
}

/** Sends the recap through the Aftercall backend (Resend), signed in with this Mac's key. */
export async function sendRecap(meeting: Meeting, f: EmailFollowUp, apply: Apply, saved?: SavedNotes): Promise<void> {
  apply({ status: "sending", error: undefined });
  try {
    const config = await near.getConfig();
    const recap = buildRecap(meeting, f, { verifyUrl: verifyLink(saved) });
    const { id } = await backend.sendRecap({ ...recap, senderName: config?.account });
    apply({ status: "sent", doneAt: hhmm(), ref: id });
  } catch (e) {
    apply({ status: "proposed", error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Pays through the agent-wallet contract with this Mac's limited key. The contract
 * decides: paid within the caps, blocked for the owner's wallet, or failed and
 * refunded if the transfer bounced.
 */
export async function pay(meeting: Meeting, f: PaymentFollowUp, apply: Apply): Promise<void> {
  if (f.amount === null || !f.payeeListed) return;
  apply({ status: "sending", error: undefined });
  try {
    const out = await near.pay(f.payeeAccount, f.amount, `Aftercall: ${meeting.title}`.slice(0, 60), contractFollowupId(meeting.id, f.id));
    if (out.status === "paid") apply({ status: "paid", doneAt: hhmm(), ref: out.txHash });
    else if (out.status === "blocked") apply({ status: "blocked", ref: out.txHash });
    else apply({ status: "failed", ref: out.txHash, error: "The transfer bounced and the amount went back to your agent wallet. Check the payee can receive USDC." });
  } catch (e) {
    apply({ status: "proposed", error: plainPayError(e) });
  }
}

function plainPayError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
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

/** A dry 1Click quote: what the payee would get, without creating a deposit address. */
export async function previewCrossChain(f: PaymentFollowUp, dest: PayeeDestination): Promise<PayoutPreview> {
  if (f.amount === null) throw new Error("Amount unclear");
  const owner = await intentsOwner();
  return previewOf(await oneClick.quote({ amount: f.amount, chain: dest.chain, recipient: dest.address, refundTo: owner, dry: true }));
}

/** Refuse a quote that keeps more than 3% of the amount (USDC to USDC should cost cents). */
const MAX_FEE_BPS = 300n;

/**
 * Pays a payee's Solana or Base address through NEAR Intents: a fresh 1Click quote,
 * then the contract's `pay` with that quote's deposit address (same limited key, same
 * caps), then 1Click's status until the USDC lands or is refunded. Never on autopilot.
 */
export async function payCrossChain(meeting: Meeting, f: PaymentFollowUp, dest: PayeeDestination, apply: Apply): Promise<void> {
  if (f.amount === null || !f.payeeListed) return;
  apply({ status: "sending", error: undefined });
  let route: CrossChainPayout;
  try {
    const owner = await intentsOwner();
    // Refunds go to the owner's own NEAR account: a plain transfer can't credit the agent wallet.
    const q = await oneClick.quote({ amount: f.amount, chain: dest.chain, recipient: dest.address, refundTo: owner, dry: false });
    const p = previewOf(q);
    if (p.fee * 10_000n > f.amount * MAX_FEE_BPS) throw new Error(`NEAR Intents quoted ${formatUsdc(p.fee)} USDC in fees, over 3%. Nothing was sent.`);
    route = { chain: dest.chain, address: dest.address, depositAddress: q.quote.depositAddress!, quoteId: q.correlationId, amountOut: q.quote.amountOut, swapStatus: "PENDING_DEPOSIT" };
    const out = await near.payCrossChain(f.payeeAccount, f.amount, `Aftercall: ${meeting.title}`.slice(0, 60), contractFollowupId(meeting.id, f.id), route.depositAddress, route.quoteId);
    if (out.status === "blocked") {
      // Nothing is parked: the quote would expire before the owner could approve it.
      return apply({ status: "proposed", error: "Over your caps. A payment on another chain can't wait for approval; raise the cap in your agent wallet, then try again." });
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

/** Creates a claim link for a payee who isn't on the list, and copies it. */
export async function createClaim(meeting: Meeting, f: PaymentFollowUp, apply: Apply): Promise<void> {
  if (f.amount === null) return;
  try {
    const { id, token } = await backend.createClaim({ payeeName: f.payeeName, amount: f.amount.toString(), memo: meeting.title, meeting: meeting.title });
    const link = `${WEB_URL}/claim#${token}`;
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
  const claims = await backend.claims();
  return Object.fromEntries(claims.filter((c) => c.claimedAccount).map((c) => [c.id, c.claimedAccount!]));
}

export function waitingForClaims(meetings: Meeting[]): boolean {
  return meetings.some((m) => m.followUps.some((f: FollowUp) => f.kind === "payment" && f.claim && !f.claim.account && !f.payeeListed));
}
