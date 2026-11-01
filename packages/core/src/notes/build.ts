import type { ActionItem, FollowUp, Meeting, TranscriptLine } from "../meeting.ts";
import { parseAmount } from "./amounts.ts";
import type { Notes } from "./schema.ts";
import { findQuote } from "./transcript.ts";

export interface Payee {
  name: string;
  account: string;
}

export interface BuildInput {
  id: string;
  project: string;
  startedAt: string;
  durationSec: number;
  notes: Notes;
  transcript: TranscriptLine[];
  payees: Payee[];
  /** Whether the summary's signature and attestation checked out. */
  verified: boolean;
  /** What YOU typed during the call, already cleaned. Shown on the meeting; never evidence. */
  yourNotes?: string;
}

export interface Dropped {
  kind: "decision" | "action item" | "follow-up";
  text: string;
  reason: "QUOTE_NOT_IN_TRANSCRIPT";
}

function matchPayee(payees: Payee[], name: string | null): Payee | undefined {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  return payees.find((p) => p.name.toLowerCase() === n || p.account.toLowerCase() === n);
}

/**
 * Turns the model's notes into a meeting. Anything whose evidence quote isn't in
 * the transcript is dropped and reported, so the model can't invent a payment, and
 * a payment that appears only in your notes never becomes a follow-up.
 */
export function buildMeeting(input: BuildInput): { meeting: Meeting; dropped: Dropped[] } {
  const { notes, transcript } = input;
  const dropped: Dropped[] = [];

  const decisions = notes.decisions.flatMap((d) => {
    if (findQuote(transcript, d.evidence)) return [d.text];
    dropped.push({ kind: "decision", text: d.text, reason: "QUOTE_NOT_IN_TRANSCRIPT" });
    return [];
  });

  const actionItems: ActionItem[] = notes.action_items.flatMap((a, i) => {
    if (!findQuote(transcript, a.evidence)) {
      dropped.push({ kind: "action item", text: a.text, reason: "QUOTE_NOT_IN_TRANSCRIPT" });
      return [];
    }
    return [{ id: `a${i + 1}`, text: a.text, owner: a.owner ?? "Unassigned", due: a.due ?? undefined, done: false }];
  });

  const followUps: FollowUp[] = notes.followups.flatMap((f, i): FollowUp[] => {
    const quote = findQuote(transcript, f.evidence);
    const label = f.type === "email" ? `Recap to ${f.to_name ?? "someone"}` : `Pay ${f.payee_name ?? "someone"} ${f.amount_words}`;
    if (!quote) {
      dropped.push({ kind: "follow-up", text: label, reason: "QUOTE_NOT_IN_TRANSCRIPT" });
      return [];
    }
    const evidence = { quote: quote.text, at: quote.at };
    if (f.type === "email") {
      return [{ id: `f${i + 1}`, kind: "email", status: "proposed", evidence, to: "", toName: f.to_name ?? "", subject: f.subject }];
    }
    const payee = matchPayee(input.payees, f.payee_name);
    return [
      {
        id: `f${i + 1}`,
        kind: "payment",
        status: "proposed",
        evidence,
        payeeName: payee?.name ?? f.payee_name ?? "Unknown payee",
        payeeAccount: payee?.account ?? "",
        payeeListed: !!payee,
        amount: parseAmount(f.amount_words),
        heard: f.amount_words,
      },
    ];
  });

  return {
    meeting: {
      id: input.id,
      project: input.project,
      title: notes.title,
      startedAt: input.startedAt,
      durationSec: input.durationSec,
      verified: input.verified,
      summary: notes.summary,
      decisions,
      actionItems,
      followUps,
      transcript,
      ...(input.yourNotes ? { yourNotes: input.yourNotes } : {}),
    },
    dropped,
  };
}
