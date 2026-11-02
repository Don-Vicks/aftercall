/** "[12:40]" or "[1:02:03]": a time in your notes, as Mark writes it (or you type it). */
const MOMENT = /\[(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)\]/g;

export interface Moment {
  /** Seconds into the call. */
  at: number;
  /** Where "[12:40]" starts in the text, and how long it is. */
  index: number;
  length: number;
}

/** Every "[mm:ss]" in your notes, in order. */
export function findMoments(text: string): Moment[] {
  const out: Moment[] = [];
  for (const m of text.matchAll(MOMENT)) {
    const at = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    out.push({ at, index: m.index ?? 0, length: m[0].length });
  }
  return out;
}
