// The brief while you review it: every item carries where it came from (you, a template
// or GitHub) and whether it's in (ticked). Nothing here saves anything; `draftBrief`
// turns the ticked items into the `ProjectBrief` that the Create or Save button stores.

import { BRIEF_LIMITS, cleanBrief, type ProjectBrief } from "./pipeline.ts";
import { briefTemplate, type BriefTemplateId } from "./briefTemplates.ts";
import type { BriefSource, GithubSuggestion } from "./githubBrief.ts";

export type DraftOrigin = "you" | "template" | "github";
export type BriefField = "about" | "people" | "words" | "watchFor";

export interface DraftText {
  text: string;
  origin: DraftOrigin;
  /** In the brief. Text you wrote is in whenever it isn't empty. */
  on: boolean;
  /** On Refresh, for text you edited: GitHub's newer version, offered, never applied by itself. */
  alt?: string;
  /** "Changed on GitHub", "Kept: you edited this". */
  note?: string;
}

export interface DraftPerson {
  /** Stable key for the row. */
  key: string;
  name: string;
  role: string;
  origin: DraftOrigin;
  on: boolean;
  note?: string;
}

export interface DraftWord {
  word: string;
  origin: DraftOrigin;
  on: boolean;
  note?: string;
}

export interface BriefDraft {
  about: DraftText;
  people: DraftPerson[];
  words: DraftWord[];
  watchFor: DraftText;
  /** The template picked on Start, if any. */
  template?: BriefTemplateId;
}

let seq = 0;
const key = () => `p${++seq}`;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const text = (t: string, origin: DraftOrigin = "you"): DraftText => ({ text: t, origin, on: true });

export function emptyDraft(): BriefDraft {
  return { about: text(""), people: [], words: [], watchFor: text("") };
}

export function newPerson(name = "", role = "", origin: DraftOrigin = "you"): DraftPerson {
  return { key: key(), name, role, origin, on: true };
}

/**
 * A saved brief, ready to edit. With a GitHub source, items that GitHub suggested last
 * time (and you kept unchanged) show as from GitHub; the rest as yours.
 */
export function draftFromBrief(brief: ProjectBrief | undefined, source?: BriefSource): BriefDraft {
  const seen = source?.seen;
  const fromGithub = (v: string, list?: string[]) => Boolean(list?.some((x) => same(x, v)));
  return {
    about: text(brief?.about ?? "", brief?.about && seen?.about === brief.about ? "github" : "you"),
    people: (brief?.people ?? []).map((p) => newPerson(p.name, p.role ?? "", fromGithub(p.name, seen?.people) ? "github" : "you")),
    words: (brief?.words ?? []).map((w) => ({ word: w, origin: fromGithub(w, seen?.words) ? "github" : "you", on: true })),
    watchFor: text(brief?.watchFor ?? ""),
  };
}

/** True when a person row goes into the brief: ticked, with a name. */
export const personIn = (p: DraftPerson) => p.on && p.name.trim().length > 0;
const textIn = (t: DraftText) => t.on && t.text.trim().length > 0;

/** The brief the ticked items make, cleaned (`cleanBrief`); undefined when nothing is left. */
export function draftBrief(d: BriefDraft): ProjectBrief | undefined {
  return cleanBrief({
    about: textIn(d.about) ? d.about.text : "",
    people: d.people.filter(personIn).map((p) => ({ name: p.name, role: p.role })),
    words: d.words.filter((w) => w.on).map((w) => w.word),
    watchFor: textIn(d.watchFor) ? d.watchFor.text : "",
  });
}

/**
 * Picks a template: its watch-for text (unless you wrote your own), its empty role slots
 * and its words. A template picked before is taken back first, except rows you typed a
 * name into. Blank takes the last template back and adds nothing.
 */
export function withTemplate(d: BriefDraft, id: BriefTemplateId): BriefDraft {
  const t = briefTemplate(id);
  const people = d.people.filter((p) => p.origin !== "template" || p.name.trim());
  const words = d.words.filter((w) => w.origin !== "template");
  const watchFor = d.watchFor.origin === "template" || !d.watchFor.text.trim() ? (t.watchFor ? text(t.watchFor, "template") : text("")) : d.watchFor;
  for (const role of t.roles) people.push(newPerson("", role, "template"));
  for (const w of t.words) if (!words.some((x) => same(x.word, w))) words.push({ word: w, origin: "template", on: true });
  return { ...d, people, words, watchFor, template: id === "blank" ? undefined : id };
}

/**
 * Adds what a repo suggests, ticked (it's copied as GitHub has it): About if you haven't
 * written one, and people and words you don't already have. A repo looked up before is
 * taken back first.
 */
export function withGithub(d: BriefDraft, s: GithubSuggestion): BriefDraft {
  const people = d.people.filter((p) => p.origin !== "github");
  const words = d.words.filter((w) => w.origin !== "github");
  const about = d.about.origin === "github" || !d.about.text.trim() ? (s.about ? text(s.about, "github") : text("")) : d.about;
  // Real people before a template's empty role slots, and the repo's own words before a template's general ones.
  const slot = people.findIndex((p) => p.origin === "template" && !p.name.trim());
  const added = s.people.filter((p) => !people.some((x) => same(x.name, p.name))).map((p) => newPerson(p.name, p.role ?? "", "github"));
  people.splice(slot < 0 ? people.length : slot, 0, ...added);
  const general = words.findIndex((w) => w.origin === "template");
  const specific = s.words.filter((w) => !words.some((x) => same(x.word, w))).map((w): DraftWord => ({ word: w, origin: "github", on: true }));
  words.splice(general < 0 ? words.length : general, 0, ...specific);
  return { ...d, about, people, words };
}

