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

/** Lowercase, straight quotes, single spaces, no punctuation: what "the same words" means. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'$ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Finds a quote in the transcript. Returns the line it starts in and the quote
 * exactly as written there, or null if the words aren't in the transcript.
 */
export function findQuote(lines: TranscriptLine[], quote: string): { at: number; text: string } | null {
  const wanted = normalize(quote);
  if (wanted.split(" ").length < 3) return null; // too short to count as evidence
  for (const line of lines) {
    if (normalize(line.text).includes(wanted)) return { at: line.at, text: exactSpan(line.text, wanted) ?? quote };
  }
  return null;
}

/** Recovers the original spelling and punctuation of a normalized match inside `text`. */
function exactSpan(text: string, wanted: string): string | null {
  const words = text.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    let acc = "";
    for (let j = i; j < words.length; j++) {
      acc = normalize(words.slice(i, j + 1).join(" "));
      if (acc === wanted) return words.slice(i, j + 1).join(" ").replace(/^[^\w$]+|[^\w]+$/g, "");
      if (!wanted.startsWith(acc)) break;
    }
  }
  return null;
}
