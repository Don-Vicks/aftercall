import { formatUsdc } from "./money.ts";
import { formatClock, formatDuration, type ActionItem, type FollowUp, type Meeting } from "./meeting.ts";
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

/** Where a follow-up stands, as the page would say it. Dismissed ones aren't on the page, so they aren't here. */
function followUpOf(f: FollowUp): ExportFollowUp {
  const at = (verb: string) => (f.doneAt ? `${verb} at ${f.doneAt}` : verb);
  const auto = f.byAutopilot ? " by autopilot" : "";
  if (f.kind === "email") {
    const title = `Recap to ${f.toName || "someone"}`;
    if (f.status === "sent") return { title, status: `${at("Sent")}${auto}` };
    if (f.status === "sending") return { title, status: "Sending" };
    if (f.status === "failed") return { title, status: "Didn't send" };
    if (f.autopilotAt) return { title, status: "Waiting for autopilot to send it" };
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
