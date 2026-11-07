import type { ActionItem, AmountProblemKind, Evidence, FollowUp, LikelySpeaker, Meeting, PaymentFollowUp, TranscriptLine } from "../meeting.ts";
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

/** The payee a name means: the same label or the same NEAR account, ignoring case. */
export function matchPayee(payees: Payee[], name: string | null): Payee | undefined {
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

/** Names that say nobody in particular, so they never count as a speaker's name. */
const NOT_A_NAME = /^(you|others?|unknown|someone|speaker( \d+)?|participant( \d+)?|guest|host|everyone)$/i;

/**
 * The model's speaker names as the meeting keeps them: line numbers (from 1) turned
 * into transcript indexes, only "others" lines, names trimmed to at most 60 characters,
 * and a line given two different names left unnamed. Model-inferred, never verified.
 */
export function likelySpeakersFrom(speakers: Notes["speakers"], transcript: TranscriptLine[]): LikelySpeaker[] {
  const byLine = new Map<number, string | null>();
  for (const s of speakers ?? []) {
    const name = s.name.replace(/\s+/g, " ").trim();
    if (!name || name.length > 60 || NOT_A_NAME.test(name)) continue;
    for (const n of s.lines) {
      const line = n - 1;
      if (!Number.isInteger(line) || transcript[line]?.speaker !== "others") continue;
      const seen = byLine.get(line);
      byLine.set(line, seen === undefined || seen === name ? name : null);
    }
  }
  return [...byLine]
    .filter((e): e is [number, string] => e[1] !== null)
    .sort(([a], [b]) => a - b)
    .map(([line, name]) => ({ line, name }));
}

/**
 * Turns the model's notes into a meeting. Anything whose evidence quote isn't in
 * the transcript is dropped and reported, so the model can't invent a payment, and
 * a payment that appears only in your notes never becomes a follow-up. A payment's
 * amount must also be in its quote (see `checkedAmount`), and its condition needs a quote
 * of its own.
 */
export function buildMeeting(input: BuildInput): { meeting: Meeting; dropped: Dropped[] } {
  const { notes, transcript } = input;
  const dropped: Dropped[] = [];

  // Each kept item carries its quote as found in the transcript (original spelling, and
  // the line's time), so the app can show the words behind it and jump to them.
  const decisions: string[] = [];
  const decisionEvidence: Evidence[] = [];
  for (const d of notes.decisions) {
    const quote = findQuote(transcript, d.evidence);
    if (!quote) {
      dropped.push({ kind: "decision", text: d.text, reason: "QUOTE_NOT_IN_TRANSCRIPT" });
      continue;
    }
    decisions.push(d.text);
    decisionEvidence.push({ quote: quote.text, at: quote.at });
  }

  const actionItems: ActionItem[] = notes.action_items.flatMap((a, i) => {
    const quote = findQuote(transcript, a.evidence);
    if (!quote) {
      dropped.push({ kind: "action item", text: a.text, reason: "QUOTE_NOT_IN_TRANSCRIPT" });
      return [];
    }
    const evidence = { quote: quote.text, at: quote.at };
    return [{ id: `a${i + 1}`, text: a.text, owner: a.owner?.trim() || "Unassigned", due: a.due ?? undefined, done: false, evidence }];
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
    // A condition stays only with its own quote from the transcript. One the model gave without
    // one is dropped, but the payment is marked so it can't be paid as if it had none.
    const conditionText = f.condition?.replace(/\s+/g, " ").trim().slice(0, 200) || null;
    const conditionQuote = conditionText && f.condition_evidence ? findQuote(transcript, f.condition_evidence) : null;
    const condition = conditionText && conditionQuote ? { condition: { text: conditionText, evidence: { quote: conditionQuote.text, at: conditionQuote.at } } } : {};
    const conditionDropped = conditionText && !conditionQuote ? { conditionDropped: true } : {};
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
        ...condition,
        ...conditionDropped,
      },
    ];
  });

  const likelySpeakers = likelySpeakersFrom(notes.speakers, transcript);

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
      decisionEvidence,
      actionItems,
      followUps,
      transcript,
      ...(likelySpeakers.length ? { likelySpeakers } : {}),
      ...(input.yourNotes ? { yourNotes: input.yourNotes } : {}),
    },
    dropped,
  };
}
