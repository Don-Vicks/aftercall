import { mergeTranscript, type FollowUp, type Meeting, type TranscribedChunk, type TranscriptLine } from "@aftercall/core";

/**
 * The facts the processing page shows about a run, worked out on this Mac from what it
 * already has: the transcript once Whisper is done, and the notes once they're saved.
 * Counts only; no words leave the page or get stored.
 */

/** A follow-up that waits for you: one to approve, one going out, or a payment over a cap. Matches Today's "Needs you". */
export const needsYou = (f: FollowUp) => f.status === "proposed" || f.status === "sending" || (f.status === "blocked" && f.kind === "payment");

export interface NotesDigest {
  decisions: number;
  actionItems: number;
  needYou: number;
}

/** "2 decisions · 3 action items · 2 need you", as numbers, from the notes as saved. */
export function notesDigest(m: Pick<Meeting, "decisions" | "actionItems" | "followUps">): NotesDigest {
  return { decisions: m.decisions.length, actionItems: m.actionItems.length, needYou: m.followUps.filter(needsYou).length };
}

export interface TranscriptStats {
  words: number;
  /** Turns as the transcript shows them: one speaker's consecutive lines joined. */
  turns: number;
  /** Share of the words from your microphone, 0 to 1; the rest is the call's audio. */
  you: number;
}

/** Intl.Segmenter, typed here because the app's TS lib (ES2020) predates it; WebKit has it. */
type WordSegmenter = { segment(text: string): Iterable<{ isWordLike?: boolean }> };
const Segmenter = (Intl as unknown as { Segmenter?: new (locale: undefined, o: { granularity: "word" }) => WordSegmenter }).Segmenter;
const segmenter = Segmenter ? new Segmenter(undefined, { granularity: "word" }) : null;

/** Words in any script (Intl.Segmenter splits Chinese or Thai too); spaces where it isn't there. */
export function countWords(text: string): number {
  if (!segmenter) return text.split(/\s+/).filter(Boolean).length;
  let n = 0;
  for (const s of segmenter.segment(text)) if (s.isWordLike) n++;
  return n;
}

/** Word count and who spoke how much, from the transcript lines. */
export function transcriptStats(lines: Pick<TranscriptLine, "speaker" | "text">[]): TranscriptStats {
  let you = 0;
  let all = 0;
  for (const l of lines) {
    const n = countWords(l.text);
    all += n;
    if (l.speaker === "you") you += n;
  }
  return { words: all, turns: lines.length, you: all ? you / all : 0 };
}

/** The same transcript the pipeline builds and sends, merged from Whisper's chunks. */
export function statsFromChunks(chunks: TranscribedChunk[], chunkSeconds: number): TranscriptStats {
  return transcriptStats(mergeTranscript(chunks, chunkSeconds));
}