/** What a field shows as its origin: each origin among its items that are in, in a fixed order. */
export function fieldOrigins(d: BriefDraft, field: BriefField): DraftOrigin[] {
  const list: DraftOrigin[] =
    field === "people" ? d.people.filter(personIn).map((p) => p.origin) : field === "words" ? d.words.filter((w) => w.on).map((w) => w.origin) : textIn(d[field]) ? [d[field].origin] : [];
  return (["github", "template", "you"] as const).filter((o) => list.includes(o));
}

/** Counts as you go, and the items past the limits (`BRIEF_LIMITS`), which aren't kept. */
export function draftLimits(d: BriefDraft): { people: number; words: number; peopleOver: Set<string>; wordsOver: Set<string> } {
  const peopleOver = new Set<string>();
  const wordsOver = new Set<string>();
  const names: string[] = [];
  for (const p of d.people.filter(personIn)) {
    if (names.some((n) => same(n, p.name))) continue;
    if (names.length >= BRIEF_LIMITS.people) peopleOver.add(p.key);
    else names.push(p.name);
  }
  const words: string[] = [];
  for (const w of d.words.filter((x) => x.on)) {
    if (words.some((x) => same(x, w.word))) continue;
    if (words.length >= BRIEF_LIMITS.words) wordsOver.add(w.word.toLowerCase());
    else words.push(w.word);
  }
  return { people: names.length, words: words.length, peopleOver, wordsOver };
}

/** Words typed or pasted into the add box: split on commas and lines, added once each, as yours. */
export function addWords(d: BriefDraft, typed: string[]): BriefDraft {
  const words = [...d.words];
  for (const raw of typed) {
    const w = raw.replace(/\s+/g, " ").trim();
    if (!w) continue;
    const i = words.findIndex((x) => same(x.word, w));
    if (i >= 0) words[i] = { ...words[i], on: true };
    else words.push({ word: w, origin: "you", on: true });
  }
  return { ...d, words };
}

/**
 * Refresh: the saved brief against what the repo suggests now and what it suggested at
 * the last import (`seen`). Only GitHub's changes are offered, each one tickable; what
 * you edited is kept, with GitHub's newer About offered beside it; nothing you removed
 * comes back unless GitHub itself changed it; nothing is dropped without you.
 */
export function refreshDraft(brief: ProjectBrief | undefined, source: BriefSource, fresh: GithubSuggestion): { draft: BriefDraft; changes: string[] } {
  const seen = source.seen ?? {};
  const draft = draftFromBrief(brief, source);
  const changes: string[] = [];

  const current = brief?.about ?? "";
  if (fresh.about && fresh.about !== (seen.about ?? "")) {
    if (!current || current === seen.about) {
      draft.about = { text: fresh.about, origin: "github", on: true, note: current ? "Changed on GitHub" : "New on GitHub" };
      changes.push(current ? "About changed on GitHub" : "About added from GitHub");
    } else if (current !== fresh.about) {
      draft.about = { ...draft.about, alt: fresh.about, note: "Kept: you edited this" };
      changes.push("About changed on GitHub (yours is kept)");
    }
  }

  const has = (list: string[] | undefined, v: string) => Boolean(list?.some((x) => same(x, v)));
  let addedPeople = 0;
  for (const p of fresh.people) {
    if (has(seen.people, p.name) || draft.people.some((x) => same(x.name, p.name))) continue;
    draft.people.push({ ...newPerson(p.name, p.role ?? "", "github"), note: "New on GitHub" });
    addedPeople++;
  }
  let gonePeople = 0;
  for (const row of draft.people) {
    if (row.origin === "github" && has(seen.people, row.name) && !fresh.people.some((p) => same(p.name, row.name))) {
      row.note = "Not on GitHub now";
      gonePeople++;
    }
  }
  let addedWords = 0;
  for (const w of fresh.words) {
    if (has(seen.words, w) || draft.words.some((x) => same(x.word, w))) continue;
    draft.words.push({ word: w, origin: "github", on: true, note: "New on GitHub" });
    addedWords++;
  }
  let goneWords = 0;
  for (const w of draft.words) {
    if (w.origin === "github" && has(seen.words, w.word) && !fresh.words.some((x) => same(x, w.word))) {
      w.note = "Not on GitHub now";
      goneWords++;
    }
  }
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  if (addedPeople) changes.push(`${n(addedPeople, "person", "people")} new on GitHub`);
  if (gonePeople) changes.push(`${n(gonePeople, "person is", "people are")} no longer listed (kept until you untick)`);
  if (addedWords) changes.push(`${n(addedWords, "word", "words")} new on GitHub`);
  if (goneWords) changes.push(`${n(goneWords, "word is", "words are")} no longer on GitHub (kept until you remove)`);
  return { draft, changes };
}
