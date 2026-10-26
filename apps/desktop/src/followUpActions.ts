import { openUrl } from "@tauri-apps/plugin-opener";
import { buildRecap, encodePublicProof, mailtoLink, type EmailFollowUp, type FollowUp, type Meeting, type PaymentFollowUp } from "@aftercall/core";
import { backend } from "./backend";
import { contractFollowupId, near, signInWallet, waitFor, VERIFY_URL, WEB_URL } from "./near";
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
    const message = e instanceof Error ? e.message : String(e);
    const plain = message.includes("UNKNOWN_PAYEE")
      ? "That payee isn't on your agent wallet's list."
      : message.includes("LOW_BALANCE")
        ? "Not enough USDC in your agent wallet. Deposit some first."
        : message.includes("PAUSED")
          ? "Payments are paused in your agent wallet."
          : message.includes("ALREADY_PAID")
            ? "This follow-up was already paid."
            : message;
    apply({ status: "proposed", error: plain });
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
