import type { Attendee } from "./calendar.ts";
import type { Meeting, Speaker } from "./meeting.ts";

/** People colours: avatar grounds `--p1`..`--p6` in the design system. */
export const PERSON_HUES = 6;

/** One of the six people colours, 1-based to match `--p1`..`--p6`. */
export type PersonHue = 1 | 2 | 3 | 4 | 5 | 6;

/** Lowercase, single-spaced, without a trailing "(Company)" or an email/NEAR suffix. */
function normalize(name: string): string {
  return name
    .replace(/\([^)]*\)/g, " ")
    .replace(/@.*$/, "")
    .replace(/\.(near|testnet)$/i, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * The colour slot for a person, from a hash of their name (FNV-1a), so the same
 * person always gets the same colour on every screen and on the web pages.
 * Case, spacing and a "(Company)" suffix don't change it.
 */
export function personHue(name: string): PersonHue {
  let h = 0x811c9dc5;
  for (const ch of normalize(name)) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ((h % PERSON_HUES) + 1) as PersonHue;
}

/**
 * Up to two initials: first and last word ("Ines Rocha" -> "IR"), or one for a
 * single word ("Ada" -> "A"). Emails and NEAR accounts use the part before the
 * suffix ("designer.near" -> "D"). "?" when there is nothing to show.
 */
export function initials(name: string): string {
  const words = normalize(name)
    .split(/[\s._-]+/)
    .map((w) => Array.from(w).find((c) => /[\p{L}\p{N}]/u.test(c)))
    .filter((c): c is string => Boolean(c));
  if (words.length === 0) return "?";
  const picked = words.length === 1 ? [words[0]] : [words[0], words[words.length - 1]];
  return picked.join("").toLocaleUpperCase();
}

/** How the notes refer to the person who recorded the call. */
const SELF = new Set(["you", "me", "myself", "i", "yourself"]);

/**
 * True when an action item's owner (or a speaker) is the person using Aftercall:
 * "You", "Me", "you (Victor)", or one of the names in `me`. `me` takes the user's
 * own name, first name, email or NEAR account ("victor.near" matches "Victor").
 */
export function isYou(owner: string, me: string | readonly string[] = []): boolean {
  const raw = owner.trim().toLowerCase();
  const inParens = [...raw.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim());
  const plain = normalize(owner).replace(/[.!,:;]+$/, "");
  if (SELF.has(plain) || inParens.some((p) => SELF.has(p))) return true;
  const names = (typeof me === "string" ? [me] : me).map(normalize).filter(Boolean);
  if (names.length === 0 || !plain) return false;
  const firstNames = names.map((n) => n.split(" ")[0]);
  return names.includes(plain) || firstNames.includes(plain) || inParens.some((p) => names.includes(p) || firstNames.includes(p));
}

/**
 * Everyone else a meeting's calendar event invited. Notes saved before `attendees`
 * existed only kept the people with an email (`invited`), so they fall back to that.
 */
export function othersOn(meeting: Pick<Meeting, "attendees" | "invited">): Attendee[] {
  return meeting.attendees ?? meeting.invited ?? [];
}

/**
 * The name a transcript line is shown under. Your microphone is "You". The call's
 * audio is "Others", unless the calendar invited exactly one other person: then it
 * is their name (or email). Aftercall never identifies voices, so with two or more
 * people on the other side it can't say who spoke, and doesn't guess.
 */
export function speakerLabel(speaker: Speaker, attendees: readonly Attendee[] = []): string {
  if (speaker === "you") return "You";
  if (attendees.length !== 1) return "Others";
  return attendees[0].name.trim() || attendees[0].email.trim() || "Others";
}
