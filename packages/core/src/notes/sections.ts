import type { TranscriptLine } from "../meeting.ts";
import { formatClock } from "../meeting.ts";
import type { Notes, Overall } from "./schema.ts";
import { estimateTokens, normalize, transcriptForPrompt } from "./transcript.ts";

/**
 * Long calls are written up in parts: one encrypted notes request per part, sent at
 * the same time, then one short request that writes the overall title and summary
 * from the parts' summaries. A call at or under both limits below stays one request,
 * exactly as before.
 */

/** Calls longer than this (from the first line to the last) are split. */
export const SPLIT_ABOVE_SECONDS = 45 * 60;
/** Transcripts estimated above this many tokens are split, however long the call. */
export const SPLIT_ABOVE_TOKENS = 12_000;
/** Each part covers at most about this long... */
export const SECTION_SECONDS = 25 * 60;
/** ...and about this many tokens of transcript. */
export const SECTION_TOKENS = 6_500;
/** The last lines of the previous part, repeated before each part as context. */
export const OVERLAP_LINES = 3;

/** One part of a long call: `lines` are its own; `context` ends the part before. */
export interface Section {
  /** Index of the first own line in the whole transcript. */
  start: number;
  lines: TranscriptLine[];
  context: TranscriptLine[];
}

const span = (lines: TranscriptLine[]) => (lines.length ? lines[lines.length - 1].at - lines[0].at : 0);
const tokensOf = (l: TranscriptLine) => estimateTokens(transcriptForPrompt([l])) + 2;

/** Whether this transcript is written up in parts. */
export function needsSplit(lines: TranscriptLine[]): boolean {
  const tokens = lines.reduce((s, l) => s + tokensOf(l), 0);
  return lines.length > 1 && (span(lines) > SPLIT_ABOVE_SECONDS || tokens > SPLIT_ABOVE_TOKENS);
}

/**
 * Splits the transcript into parts on line boundaries (a line is one speaker's turn),
 * as even as the limits allow: n parts, where n is the most either limit needs, each
 * closing once it holds its share of the time or the tokens. One part when no split is needed.
 */
export function planSections(lines: TranscriptLine[]): Section[] {
  if (!needsSplit(lines)) return [{ start: 0, lines, context: [] }];
  const tokens = lines.map(tokensOf);
  const total = tokens.reduce((s, n) => s + n, 0);
  const n = Math.min(lines.length, Math.max(2, Math.ceil(span(lines) / SECTION_SECONDS), Math.ceil(total / SECTION_TOKENS)));
  const shareSeconds = span(lines) / n;
  const shareTokens = total / n;
  const sections: Section[] = [];
  let start = 0;
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    acc += tokens[i];
    const left = lines.length - i - 1;
    const partsLeft = n - sections.length - 1;
    const full = acc >= shareTokens || lines[i].at - lines[start].at >= shareSeconds;
    // Close here when this part has its share, or when every later part needs a line of its own.
    if (partsLeft > 0 && left >= partsLeft && (full || left === partsLeft)) {
      sections.push({ start, lines: lines.slice(start, i + 1), context: lines.slice(Math.max(0, start - OVERLAP_LINES), start) });
      start = i + 1;
      acc = 0;
    }
  }
  sections.push({ start, lines: lines.slice(start), context: lines.slice(Math.max(0, start - OVERLAP_LINES), start) });
  return sections;
}

/** "Part 2 of 5, 25:10 to 52:40": what each part request says about where it sits. */
export function sectionHeading(s: Section, i: number, n: number): string {
  return `Part ${i + 1} of ${n} of the call, ${formatClock(s.lines[0].at)} to ${formatClock(s.lines[s.lines.length - 1].at)}.`;
}

/** What the overall call reads: each part's title and summary, in order. Small on purpose. */
export function overallRequestText(project: string, sections: Section[], notes: Notes[]): string {
  const parts = notes.map((n, i) => `${sectionHeading(sections[i], i, notes.length)}\nTitle: ${n.title}\nSummary: ${n.summary}`);
  return `Project: ${project}\n\n${parts.join("\n\n")}`;
}

// ---------- merging the parts ----------

/** The words of a text, as quotes are compared (`normalize`). */
const words = (s: string) => new Set(normalize(s).split(" ").filter(Boolean));

/**
 * Near-identical text: the same words after `normalize`, or, for texts of at least
 * four words, at least 80% of the words shared (Jaccard). Numbers must match exactly,
 * so "Pay Ada 50" is never the same as "Pay Ada 500".
 */
