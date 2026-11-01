import type { ActionItem, AmountProblemKind, FollowUp, Meeting, PaymentFollowUp, TranscriptLine } from "../meeting.ts";
import { amountProblem, amountsIn, currencyIn, parseAmount } from "./amounts.ts";
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
 * A payment's amount, kept only when the same value is in its evidence quote as found
 * in the transcript. Values, not words: Whisper writes "$40" where the model writes
 * "forty dollars". A value the quote gives in another currency or as a percentage
 * doesn't count (see `amountsIn`). Otherwise null, with the reason.
 */
export function checkedAmount(heard: string, quote: string): { amount: bigint | null; amountProblem?: AmountProblemKind } {
  const problem = amountProblem(heard);
  if (problem) return { amount: null, amountProblem: problem.kind };
  const amount = parseAmount(heard);
  if (amount === null) return { amount: null, amountProblem: "unclear" };
  if (amountsIn(quote).includes(amount)) return { amount };
  // The model wrote dollars for what the quote says in naira, euros...: say so.
  return { amount: null, amountProblem: currencyIn(quote) ? "not-usdc" : "not-in-quote" };
}

/** One sentence for the payment card on why the amount is empty; null when there is an amount. */
export function amountNote(f: Pick<PaymentFollowUp, "amount" | "amountProblem" | "heard"> & { evidence?: { quote: string } }): string | null {
  if (f.amount !== null) return null;
  if (f.amountProblem === "not-in-quote") return `The model heard “${f.heard}”, but that amount isn't in the quote from the transcript, so it wasn't filled in.`;
  const problem = amountProblem(f.heard);
  // The model wrote dollars, but the quote names another currency.
  const quoted = f.amountProblem === "not-usdc" && problem?.kind !== "not-usdc" && f.evidence ? currencyIn(f.evidence.quote) : null;
  if (quoted) return `The quote gives this amount in ${quoted}, not US dollars. Aftercall doesn't convert currencies, so the amount wasn't filled in.`;
  if (f.amountProblem === "not-usdc" || problem?.kind === "not-usdc") {
    const currency = problem?.kind === "not-usdc" ? problem.currency : "another currency";
    return `“${f.heard}” is in ${currency}, not US dollars. Aftercall doesn't convert currencies, so the amount wasn't filled in.`;
  }
  return `“${f.heard}” doesn't read as one amount, so it wasn't filled in.`;
}

/**
 * Turns the model's notes into a meeting. Anything whose evidence quote isn't in
 * the transcript is dropped and reported, so the model can't invent a payment, and
 * a payment that appears only in your notes never becomes a follow-up. A payment's
 * amount must also be in its quote (see `checkedAmount`).
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
    return [{ id: `a${i + 1}`, text: a.text, owner: a.owner?.trim() || "Unassigned", due: a.due ?? undefined, done: false }];
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
        ...checkedAmount(f.amount_words, quote.text),
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
