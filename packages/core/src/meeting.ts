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
