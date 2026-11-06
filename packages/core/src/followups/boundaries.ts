import type { EmailFollowUp, Meeting, PaymentFollowUp } from "../meeting.ts";
import { formatUsdc } from "../money.ts";
import { CHAIN_NAME } from "../intents/oneclick.ts";
import type { PayeeDestination } from "../wallet/actions.ts";

/**
 * The on-chain memo of every payment. It is public forever, so it names the app and
 * nothing about the meeting. The app pays with this constant (`followUpActions.ts`).
 */
export const PAY_MEMO = "Aftercall payment";

/** What a follow-up shares, with whom, and who says yes: a short line and the details behind it. */
export interface WhatLeaves {
  summary: string;
  details: string[];
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What a recap shares before you send it. The counts are read the way `buildRecap` reads
 * them (every decision, the action items not done), so they match the recap that goes.
 * `backend` is whether this build offers Send through Aftercall.
 */
export function emailWhatLeaves(meeting: Pick<Meeting, "decisions" | "actionItems">, f: Pick<EmailFollowUp, "to">, opts: { backend: boolean }): WhatLeaves {
  const open = meeting.actionItems.filter((a) => !a.done).length;
  const to = f.to.trim() ? `to ${f.to.trim()}` : "to the address you add";
  const details = [
    `The recap holds the summary, ${count(meeting.decisions.length, "decision", "decisions")}, ${count(open, "open action item", "open action items")} and a footer on what was checked. It goes ${to}.`,
    "Draft in Mail opens it in your own mail app; Aftercall's servers never see it.",
  ];
  if (opts.backend) details.push("Send through Aftercall passes it through Aftercall's backend, in memory for this one request, then Resend, which keeps sent mail under its own policy.");
  return { summary: "Draft in Mail keeps it on this Mac.", details };
}

/**
 * What a payment puts on NEAR and who can approve it. `route` is the payee's address on
 * another chain when it goes through NEAR Intents 1Click; `claimLinks` is whether this
 * build can send a claim link to a payee who isn't on the list yet.
 */
export function paymentWhatLeaves(
  f: Pick<PaymentFollowUp, "payeeName" | "payeeAccount" | "payeeListed" | "amount">,
  opts: { route?: PayeeDestination | null; claimLinks?: boolean } = {},
): WhatLeaves {
  const route = f.payeeListed ? (opts.route ?? null) : null;
  const who = f.payeeListed && f.payeeAccount ? f.payeeAccount : "the payee's NEAR account";
  const amount = f.amount === null ? "the amount" : `${formatUsdc(f.amount)} USDC`;
  const details = [
    `On NEAR, publicly and for good: ${who}, ${amount}, the memo “${PAY_MEMO}” and an id made of the recording's start time and this follow-up's number${route ? ", with NEAR Intents' deposit address and quote id" : ""}. Nothing from the meeting.`,
    `You approve it, and the contract pays only payees on your list within your caps. ${route ? "Over a cap it's refused, not parked." : "Over a cap it waits for your own NEAR wallet."}`,
  ];
  if (route) details.push(`NEAR Intents 1Click sees the amount, the ${CHAIN_NAME[route.chain]} address and your NEAR account for refunds.`);
  if (!f.payeeListed && opts.claimLinks)
    details.push(`A claim link keeps the amount, your account and a hash of the link's token on Aftercall's backend; ${f.payeeName}'s name and the meeting title stay in the link.`);
  return { summary: "Public on NEAR, nothing from the meeting.", details };
}

/**
 * The notice to paste in the call's chat before recording. It claims only what the app
 * does: the audio goes to NEAR AI Cloud's secure hardware (only to nodes whose attestation
 * checks pass), the Mac app deletes the audio once the notes are saved (the recap footer
 * says the same), and a recap goes out only if you send one.
 */
export function participantNotice(handlingUrl: string): string {
  return `Heads up: I'm recording this call with Aftercall to take notes. It's transcribed and summarized in secure hardware on NEAR AI Cloud, and Aftercall deletes the call's audio once the notes are saved. You may get a recap. What's checked: ${handlingUrl}`;
}
