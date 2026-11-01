import type { Speaker, TranscriptLine } from "../meeting.ts";
import { formatClock } from "../meeting.ts";

/** The part of Whisper's `verbose_json` response the app uses. */
export interface WhisperResult {
  text: string;
  /** Seconds of audio, which is what Whisper bills for. */
  duration?: number;
  segments?: { start: number; end: number; text: string; no_speech_prob?: number }[];
}

export interface TranscribedChunk {
  speaker: Speaker;
  /** Position of the chunk in the recording (0, 1, 2...). */
  index: number;
  result: WhisperResult;
}

/** Whisper's "probably not speech" segments, e.g. a hallucinated "Thank you." over silence. */
const NO_SPEECH = 0.6;

/**
 * Merges the transcribed chunks of both stems into one timeline. "You" comes from
 * the microphone stem and "Others" from the call-audio stem; voices are never identified.
 */
export function mergeTranscript(chunks: TranscribedChunk[], chunkSeconds: number): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const c of chunks) {
    const offset = c.index * chunkSeconds;
    const segments = c.result.segments?.length ? c.result.segments : [{ start: 0, end: 0, text: c.result.text }];
    for (const s of segments) {
      const text = s.text.trim();
      if (!text || (s.no_speech_prob ?? 0) > NO_SPEECH) continue;
      lines.push({ at: Math.floor(offset + s.start), speaker: c.speaker, text });
    }
  }
  lines.sort((a, b) => a.at - b.at || (a.speaker === b.speaker ? 0 : a.speaker === "you" ? -1 : 1));

  // Join consecutive segments from the same speaker into readable turns.
  const turns: TranscriptLine[] = [];
  for (const line of lines) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === line.speaker && line.at - last.at < 30) last.text = `${last.text} ${line.text}`;
    else turns.push({ ...line });
  }
  return turns;
}

/** The transcript as the summary model reads it: "[02:14] YOU: ...". */
export function transcriptForPrompt(lines: TranscriptLine[]): string {
  return lines.map((l) => `[${formatClock(l.at)}] ${l.speaker === "you" ? "YOU" : "OTHERS"}: ${l.text}`).join("\n");
}

/**
 * Scripts written without spaces between words: Chinese, Japanese, Thai, Lao, Khmer
 * and Myanmar. In these a word can start or end at any letter.
 */
const SPACELESS = "\\p{scx=Han}\\p{scx=Hiragana}\\p{scx=Katakana}\\p{scx=Thai}\\p{scx=Lao}\\p{scx=Khmer}\\p{scx=Myanmar}";
/** One letter or digit of a script written without spaces (not a mark or punctuation). */
const SPACELESS_LETTER = new RegExp(`(?=[\\p{L}\\p{N}])[${SPACELESS}]`, "u");
const SPACELESS_LETTERS = new RegExp(SPACELESS_LETTER.source, "gu");

/** Whether the text has any letter of Chinese, Japanese, Thai, Lao, Khmer or Myanmar. */
export function hasSpacelessScript(s: string): boolean {
  return SPACELESS_LETTER.test(s);
}

/**
 * What "the same words" means, in any language: Unicode NFKC (full-width letters and
 * digits become plain ones), case-folded, straight apostrophes, single spaces, and only
 * letters, marks and digits of any script, apostrophes and $. Accents stay: "déjà" is
 * not "deja".
 */
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\p{Cf}\u0640]/gu, "") // zero-width joiners, soft hyphens, Arabic tatweel: spelling, not words
    .toUpperCase()
    .toLowerCase() // via upper case, so "Straße" and "STRASSE" are the same words
    .replace(/ς/g, "σ")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^\p{L}\p{M}\p{N}'$]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How many words a normalized quote has: each word between spaces counts one, and
 * in scripts written without spaces every two letters count one, so six letters of
 * Japanese weigh as much as three English words.
 */
export function quoteWords(normalized: string): number {
  let letters = 0;
  const rest = normalized.replace(SPACELESS_LETTERS, () => {
    letters++;
    return " ";
  });
  const words = rest.split(" ").filter((w) => /[\p{L}\p{N}$]/u.test(w)).length;
  return words + letters / 2;
}

/** Quotes shorter than this many words (see `quoteWords`) are too short to count as evidence. */
export const MIN_QUOTE_WORDS = 3;

/**
 * Finds a quote in the transcript. Returns the line it starts in and the quote
 * exactly as written there, or null if the words aren't in the transcript. The match
 * must start and end on whole words: "50 per user" isn't in "$1.50 per user", and
 * the quote returned is always the transcript's text, never the model's. In Chinese,
 * Japanese, Thai and the other scripts written without spaces, any letter starts or
 * ends a word.
 */
export function findQuote(lines: TranscriptLine[], quote: string): { at: number; text: string } | null {
  const wanted = normalize(quote);
  if (quoteWords(wanted) < MIN_QUOTE_WORDS) return null; // too short to count as evidence
  for (const line of lines) {
    if (!normalize(line.text).includes(wanted)) continue;
    const text = exactSpan(line.text, wanted);
    if (text !== null) return { at: line.at, text };
  }
  return null;
}

/**
 * Where a word may start or end in `text`, as string offsets: at the edges of each
 * run of non-space text, and between two letters when either is in a script written
 * without spaces (never before a combining mark).
 */
function wordEdges(text: string): number[] {
  const edges: number[] = [];
  let prev = "";
  let i = 0;
  for (const ch of text) {
    const space = /\s/.test(ch);
    const prevSpace = prev === "" || /\s/.test(prev);
    if (space !== prevSpace) edges.push(i);
    else if (!space && !/\p{M}/u.test(ch) && (SPACELESS_LETTER.test(ch) || SPACELESS_LETTER.test(prev))) edges.push(i);
    prev = ch;
    i += ch.length;
  }
  if (prev !== "" && !/\s/.test(prev)) edges.push(i);
  return edges;
}

/** Recovers the original spelling and punctuation of a normalized match inside `text`. */
function exactSpan(text: string, wanted: string): string | null {
  const edges = wordEdges(text);
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const span = text.slice(edges[i], edges[j]);
      const acc = normalize(span);
      if (acc === wanted) return span.replace(/\s+/g, " ").replace(/^[^\p{L}\p{M}\p{N}$]+|[^\p{L}\p{M}\p{N}]+$/gu, "");
      if (!wanted.startsWith(acc)) break;
    }
  }
  return null;
}
