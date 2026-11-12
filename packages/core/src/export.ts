import { formatUsdc, USDC_DECIMALS } from "./money.ts";
import { explorerTxUrl, type Network } from "./network.ts";
import { formatClock, formatDuration, type ActionItem, type FollowUp, type Meeting, type PaymentFollowUp } from "./meeting.ts";
import type { Attendee } from "./calendar.ts";
import { isYou, othersOn, speakerLabel } from "./people.ts";
import { clockTime, longDate, meetingTime } from "./when.ts";

/**
 * A meeting as you take it out of Aftercall: as Markdown to paste somewhere, or as a
 * printable page (the Mac app's Save as PDF). Both read `meetingExport`, so they say
 * the same things. It holds what the meeting page shows, minus what belongs to other
 * people or to the proof: no email addresses, NEAR accounts, transaction ids or claim
 * links, and no hashes or attestation details. Your notes and the transcript only come
 * along when you ask for them.
 */

export interface ExportOptions {
  /** The transcript as its own section. Off by default: it is long, and it holds everything anyone said. */
  transcript?: boolean;
  /** What you typed during the call. Off by default: they are your private context. */
  yourNotes?: boolean;
  /**
   * Labels the export as a sample. "made-up": the built-in meeting, written by hand,
   * never recorded or checked. "fictional": a sample call's audio, processed on NEAR AI
   * like a real one, so its checks are real.
   */
  sample?: "made-up" | "fictional";
  /** The proof is also recorded on NEAR. */
  onNear?: boolean;
  /** Your names (NEAR account, name): action items owned by these read "You". */
  me?: readonly string[];
  /** When the export is made; tests pass one. */
  now?: number;
}

/** The mark after an action item you changed after the notes were made, as in the recap. */
export const EXPORT_EDITED_MARK = "(edited by you)";

export interface ExportItem {
  text: string;
  /** Empty when nobody owns it. */
  owner: string;
  due: string;
  done: boolean;
  edited: boolean;
  /** "Done by Claude Code", "Closed in a later meeting…": what the page says under the item. */
  note: string;
}

export interface ExportFollowUp {
  /** "Recap to Ada", "Pay Designer 50.00 USDC". */
  title: string;
  /** Where it stands, in plain words: "Proposed, not sent", "Paid at 14:06". */
  status: string;
}

export interface ExportLine {
  at: string;
  speaker: string;
  text: string;
}

export interface MeetingExport {
  title: string;
  /** One sentence saying what kind of sample this is; absent for your own meetings. */
  sample?: string;
  /** "Sunday 1 Nov 2026, 14:02", or the stored label when the meeting has no time. */
  date: string;
  length: string;
  project: string;
  /** "You and Ada"; empty when the calendar didn't say who was invited. */
  people: string;
  summary: string;
  yourNotes?: string;
  decisions: string[];
  actionItems: ExportItem[];
  followUps: ExportFollowUp[];
  /** Whether the notes were verified and where to see the checks. */
  verification: string[];
  transcript?: ExportLine[];
  /** "Exported from Aftercall on Sunday 1 Nov 2026." */
  footer: string;
}

const SAMPLE_LINE: Record<NonNullable<ExportOptions["sample"]>, string> = {
  "made-up": "Sample. A made-up meeting that shows how Aftercall works. Nothing in it was recorded or checked.",
  fictional: "Sample. A fictional call, made from Aftercall's sample audio and processed like a real one.",
};

/**
 * "You and Ada", "You, Ada and Theo Moss": everyone, unlike the page's short line.
 * People the calendar has no name for are counted ("You, Ada and 1 other"), never
 * shown by their email.
 */
function peopleLine(others: readonly Attendee[]): string {
  const names = others.map((a) => a.name.trim()).filter(Boolean);
  const unnamed = others.length - names.length;
  if (unnamed) names.push(unnamed === 1 ? (names.length ? "1 other" : "1 other person") : `${unnamed} others`);
  if (names.length === 0) return "";
  const all = ["You", ...names];
  return `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`;
}

