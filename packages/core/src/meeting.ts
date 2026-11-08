/**
 * The shape of a processed meeting as the app shows it. The summary pipeline (M2)
 * fills this from the transcript; every action item and follow-up carries an exact
 * quote from the transcript as evidence.
 */

import type { Attendee } from "./calendar.ts";
import type { Network } from "./network.ts";

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
  /**
   * The exact words behind the item, as found in the transcript, and when they were said.
   * Absent on meetings made before quotes were kept: show no quote then.
   */
  evidence?: Evidence;
  /** Set when the item was closed in a later meeting. */
  closedNote?: string;
  /** Set when a connected agent (through the local MCP server) took the item on. */
  claimed?: AgentMark;
  /** Set when a connected agent marked the item done. */
  completed?: AgentCompletion;
  /**
   * Set when you changed the item after the notes were signed: when, and which fields
   * differ from the model's signed item (notes.action_items). Absent once it matches again.
   */
  edited?: ItemEdit;
}

export type EditedField = "text" | "owner" | "due";

export interface ItemEdit {
  /** ISO 8601 time of the last edit. */
  at: string;
  fields: EditedField[];
}

/**
 * An agent's completion: who, when, and what it says it did. `link` is the work it points
 * to (a pull request, commit or document; `workLink` rules). Both are the agent's
 * statement: Aftercall shows them as such and never checks what's behind the link.
 */
export interface AgentCompletion extends AgentMark {
  note?: string;
  link?: string;
}

/** A follow-up a coding agent proposed: who, when, and why in its own words. */
export interface AgentProposal extends AgentMark {
  reason: string;
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
  /**
   * The exact words from the transcript behind it. Absent only on a follow-up a coding
   * agent proposed (`proposedBy`): those come from the agent, not the call.
   */
  evidence?: Evidence;
  /**
   * Set when a coding agent proposed it through the MCP server, rather than the meeting.
   * Its reason shows in place of a quote, as the agent's words. It never runs on
   * autopilot, and a payment goes only to a listed payee within your caps, after your tap.
   */
  proposedBy?: AgentProposal;
  /** Time the follow-up completed, as shown in its pill ("14:06"). */
  doneAt?: string;
  /** NEAR transaction (payments) or email id (recaps) once done. */
  ref?: string;
  /** Why it failed, in plain words. */
  error?: string;
  /** Set when autopilot will run it at this time (ms since epoch), unless undone. */
  autopilotAt?: number;
  /**
   * Set when autopilot had queued it but Aftercall closed before its undo window ran
   * out. It never runs by itself after that: it waits for you to approve or dismiss it.
   */
  autopilotHeld?: boolean;
  /** Set when autopilot sent or paid it, rather than a person approving it. */
  byAutopilot?: boolean;
  /**
   * Set when you approved it on your paired phone and the Mac sent or paid it, or you
   * dismissed it there (docs/design/phone-protocol.md). `phoneDecision` labels it.
   */
  byPhone?: boolean;
}

export interface EmailFollowUp extends FollowUpBase {
  kind: "email";
  /** Empty until the person adds an address. */
  to: string;
  toName: string;
  subject: string;
  /** When the recap was last opened as a draft in your own mail app ("14:06"). Aftercall can't tell whether you sent it. */
  draftedAt?: string;
  /** When the recap was last posted to Slack through the webhook in Settings ("14:06"). Only your tap posts it. */
  slackPostedAt?: string;
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
  /**
   * Why `amount` is null, when the app knows: "not-in-quote" (the words parsed, but
   * that figure isn't in the evidence quote from the transcript), "not-usdc" (said in
   * another currency; `amountProblem(heard)` names it) or "unclear" (the words don't
   * read as one amount). Absent on meetings made before it existed; read null as unclear.
   */
  amountProblem?: AmountProblemKind;
  /**
   * Where the contract parked it, set when it's held for your wallet: the network,
   * contract and NEAR account the app paid from then. Only that contract knows what
   * became of it. Absent on payments held before it was kept.
   */
  heldOn?: NearPlace;
  /**
   * What the call said must happen before paying ("when the icons are delivered"), with the
   * exact words behind it. Only from the transcript: no quote, no condition. Absent on
   * meetings made before conditions were read, and on payments without one.
   */
  condition?: { text: string; evidence: Evidence };
  /**
   * The model gave a condition whose words aren't in the transcript, so it was dropped. The
   * payment still never runs on autopilot or from the phone: it waits for you on the Mac.
   */
  conditionDropped?: boolean;
  /** Set once the payment is held in escrow for the payee to confirm (Handshake, docs/handshake.md). */
  escrow?: EscrowFollowUp;
}

