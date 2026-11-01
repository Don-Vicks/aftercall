import type { Meeting, Speaker } from "../meeting.ts";
import { hasSpacelessScript, normalize } from "../notes/transcript.ts";

/**
 * Search across meetings, on the device. Results are grouped the way people
 * look for things: what was decided, what's owed, then what was said.
 */

export type Hit =
  | { kind: "decision"; meetingId: string; meeting: string; project: string; text: string }
  | { kind: "action"; meetingId: string; meeting: string; project: string; text: string; owner: string; done: boolean }
  | { kind: "transcript"; meetingId: string; meeting: string; project: string; at: number; speaker: Speaker; snippet: string };

export interface Results {
  decisions: Hit[];
  actions: Hit[];
  transcript: Hit[];
  meetings: number;
}

const SNIPPET_WORDS = 7;
/** For Chinese, Japanese, Thai...: letters kept on each side of the match. */
const SNIPPET_CHARS = 20;

/**
 * Where `wanted` (normalized) starts in the raw letters, and how many raw letters it
 * takes. Normalizing can change the length ("ﾃﾞ" is one letter, "デ"), so the raw span
 * is widened until it normalizes to the query.
 */
function rawMatch(chars: string[], wanted: string): { start: number; length: number } | null {
  const most = [...wanted].length * 2 + 2;
  for (let i = 0; i < chars.length; i++) {
    if (!normalize(chars[i])) continue;
    for (let k = i + 1; k <= Math.min(chars.length, i + most); k++) {
      if (normalize(chars.slice(i, k).join("")) === wanted) return { start: i, length: k - i };
    }
  }
  return null;
}

/** The words around the match, with "…" where text was cut. */
export function snippet(text: string, query: string): string {
  if (hasSpacelessScript(text)) {
    // No spaces to cut at: cut by letters instead.
    const chars = [...text];
    const match = rawMatch(chars, normalize(query));
    if (match && chars.length > match.length + 2 * SNIPPET_CHARS) {
      const from = Math.max(0, match.start - SNIPPET_CHARS);
      const to = Math.min(chars.length, match.start + match.length + SNIPPET_CHARS);
      return `${from > 0 ? "…" : ""}${chars.slice(from, to).join("").trim()}${to < chars.length ? "…" : ""}`;
    }
  }
  const words = text.split(/\s+/);
  const q = normalize(query).split(" ");
  const start = words.findIndex((_, i) => normalize(words.slice(i, i + q.length).join(" ")).includes(q.join(" ")));
  if (start < 0) return text;
  const from = Math.max(0, start - SNIPPET_WORDS);
  const to = Math.min(words.length, start + q.length + SNIPPET_WORDS);
  return `${from > 0 ? "… " : ""}${words.slice(from, to).join(" ")}${to < words.length ? " …" : ""}`;
}

export function search(meetings: Meeting[], query: string): Results {
  const q = normalize(query);
  const empty: Results = { decisions: [], actions: [], transcript: [], meetings: 0 };
  if (q.length < 2) return empty;
  const has = (text: string) => normalize(text).includes(q);
  const out = empty;
  const touched = new Set<string>();

  for (const m of meetings) {
    const base = { meetingId: m.id, meeting: m.title, project: m.project };
    for (const d of m.decisions) if (has(d)) out.decisions.push({ kind: "decision", ...base, text: d });
    for (const a of m.actionItems) if (has(a.text) || has(a.owner)) out.actions.push({ kind: "action", ...base, text: a.text, owner: a.owner, done: a.done });
    for (const l of m.transcript) if (has(l.text)) out.transcript.push({ kind: "transcript", ...base, at: l.at, speaker: l.speaker, snippet: snippet(l.text, query) });
    if ([...out.decisions, ...out.actions, ...out.transcript].some((h) => h.meetingId === m.id) || has(m.title) || has(m.summary)) touched.add(m.id);
  }
  out.meetings = touched.size;
  return out;
}
