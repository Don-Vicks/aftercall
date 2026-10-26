/**
 * The shape of a processed meeting as the app shows it. The summary pipeline (M2)
 * fills this from the transcript; every action item and follow-up carries an exact
 * quote from the transcript as evidence.
 */

import type { Attendee } from "./calendar.ts";

export type Speaker = "you" | "others";

export interface TranscriptLine {
  /** Seconds from the start of the recording. */
  at: number;
  speaker: Speaker;
  text: string;
}

export interface Evidence {
  /** Exact words from the transcript. */
  quote: string;
  at: number;
}

export interface ActionItem {
  id: string;
  text: string;
  owner: string;
  due?: string;
  done: boolean;
  /** Set when the item was closed in a later meeting. */
  closedNote?: string;
  /** Set when a connected agent (through the local MCP server) took the item on. */
  claimed?: AgentMark;
  /** Set when a connected agent marked the item done. */
  completed?: AgentMark & { note?: string };
}

/** Who did something to an action item through the MCP server, and when. */
export interface AgentMark {
  /** The agent's name as it gave it, e.g. "Claude Code". */
  agent: string;
  /** ISO 8601 time. */
  at: string;
}

export type FollowUpStatus = "proposed" | "sending" | "sent" | "paid" | "failed" | "blocked" | "dismissed";

interface FollowUpBase {
  id: string;
  status: FollowUpStatus;
  evidence: Evidence;
  /** Time the follow-up completed, as shown in its pill ("14:06"). */
  doneAt?: string;
  /** NEAR transaction (payments) or email id (recaps) once done. */
  ref?: string;
  /** Why it failed, in plain words. */
  error?: string;
  /** Set when autopilot will run it at this time (ms since epoch), unless undone. */
  autopilotAt?: number;
}

export interface EmailFollowUp extends FollowUpBase {
  kind: "email";
  /** Empty until the person adds an address. */
  to: string;
  toName: string;
  subject: string;
}

export interface PaymentFollowUp extends FollowUpBase {
  kind: "payment";
  payeeName: string;
  /** Empty when the payee isn't on the user's list. */
  payeeAccount: string;
  /** USDC base units (6 decimals); null when the words couldn't be read as an amount. */
  amount: bigint | null;
  /** The words the amount was parsed from, shown next to the parsed figure. */
  heard: string;
  payeeListed: boolean;
  /** A claim link for a payee who isn't on the list yet. */
  claim?: { id: string; link: string; account?: string };
  /** Set once the payment went out through NEAR Intents to the payee's address on another chain. */
  crossChain?: CrossChainPayout;
}

/** A payment routed through NEAR Intents 1Click; amounts are USDC base-unit strings. */
export interface CrossChainPayout {
  chain: "solana" | "base";
  address: string;
  depositAddress: string;
  /** 1Click's correlationId for the quote, also recorded on the contract. */
  quoteId: string;
  /** What the quote said the payee gets. */
  amountOut: string;
  /** Latest 1Click status: PENDING_DEPOSIT, KNOWN_DEPOSIT_TX, PROCESSING, SUCCESS, REFUNDED, FAILED… */
  swapStatus: string;
  /** The payout transaction on the destination chain, once 1Click reports it. */
  payoutTxUrl?: string;
}

export type FollowUp = EmailFollowUp | PaymentFollowUp;

export interface Meeting {
  id: string;
  project: string;
  title: string;
  startedAt: string;
  durationSec: number;
  verified: boolean;
  summary: string;
  decisions: string[];
  actionItems: ActionItem[];
  followUps: FollowUp[];
  transcript: TranscriptLine[];
  /** People invited in the calendar event, when the recording matched one. */
  invited?: Attendee[];
}

/** "02:14" for 134 seconds. */
export function formatClock(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** "3 MIN 12 S" for 192 seconds. */
export function formatDuration(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}
