/**
 * The shape of a processed meeting as the app shows it. The summary pipeline (M2)
 * fills this from the transcript; every action item and follow-up carries an exact
 * quote from the transcript as evidence.
 */

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
}

export interface EmailFollowUp extends FollowUpBase {
  kind: "email";
  to: string;
  toName: string;
  subject: string;
}

export interface PaymentFollowUp extends FollowUpBase {
  kind: "payment";
  payeeName: string;
  payeeAccount: string;
  /** USDC base units (6 decimals). */
  amount: bigint;
  /** The words the amount was parsed from, shown next to the parsed figure. */
  heard: string;
  payeeListed: boolean;
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