function itemOf(a: ActionItem, me: readonly string[]): ExportItem {
  const owner = !a.owner || a.owner === "Unassigned" ? "" : isYou(a.owner, me) ? "You" : a.owner;
  const note = a.done && a.completed ? `Done by ${a.completed.agent}` : !a.done && a.claimed ? `${a.claimed.agent} is on it` : (a.closedNote ?? "");
  return { text: a.text, owner, due: a.due ?? "", done: a.done, edited: !!a.edited, note };
}

/** Where a follow-up stands, as the page would say it. Dismissed ones went nowhere, so they aren't here, even one the page keeps because your phone dismissed it. */
function followUpOf(f: FollowUp): ExportFollowUp {
  const at = (verb: string) => (f.doneAt ? `${verb} at ${f.doneAt}` : verb);
  const auto = f.byAutopilot ? " by autopilot" : f.byPhone ? ", approved on your phone" : "";
  if (f.kind === "email") {
    const title = `Recap to ${f.toName || "someone"}`;
    const slack = f.slackPostedAt ? `Posted to Slack at ${f.slackPostedAt}` : "";
    if (f.status === "sent") return { title, status: `${at("Sent")}${auto}${slack ? `. ${slack}` : ""}` };
    if (f.status === "sending") return { title, status: "Sending" };
    if (f.status === "failed") return { title, status: `Didn't send${slack ? `. ${slack}` : ""}` };
    if (f.autopilotAt) return { title, status: "Waiting for autopilot to send it" };
    if (slack) return { title, status: slack };
    if (f.draftedAt) return { title, status: `Opened as a draft in Mail at ${f.draftedAt}. Aftercall can't tell whether it was sent` };
    return { title, status: "Proposed, not sent" };
  }
  const title = `Pay ${f.payeeName} ${f.amount === null ? "(amount unclear)" : `${formatUsdc(f.amount)} USDC`}`;
  if (f.status === "paid") return { title, status: `${at("Paid")}${auto}` };
  if (f.status === "sending") return { title, status: "Paying" };
  if (f.status === "failed") return { title, status: "Didn't go through" };
  if (f.status === "blocked") return { title, status: "Over your caps, waiting for your wallet" };
  if (f.autopilotAt) return { title, status: "Waiting for autopilot to pay it" };
  if (!f.payeeListed) return { title, status: "Proposed, not paid. Not on your payee list yet" };
  return { title, status: "Proposed, not paid" };
}

function verificationOf(meeting: Meeting, opts: ExportOptions): string[] {
  if (opts.sample === "made-up") return ["This sample was written by hand, so there is no proof to check."];
  const lines = meeting.verified
    ? [
        "Verified. Aftercall checked that these notes were made in secure hardware on NEAR AI Cloud and signed there.",
        "To see the checks, open this meeting in Aftercall and choose Verified.",
      ]
    : ["Not verified. Not every secure-hardware check passed for this meeting.", "To see which, open this meeting in Aftercall and choose Not verified."];
  if (opts.onNear) lines.push("The proof is also recorded on NEAR, and that sheet can copy a link anyone can check.");
  const edited = meeting.actionItems.filter((a) => a.edited).length;
  if (edited) {
    lines.push(
      `You changed ${edited === 1 ? "1 action item" : `${edited} action items`} after the notes were made, marked ${EXPORT_EDITED_MARK}. ${edited === 1 ? "That change isn't" : "Those changes aren't"} part of what was checked.`,
    );
  }
  return lines;
}