export function nearSame(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  const digits = (s: string) => (s.match(/\p{N}+/gu) ?? []).join(" ");
  if (digits(na) !== digits(nb)) return false;
  const wa = words(a);
  const wb = words(b);
  if (wa.size < 4 || wb.size < 4) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared) >= 0.8;
}

const sameQuote = (a: string, b: string) => {
  const na = normalize(a);
  const nb = normalize(b);
  return na !== "" && na === nb;
};
/** One quote inside the other, as happens when two parts quote the same moment. */
const overlappingQuote = (a: string, b: string) => {
  const na = normalize(a);
  const nb = normalize(b);
  return na !== "" && nb !== "" && (na.includes(nb) || nb.includes(na));
};

type Decision = Notes["decisions"][number];
type Action = Notes["action_items"][number];
type FollowUpNote = Notes["followups"][number];

const sameDecision = (a: Decision, b: Decision) => sameQuote(a.evidence, b.evidence) || nearSame(a.text, b.text);
const sameAction = (a: Action, b: Action) =>
  sameQuote(a.evidence, b.evidence) || (nearSame(a.text, b.text) && normalize(a.owner ?? "") === normalize(b.owner ?? ""));
/** Follow-ups merge only when nothing that matters differs: a payment's payee and amount words must be the same. */
function sameFollowUp(a: FollowUpNote, b: FollowUpNote): boolean {
  if (a.type === "email" && b.type === "email") {
    return normalize(a.to_name ?? "") === normalize(b.to_name ?? "") && (sameQuote(a.evidence, b.evidence) || nearSame(a.subject, b.subject));
  }
  if (a.type === "payment" && b.type === "payment") {
    return (
      normalize(a.payee_name ?? "") === normalize(b.payee_name ?? "") &&
      normalize(a.amount_words) === normalize(b.amount_words) &&
      overlappingQuote(a.evidence, b.evidence)
    );
  }
  return false;
}

/** The list in order with later duplicates left out: the first part to mention an item keeps it. */
function dedupe<T>(items: T[], same: (a: T, b: T) => boolean): T[] {
  const kept: T[] = [];
  for (const item of items) if (!kept.some((k) => same(k, item))) kept.push(item);
  return kept;
}

/**
 * Each part's speaker lines, numbered within the part, mapped to line numbers in the
 * whole transcript (from 1, as a one-request call numbers them). Lines outside the part,
 * "You" lines and names that don't look like one are dropped; a line two parts name
 * differently is left unnamed. The meeting checks them again (`buildMeeting`).
 */
export function mergeSpeakers(sections: Section[], notes: Notes[]): NonNullable<Notes["speakers"]> {
  const byLine = new Map<number, string | null>();
  notes.forEach((n, i) => {
    const s = sections[i];
    for (const sp of n.speakers ?? []) {
      for (const local of sp.lines) {
        if (!Number.isInteger(local) || local < 1 || local > s.lines.length || s.lines[local - 1].speaker !== "others") continue;
        const global = s.start + local;
        const seen = byLine.get(global);
        byLine.set(global, seen === undefined || seen === sp.name ? sp.name : null);
      }
    }
  });
  const byName = new Map<string, number[]>();
  for (const [line, name] of [...byLine].sort(([a], [b]) => a - b)) {
    if (name === null) continue;
    byName.set(name, [...(byName.get(name) ?? []), line]);
  }
  return [...byName].map(([name, lines]) => ({ name, lines }));
}

/**
 * The notes of a long call: decisions, action items and follow-ups from every part, in
 * order, with duplicates left out (the same quote, or near-identical text; see
 * `nearSame`); speakers mapped back to the whole transcript; the title and summary from
 * the overall call. Every item still needs its quote in the full transcript (`buildMeeting`).
 */
export function mergeSectionNotes(sections: Section[], notes: Notes[], overall: Overall): Notes {
  return {
    title: overall.title,
    summary: overall.summary,
    decisions: dedupe(
      notes.flatMap((n) => n.decisions),
      sameDecision,
    ),
    action_items: dedupe(
      notes.flatMap((n) => n.action_items),
      sameAction,
    ),
    followups: dedupe(
      notes.flatMap((n) => n.followups),
      sameFollowUp,
    ),
    speakers: mergeSpeakers(sections, notes),
  };
}