/** An escrow's state on the agent-wallet contract (`EscrowState` in contracts/agent-wallet). */
export type EscrowState = "parked" | "open" | "confirmed" | "released" | "cancelled" | "returned";

/** A payment held in escrow, as the app keeps it with the follow-up. The contract is the source of truth. */
export interface EscrowFollowUp {
  /** Its id on the contract: the follow-up's contract id (`contractFollowupId`). */
  id: string;
  /** As last read from the contract. */
  state: EscrowState;
  /** The payee's confirm page, with the terms in its #fragment (`dealLink`). */
  link: string;
  /** sha256 of the terms, as the contract holds it (`dealTermsHash`). */
  termsHash: string;
  /** The network, contract and owner account it was opened on. */
  on: NearPlace;
  /** The transaction that opened it. */
  ref?: string;
  /** The transaction that released it, when the app did. */
  releasedRef?: string;
  /** When the confirm link was emailed through Aftercall ("14:06"), if it was. */
  emailedAt?: string;
}

/** A NEAR network, agent-wallet contract and owner account, as the app's NEAR settings name them. */
export interface NearPlace {
  network: Network;
  contract: string;
  account: string;
}

export type AmountProblemKind = "not-in-quote" | "not-usdc" | "unclear";

/**
 * That you told everyone on the call before recording, as you ticked it. Aftercall
 * records your statement; it can't check it.
 */
export interface NoticeLog {
  by: "you";
  /** ISO 8601 time the box was ticked. */
  at: string;
  how?: "aloud" | "chat" | "invite" | "email";
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

/** A name the summary model put to one "others" line of the transcript. Not verified. */
export interface LikelySpeaker {
  /** Index of the line in `Meeting.transcript` (0-based). */
  line: number;
  name: string;
}

/** The model's likely name for each "others" line that has one, by line index. */
export function likelySpeakerAt(m: Pick<Meeting, "transcript" | "likelySpeakers">): Map<number, string> {
  const names = new Map<number, string>();
  for (const s of m.likelySpeakers ?? []) {
    if (Number.isInteger(s.line) && m.transcript[s.line]?.speaker === "others" && s.name) names.set(s.line, s.name);
  }
  return names;
}

export interface Meeting {
  id: string;
  project: string;
  title: string;
  startedAt: string;
  durationSec: number;
  verified: boolean;
  summary: string;
  decisions: string[];
  /**
   * The exact words behind each decision, in the same order as `decisions`. Absent on
   * meetings made before quotes were kept; read it through `decisionEvidence`.
   */
  decisionEvidence?: Evidence[];
  actionItems: ActionItem[];
  followUps: FollowUp[];
  transcript: TranscriptLine[];
  /**
   * What YOU typed during the call (cleaned as `cleanYourNotes` does), shown above the
   * AI notes. The model saw them as context only; the proof holds a salted hash of
   * them. Never in a recap and never sent to connected agents.
   */
  yourNotes?: string;
  /**
   * Who probably spoke some of the "others" lines, as the summary model read it from
   * what was said (someone introduces themselves, is addressed by name, or answers a
   * question put to them by name). Model-inferred, never checked like quotes: show it
   * as a hint ("likely"), never as fact. Only lines the model was sure about; absent on
   * meetings made before it existed and when the model named nobody.
   */
  likelySpeakers?: LikelySpeaker[];
  /** Everyone the calendar event invited except you, with or without an email. */
  attendees?: Attendee[];
  /** The invited people who have an email address: where a recap can go. */
  invited?: Attendee[];
}

/**
 * How the Mac labels a follow-up you decided on your paired phone: "Approved on your
 * phone" once it was sent or paid, "Dismissed on your phone" once dismissed there. Null
 * when the phone didn't decide it, or what it approved hasn't gone out.
 */
export function phoneDecision(f: Pick<FollowUp, "status" | "byPhone">): "Approved on your phone" | "Dismissed on your phone" | null {
  if (!f.byPhone) return null;
  if (f.status === "dismissed") return "Dismissed on your phone";
  return f.status === "sent" || f.status === "paid" ? "Approved on your phone" : null;
}

/**
 * The quote behind the meeting's i-th decision, or undefined when the meeting was made
 * before quotes were kept (or the lists don't line up, so no quote is better than a wrong one).
 */
export function decisionEvidence(m: Pick<Meeting, "decisions" | "decisionEvidence">, i: number): Evidence | undefined {
  const all = m.decisionEvidence;
  if (!all || all.length !== m.decisions.length) return undefined;
  return all[i];
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