/** Everything an export says about a meeting, in order, as plain text (not yet Markdown). */
export function meetingExport(meeting: Meeting, opts: ExportOptions = {}): MeetingExport {
  const now = opts.now ?? Date.now();
  const t = meetingTime(meeting, now);
  const others = othersOn(meeting);
  // Without their emails, so a transcript line is never shown under an address: someone with no name reads "Others".
  const speakers = others.map((a) => ({ ...a, email: "" }));
  const yourNotes = opts.yourNotes && meeting.yourNotes?.trim() ? meeting.yourNotes.trim() : undefined;
  return {
    title: meeting.title,
    ...(opts.sample ? { sample: SAMPLE_LINE[opts.sample] } : {}),
    date: t === null ? meeting.startedAt : `${longDate(t)}, ${clockTime(t)}`,
    length: formatDuration(meeting.durationSec),
    project: meeting.project,
    people: peopleLine(others),
    summary: meeting.summary,
    ...(yourNotes ? { yourNotes } : {}),
    decisions: meeting.decisions,
    actionItems: meeting.actionItems.map((a) => itemOf(a, opts.me ?? [])),
    followUps: meeting.followUps.filter((f) => f.status !== "dismissed").map(followUpOf),
    verification: verificationOf(meeting, opts),
    ...(opts.transcript
      ? { transcript: meeting.transcript.map((l) => ({ at: formatClock(l.at), speaker: speakerLabel(l.speaker, speakers), text: l.text })) }
      : {}),
    footer: `Exported from Aftercall on ${longDate(now)}.`,
  };
}

/**
 * Text from the model, the transcript or you, made safe to drop into Markdown: it reads
 * as the same words, never as formatting, link syntax or HTML. A bare web address is
 * left as written, so the app you paste into may still make it a link. Inline marks
 * are escaped everywhere; block marks (#, >, -, 1.) only where they start a line.
 * Leading spaces go, so nothing turns into a code block.
 */
export function escapeMarkdown(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .trimStart()
        .replace(/[\\`*_[\]<>|~]/g, "\\$&")
        .replace(/&(?=#?\w+;)/g, "\\&")
        .replace(/^([#+=-])/, "\\$1")
        .replace(/^(\d+)([.)])/, "$1\\$2"),
    )
    .join("\n");
}

/** One line of text: line breaks become spaces. */
const one = (text: string) => escapeMarkdown(text.replace(/\s*\r?\n\s*/g, " ").trim());

/** Several lines that keep their breaks (two trailing spaces), with blank lines kept as paragraph breaks. */
const lines = (text: string) =>
  escapeMarkdown(text.trim())
    .split("\n")
    .map((l, i, all) => (l && all[i + 1] ? `${l}  ` : l))
    .join("\n");

/** A heading's text: a closing run of # would be read as part of the heading's syntax. */
const heading = (text: string) => one(text).replace(/(\s)(#+)$/, (_, s: string, h: string) => `${s}${h.replace(/#/g, "\\#")}`);

function itemLine(a: ExportItem): string {
  const parts = [one(a.text), a.owner && one(a.owner), a.due && one(a.due)].filter(Boolean);
  const after = [a.edited ? EXPORT_EDITED_MARK : "", a.note ? `(${one(a.note)})` : ""].filter(Boolean);
  return `- [${a.done ? "x" : " "}] ${parts.join(" · ")}${after.length ? ` ${after.join(" ")}` : ""}`;
}

/** The export as Markdown (CommonMark, with GitHub's task-list boxes for action items). */
export function exportMarkdown(x: MeetingExport): string {
  const out: string[] = [`# ${heading(x.title)}`, ""];
  if (x.sample) out.push(`**${escapeMarkdown(x.sample)}**`, "");
  out.push(`- Date: ${one(x.date)}`, `- Length: ${x.length}`, `- Project: ${one(x.project)}`);
  if (x.people) out.push(`- People: ${one(x.people)}`);
  out.push("");
  if (x.summary.trim()) out.push("## Summary", "", lines(x.summary), "");
  if (x.yourNotes) out.push("## Your notes", "", "_Typed during the call._", "", lines(x.yourNotes), "");
  if (x.decisions.length) out.push("## Decisions", "", ...x.decisions.map((d, i) => `${i + 1}. ${one(d)}`), "");
  if (x.actionItems.length) out.push("## Action items", "", ...x.actionItems.map(itemLine), "");
  if (x.followUps.length) out.push("## Follow-ups", "", ...x.followUps.map((f) => `- ${one(f.title)}: ${one(f.status)}`), "");
  out.push("## Verification", "", ...x.verification.flatMap((l) => [escapeMarkdown(l), ""]));
  if (x.transcript) {
    out.push("## Transcript", "");
    if (x.transcript.length === 0) out.push("This meeting has no transcript.", "");
    for (const l of x.transcript) out.push(`**${l.at} ${one(l.speaker)}:** ${one(l.text)}`, "");
  }
  out.push("---", "", `_${escapeMarkdown(x.footer)}_`, "");
  return out.join("\n");
}

/** A meeting as Markdown, in one call. */
export function meetingMarkdown(meeting: Meeting, opts: ExportOptions = {}): string {
  return exportMarkdown(meetingExport(meeting, opts));
}

// ---------- The money trail, as CSV a bookkeeper can read ----------
//
// Unlike the meeting export above, this one is about money: it names payees' NEAR accounts
// and links every transaction, because a bookkeeper needs both. One row per payment (or
// deposit, or withdrawal), where it stands now, with the transaction that put it there.
// Statuses and amounts come from the contract or the transaction (the Mac app sets a
// follow-up's state from the contract's reply), never from the model's text.

/** Where a payment stands, in a bookkeeper's words. */
export type LedgerStatus =
  /** Paid from the agent wallet within your caps. */
  | "paid"
  /** Over a cap: parked in the contract for your own wallet. Nothing has moved. */
  | "held for approval"
  /** Held over a cap, then approved in your wallet, which paid it. */
  | "approved and paid"
  /** Held over a cap, then declined in your wallet. Nothing was paid. */
  | "declined"
  /** Set aside in the contract for a deal (Handshake); not paid yet. */
  | "in escrow"
  /** Paid to the payee out of escrow. */
  | "released"
  /** An escrow's money went back on your agent wallet's balance. */
  | "returned"
  /** The transfer didn't land, and the amount came back. */
  | "failed and refunded"
  /** Left the agent wallet for NEAR Intents, which hasn't (yet) paid the payee on Solana or Base. Mainnet only. */
  | "sent to NEAR Intents"
  /** USDC from your NEAR account into your agent wallet. */
  | "deposited"
  /** USDC from your agent wallet back to your NEAR account. */
  | "withdrawn";

/**
 * Who let the money move. "you or autopilot": Aftercall's limited key signed it, and the
 * chain doesn't record whether you tapped it or autopilot ran it. Empty while nobody has
 * (a payment held for your wallet).
 */
export type LedgerApprover =
  | "you"
  | "you, on your phone"
  | "autopilot"
  | "you or autopilot"
  | "your wallet"
  | "the payee confirmed"
  | "the payee confirmed, then you released it"
  | "the payee"
  | "";

export interface LedgerRow {
  /** When it reached this status (or the meeting's start, for rows from the Mac app), as an ISO 8601 UTC time; empty when unknown. */
  date: string;
  /** The meeting's title, or its id when only the chain was read; empty when no meeting is linked. */
  meeting: string;
  /** The payee's label ("Illustrator"); the CSV shows the account when it's empty. */
  payee: string;
  payeeAccount: string;
  /** USDC base units (6 decimals); null when the amount isn't known. */
  amount: bigint | null;
  status: LedgerStatus;
  approvedBy: LedgerApprover;
  network: Network;
  /** The NEAR transaction that put it in this status; empty when there is none. */
  tx: string;
  /** The transaction that recorded the meeting's proof hash on NEAR; empty when there is none. */
  proofTx: string;
  /** What happened to the money, in a sentence or two. */
  note: string;
}

export interface LedgerCsvOptions {
  /**
   * What the date column holds: "transaction" (when the row reached its status, read from
   * NEAR; the default) or "meeting" (the meeting's start, for rows built from what the Mac
   * app keeps). The header says which.
   */
  dates?: "transaction" | "meeting";
}

/** The header row, in order. */
export const LEDGER_COLUMNS = ["Date (UTC)", "Meeting", "Payee", "Payee account", "Amount", "Currency", "Status", "Approved by", "Transaction", "Meeting proof", "Note"] as const;

/** "5000.00" for 5,000 USDC: two decimals and no thousands separator; more decimals only when the amount has them, so it's never rounded. */
export function ledgerAmount(baseUnits: bigint): string {
  const scale = 10n ** BigInt(USDC_DECIMALS);
  const sign = baseUnits < 0n ? "-" : "";
  const abs = baseUnits < 0n ? -baseUnits : baseUnits;
  const frac = (abs % scale).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${sign}${abs / scale}.${frac}`;
}

/** "2026-11-12T09:48:22Z": UTC, to the second. Empty for a time that isn't one. */
export function ledgerTime(ms: number): string {
  return Number.isFinite(ms) ? new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z") : "";
}

/**
 * One field, RFC 4180: always quoted, inner quotes doubled. Line breaks and runs of
 * spaces become one space, so each row stays on one line. A field a spreadsheet would
 * run as a formula (starting =, +, - or @) gets a leading apostrophe, so text from a call
 * can't become one.
 */
function csvField(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  const safe = /^[=+\-@]/.test(flat) ? `'${flat}` : flat;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * The rows as CSV (RFC 4180): a header row, every field quoted, CRLF line ends, UTF-8.
 * Amounts in USDC with two decimals; transactions and proofs as links to the NEAR
 * explorer for each row's network.
 */
export function ledgerCsv(rows: readonly LedgerRow[], opts: LedgerCsvOptions = {}): string {
  const header = LEDGER_COLUMNS.map((c) => (c === "Date (UTC)" && opts.dates === "meeting" ? "Meeting date (UTC)" : c));
  const fields = (r: LedgerRow) => [
    r.date,
    r.meeting,
    r.payee || r.payeeAccount,
    r.payeeAccount,
    r.amount === null ? "" : ledgerAmount(r.amount),
    "USDC",
    r.status,
    r.approvedBy,
    r.tx ? explorerTxUrl(r.network, r.tx) : "",
    r.proofTx ? explorerTxUrl(r.network, r.proofTx) : "",
    r.note,
  ];
  return [header, ...rows.map(fields)].map((line) => `${line.map(csvField).join(",")}\r\n`).join("");
}

export interface MeetingLedgerOptions {
  /** The network the app pays on, for payments that don't record where they were made. */
  network: Network;
  /** Each meeting's `record_proof` transaction, by meeting id, when its proof is on NEAR. */
  proofTx?: Readonly<Record<string, string>>;
}

/** A meeting's start as a ledger time, or empty for a meeting without a real time (a sample's label). */
function meetingStart(m: Meeting): string {
  const t = Date.parse(m.startedAt);
  return Number.isNaN(t) ? "" : ledgerTime(t);
}

/** Who approved a payment the app paid itself, as the follow-up records it. */
function appApprover(f: PaymentFollowUp): LedgerApprover {
  return f.byAutopilot ? "autopilot" : f.byPhone ? "you, on your phone" : "you";
}

const HELD = "Over your caps, so the contract held it";

/** One payment follow-up as a ledger row, or null when no money has moved or been held for it. */
function meetingLedgerRow(m: Meeting, f: PaymentFollowUp, opts: MeetingLedgerOptions): LedgerRow | null {
  const base = {
    date: meetingStart(m),
    meeting: m.title || m.id,
    payee: f.payeeName,
    payeeAccount: f.payeeAccount,
    amount: f.amount,
    network: f.escrow?.on.network ?? f.heldOn?.network ?? opts.network,
    tx: f.ref ?? "",
    proofTx: opts.proofTx?.[m.id] ?? "",
  };
  const e = f.escrow;
  if (e) {
    const opened = { ...base, tx: e.ref ?? "" };
    switch (e.state) {
      case "parked":
        return { ...opened, status: "held for approval", approvedBy: "", note: `${HELD}: the deal waits for your wallet before its money is set aside. Nothing has moved.` };
      case "open":
        return { ...opened, status: "in escrow", approvedBy: "you", note: "Set aside in the contract; waits for the payee to confirm the terms from their own NEAR account. Not paid yet." };
      case "confirmed":
        return { ...opened, status: "in escrow", approvedBy: "you", note: "Set aside in the contract. The payee confirmed the terms; it's paid when you release it. Not paid yet." };
      case "released":
        return e.releasedRef
          ? { ...base, tx: e.releasedRef, status: "released", approvedBy: "the payee confirmed, then you released it", note: "Paid to the payee out of escrow, after they confirmed the terms from their own NEAR account." }
          : {
              ...opened,
              status: "released",
              approvedBy: "the payee confirmed",
              note: "Paid to the payee out of escrow when they confirmed the terms from their own NEAR account. This transaction opened the escrow; their confirmation paid it.",
            };
      case "cancelled":
        return { ...opened, status: "returned", approvedBy: "your wallet", note: "You took the deal back in your wallet; the amount is back in your agent wallet. Nothing was paid." };
      case "returned":
        return { ...opened, status: "returned", approvedBy: "the payee", note: "The payee gave the deal back; the amount is back in your agent wallet. Nothing was paid." };
    }
  }
  // Set once the contract sent the USDC to NEAR Intents' deposit address for a payee on Solana or Base.
  const x = f.crossChain;
  if (x && f.ref) {
    const to = `the payee's ${x.chain === "solana" ? "Solana" : "Base"} address ${x.address}`;
    if (f.status === "paid") return { ...base, status: "paid", approvedBy: appApprover(f), note: `Paid from your agent wallet within your caps, through NEAR Intents to ${to}.` };
    if (f.status === "failed" && x.swapStatus === "REFUNDED") return { ...base, status: "failed and refunded", approvedBy: appApprover(f), note: f.error ?? `NEAR Intents couldn't pay ${to} and refunded your NEAR account.` };
    return {
      ...base,
      status: "sent to NEAR Intents",
      approvedBy: appApprover(f),
      note: `Left your agent wallet for NEAR Intents' deposit address ${x.depositAddress}, to pay ${to}. NEAR Intents last said ${x.swapStatus}.`,
    };
  }
  if (f.status === "paid" && f.heldOn) {
    return { ...base, status: "approved and paid", approvedBy: "your wallet", note: `${HELD} (this transaction); you approved it in your wallet, which paid it.` };
  }
  if (f.status === "paid") return { ...base, status: "paid", approvedBy: appApprover(f), note: "Paid from your agent wallet within your caps." };
  if (f.status === "blocked") return { ...base, status: "held for approval", approvedBy: "", note: `${HELD}: it waits for your wallet. Nothing has been paid.` };
  if (f.status === "dismissed" && f.heldOn) {
    return { ...base, status: "declined", approvedBy: "your wallet", note: `${HELD} (this transaction); you declined it in your wallet. Nothing was paid.` };
  }
  // Only money that left and came back is a refund: a payment the contract refused never moved, so it has no row.
  if (f.status === "failed" && f.ref) {
    return { ...base, status: "failed and refunded", approvedBy: appApprover(f), note: f.error ?? "The transfer didn't land, and the amount went back to your agent wallet." };
  }
  return null;
}

/**
 * The ledger rows for the payments in these meetings, from what the Mac app keeps with
 * each follow-up: paid, held, declined, refunded or in escrow. A payment still proposed,
 * or dismissed without being held, moved nothing and has no row. Oldest meeting first;
 * the date is the meeting's start (pass `dates: "meeting"` to `ledgerCsv`).
 */
export function ledgerRowsFromMeetings(meetings: readonly Meeting[], opts: MeetingLedgerOptions): LedgerRow[] {
  return [...meetings]
    .sort((a, b) => (Date.parse(a.startedAt) || 0) - (Date.parse(b.startedAt) || 0))
    .flatMap((m) => m.followUps.flatMap((f) => (f.kind === "payment" ? (meetingLedgerRow(m, f, opts) ?? []) : [])));
}
