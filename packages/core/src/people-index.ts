import { matchAttendee, type Attendee } from "./calendar.ts";
import { decisionEvidence, type Evidence, type FollowUpStatus, type Meeting } from "./meeting.ts";
import { isYou } from "./people.ts";
import { meetingTime } from "./when.ts";

/**
 * People, worked out from meetings on this Mac. Nothing here recognises voices:
 * a person comes from a calendar invite (name and email), an action item's owner,
 * a recap's recipient or a payment's payee. The rules are deliberately cautious,
 * so a person is never credited with something they didn't say or owe.
 */

/** Where a person was found. */
export type PersonSource = "calendar" | "said" | "payee";

export interface PersonItem {
  meetingId: string;
  meeting: string;
  itemId: string;
  text: string;
  owner: string;
  due?: string;
  done: boolean;
  /**
   * Why it's listed: "owner" (they own it), "named" (your item names them) or
   * "one-to-one" (your item from a call where your calendar invited only them).
   */
  why: "owner" | "named" | "one-to-one";
  /** The exact words behind the item; absent on meetings made before quotes were kept. */
  evidence?: Evidence;
}

export interface PersonPayment {
  meetingId: string;
  meeting: string;
  followUpId: string;
  amount: bigint | null;
  heard: string;
  status: FollowUpStatus;
  doneAt?: string;
}

/** Words from the other side of a call where your calendar invited only this person. */
export interface PersonQuote {
  meetingId: string;
  meeting: string;
  at: number;
  text: string;
}

export interface PersonDecision {
  meetingId: string;
  meeting: string;
  text: string;
  /** The exact words behind the decision; absent on meetings made before quotes were kept. */
  evidence?: Evidence;
}

export interface Person {
  /** Stable for routing: "email:ada@example.com", "near:designer.near" or "name:ada". */
  id: string;
  name: string;
  email: string;
  /** NEAR account, for payees. */
  account: string;
  sources: PersonSource[];
  /** Meetings they were invited to or named in, newest first. */
  meetingIds: string[];
  /** The subset their calendar invite came from. */
  invitedTo: string[];
  /** When the newest of those meetings started (ms), if known. */
  lastAt: number | null;
  /** Whether they were invited (rather than only named) in that newest meeting. */
  lastInvited: boolean;
  youOwe: PersonItem[];
  theyOwe: PersonItem[];
  payments: PersonPayment[];
  quotes: PersonQuote[];
  /** Decisions from meetings they were invited to. */
  decisions: PersonDecision[];
}

export interface PeopleIndex {
  people: Person[];
  byId: Record<string, Person>;
  /** The faces for a meeting: everyone invited or, without an invite, up to two people it named. */
  byMeeting: Record<string, string[]>;
  /** The one person a call was with, by meeting id, when the calendar invited exactly one. */
  oneToOne: Record<string, string>;
}

export const openCount = (items: { done: boolean }[]) => items.filter((i) => !i.done).length;

/** Owners that aren't a person. */
const NOT_PEOPLE = new Set([
  "",
  "unassigned",
  "unknown",
  "unknown payee",
  "someone",
  "nobody",
  "everyone",
  "everybody",
  "all",
  "both",
  "team",
  "the team",
  "we",
  "us",
  "they",
  "them",
  "others",
  "other",
  "n/a",
  "na",
  "none",
  "tbd",
]);
/** First names that are also everyday words: never matched on their own inside an item's text. */
const WORD_NAMES = new Set([
  "will",
  "may",
  "mark",
  "bill",
  "grace",
  "hope",
  "joy",
  "june",
  "april",
  "summer",
  "rose",
  "sky",
  "frank",
  "art",
  "sue",
  "pat",
  "gene",
  "max",
  "jack",
  "bob",
  "rob",
  "sam",
  "dawn",
  "faith",
  "drew",
  "chase",
  "miles",
  "page",
  "rich",
]);
const NAME_ONLY_MAX_PER_MEETING = 2;

type How = "invited" | "named" | "paid";
const RANK: Record<How, number> = { paid: 0, named: 1, invited: 2 };
const QUOTES_PER_MEETING = 2;
const QUOTES_MAX = 6;
const QUOTE_MIN_WORDS = 6;

/** Lowercase, accents off, no "(Company)", single spaces. */
function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9@.'\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (s: string) =>
  norm(s)
    .replace(/[@.'-]/g, " ")
    .split(" ")
    .filter(Boolean);

/** Invitees other than you: `invited`, plus `attendees` when a newer app version writes it. */
export function attendeesOf(m: Meeting, me: readonly string[] = []): Attendee[] {
  const extra = (m as { attendees?: unknown }).attendees;
  const raw: unknown[] = [...(Array.isArray(extra) ? extra : []), ...(m.invited ?? [])];
  const out: Attendee[] = [];
  for (const a of raw) {
    let name = "";
    let email = "";
    if (typeof a === "string") {
      if (a.includes("@")) email = a.trim();
      else name = a.trim();
    } else if (a && typeof a === "object") {
      const o = a as Record<string, unknown>;
      if (o.self === true || o.you === true || o.isYou === true || o.isCurrentUser === true) continue;
      name = typeof o.name === "string" ? o.name.trim() : "";
      email = typeof o.email === "string" ? o.email.trim() : "";
    }
    if (!name && !email) continue;
    if (isYou(name || email, me) || (email && isYou(email, me))) continue;
    const dupe = out.find((x) => (email && x.email.toLowerCase() === email.toLowerCase()) || (!email && !x.email && norm(x.name) === norm(name)));
    if (dupe) {
      if (!dupe.name && name) dupe.name = name;
      continue;
    }
    out.push({ name, email });
  }
  return out;
}

/** "ada@example.com" -> "Ada", "theo.moss@x.io" -> "Theo Moss". */
function nameFromEmail(email: string): string {
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

interface Draft extends Person {
  /** How strong the current display name is: calendar 4, recap 3, said 2, payee 1, derived 0. */
  nameRank: number;
}

/**
 * Everyone in these meetings, newest first. `me` holds the names that mean you
 * (your name, NEAR account or email); "You" and "Me" always do.
 */
export function buildPeople(meetings: Meeting[], opts: { me?: readonly string[]; now?: number } = {}): PeopleIndex {
  const me = opts.me ?? [];
  const now = opts.now ?? Date.now();
  const time = new Map(meetings.map((m) => [m.id, meetingTime(m, now)]));
  const sorted = [...meetings].sort((a, b) => (time.get(b.id) ?? -Infinity) - (time.get(a.id) ?? -Infinity));
  const drafts = new Map<string, Draft>();
  /** meeting -> person -> how they came up: invited, named (owner, recap) or paid (payee only). */
  const mentions = new Map<string, Map<string, How>>();

  const upsert = (id: string, fields: { name?: string; email?: string; account?: string }, rank: number, source: PersonSource): Draft => {
    let p = drafts.get(id);
    if (!p) {
      p = {
        id,
        name: "",
        email: "",
        account: "",
        sources: [],
        meetingIds: [],
        invitedTo: [],
        lastAt: null,
        lastInvited: false,
        youOwe: [],
        theyOwe: [],
        payments: [],
        quotes: [],
        decisions: [],
        nameRank: -1,
      };
      drafts.set(id, p);
    }
    if (fields.email && !p.email) p.email = fields.email;
    if (fields.account && !p.account) p.account = fields.account;
    const name = fields.name?.trim();
    if (name && rank > p.nameRank) {
      p.name = name;
      p.nameRank = rank;
    } else if (!p.name) {
      p.name = fields.email ? nameFromEmail(fields.email) : fields.account ? fields.account.replace(/\.(near|testnet)$/i, "") : "";
      p.nameRank = 0;
    }
    if (!p.sources.includes(source)) p.sources.push(source);
    return p;
  };

  const mention = (meetingId: string, personId: string, how: How) => {
    const map = mentions.get(meetingId) ?? new Map<string, How>();
    mentions.set(meetingId, map);
    const was = map.get(personId);
    if (!was || RANK[how] > RANK[was]) map.set(personId, how);
  };

  // Pass 1: people with an email or a NEAR account, which identify them across meetings.
  for (const m of sorted) {
    for (const a of attendeesOf(m, me)) {
      if (a.email) mention(m.id, upsert(`email:${a.email.toLowerCase()}`, a, 4, "calendar").id, "invited");
    }
    for (const f of m.followUps) {
      if (f.kind === "email" && f.to) {
        const p = upsert(`email:${f.to.toLowerCase()}`, { name: f.toName, email: f.to }, 3, "said");
        mention(m.id, p.id, "named");
      }
      if (f.kind === "payment" && f.payeeAccount) {
        const p = upsert(`near:${f.payeeAccount.toLowerCase()}`, { name: f.payeeName === "Unknown payee" ? "" : f.payeeName, account: f.payeeAccount }, 1, "payee");
        mention(m.id, p.id, "paid");
      }
    }
  }

  const keyed = () => [...drafts.values()];
  /** Who each name in each meeting turned out to be, so every later lookup agrees. */
  const assigned = new Map<string, string>();
  const slot = (m: Meeting, name: string) => `${m.id}\u0000${words(name).join(" ")}`;
  const assignedTo = (name: string, m: Meeting) => {
    const id = assigned.get(slot(m, name));
    return id ? drafts.get(id) : undefined;
  };

  /**
   * The person a bare name refers to. In its own meeting the invite decides: a guest
   * with an email (matchAttendee), then a guest without one. Otherwise a known person
   * (with an email or account, or invited by name elsewhere) whose full name is that
   * name, or whose first name, email or NEAR account starts with it, when exactly one
   * fits. Null when none or several fit.
   */
  const resolve = (name: string, m: Meeting): Draft | null => {
    const guests = attendeesOf(m, me);
    const local = matchAttendee(
      name,
      guests.filter((a) => a.email),
    );
    if (local) return drafts.get(`email:${local.email.toLowerCase()}`) ?? null;
    const want = words(name);
    if (want.length === 0) return null;
    const full = want.join(" ");
    const sameName = (n: string) => words(n).join(" ") === full || (want.length === 1 && words(n)[0] === want[0]);
    const localGuests = guests.filter((a) => !a.email && a.name && sameName(a.name));
    if (localGuests.length === 1) {
      const guest = assignedTo(localGuests[0].name, m);
      if (guest) return guest;
    }
    if (localGuests.length > 1) return null;
    const tests: ((p: Draft) => boolean)[] = [
      (p) => words(p.name).join(" ") === full,
      (p) => want.length === 1 && (words(p.name)[0] === want[0] || words(p.email.split("@")[0] ?? "")[0] === want[0] || words(p.account)[0] === want[0]),
    ];
    const known = keyed().filter((p) => !p.id.startsWith("name:") || p.sources.includes("calendar"));
    for (const test of tests) {
      const found = known.filter(test);
      if (found.length === 1) return found[0];
      if (found.length > 1) return null;
    }
    return null;
  };

  const isPerson = (name: string) => !NOT_PEOPLE.has(norm(name)) && !isYou(name, me);

  /** A named person: someone already known, else a name-only person. Remembered per meeting. */
  const named = (name: string, m: Meeting, rank: number, source: PersonSource): Draft | null => {
    if (!isPerson(name)) return null;
    const already = assignedTo(name, m);
    const known = already ?? resolve(name, m);
    const key = words(name).join(" ");
    const p = known ? upsert(known.id, { name }, rank, source) : key ? upsert(`name:${key}`, { name }, rank, source) : null;
    if (p) assigned.set(slot(m, name), p.id);
    return p;
  };

  // Pass 2: guests without an email address, who are still invitations.
  for (const m of sorted) {
    for (const a of attendeesOf(m, me)) {
      if (!a.email && a.name) {
        const p = named(a.name, m, 4, "calendar");
        if (p) mention(m.id, p.id, "invited");
      }
    }
  }

  // Pass 3: names in the notes (owners, recaps with no address yet, payees not on your list).
  for (const m of sorted) {
    for (const a of m.actionItems) {
      const p = named(a.owner, m, 2, "said");
      if (p) mention(m.id, p.id, "named");
    }
    for (const f of m.followUps) {
      if (f.kind === "email" && !f.to && f.toName) {
        const p = named(f.toName, m, 3, "said");
        if (p) mention(m.id, p.id, "named");
      }
      if (f.kind === "payment" && !f.payeeAccount && f.payeeName) {
        const p = named(f.payeeName, m, 1, "said");
        if (p) mention(m.id, p.id, "paid");
      }
    }
  }

  // Invitations decide which meetings a person was in, and a call with exactly one
  // invitee is a one-to-one: the only call where "the other side" is that person.
  const oneToOne: Record<string, string> = {};
  for (const m of sorted) {
    const invitees = attendeesOf(m, me);
    if (invitees.length !== 1) continue;
    const a = invitees[0];
    const p = a.email ? drafts.get(`email:${a.email.toLowerCase()}`) : assignedTo(a.name, m);
    if (p) oneToOne[m.id] = p.id;
  }

  const people = keyed();
  const firstNames = new Map<string, number>();
  for (const p of people) {
    const first = words(p.name)[0];
    if (first) firstNames.set(first, (firstNames.get(first) ?? 0) + 1);
  }

  /** Whether your item's text names this person, by rules that rarely misfire. */
  const namesThem = (text: string, p: Draft): boolean => {
    const t = ` ${words(text).join(" ")} `;
    const has = (phrase: string) => phrase.length > 0 && t.includes(` ${phrase} `);
    const full = words(p.name);
    if (full.length > 1 && has(full.join(" "))) return true;
    const first = full[0];
    if (first && first.length >= 3 && !WORD_NAMES.has(first) && firstNames.get(first) === 1 && has(first)) return true;
    if (p.account) {
      const acct = words(p.account);
      if (has(acct.join(" "))) return true;
      const head = acct[0];
      if (head && head.length >= 4 && !WORD_NAMES.has(head) && has(head)) return true;
    }
    return false;
  };

  for (const m of sorted) {
    const base = { meetingId: m.id, meeting: m.title };
    const here = mentions.get(m.id) ?? new Map<string, How>();
    for (const [personId, how] of here) {
      const p = drafts.get(personId)!;
      p.meetingIds.push(m.id);
      if (how === "invited") {
        p.invitedTo.push(m.id);
        p.decisions.push(
          ...m.decisions.map((text, i) => {
            const evidence = decisionEvidence(m, i);
            return { ...base, text, ...(evidence ? { evidence } : {}) };
          }),
        );
      }
    }

    for (const a of m.actionItems) {
      const item = { ...base, itemId: a.id, text: a.text, owner: a.owner, due: a.due, done: a.done, ...(a.evidence ? { evidence: a.evidence } : {}) };
      if (isYou(a.owner, me)) {
        for (const p of people) {
          if (namesThem(a.text, p)) p.youOwe.push({ ...item, why: "named" });
          else if (oneToOne[m.id] === p.id) p.youOwe.push({ ...item, why: "one-to-one" });
        }
      } else if (isPerson(a.owner)) {
        const owner = assignedTo(a.owner, m);
        owner?.theyOwe.push({ ...item, why: "owner" });
      }
    }

    for (const f of m.followUps) {
      if (f.kind !== "payment") continue;
      const p = f.payeeAccount ? drafts.get(`near:${f.payeeAccount.toLowerCase()}`) : f.payeeName ? assignedTo(f.payeeName, m) : undefined;
      p?.payments.push({ ...base, followUpId: f.id, amount: f.amount, heard: f.heard, status: f.status, doneAt: f.doneAt });
    }

    const solo = oneToOne[m.id] ? drafts.get(oneToOne[m.id]) : undefined;
    if (solo && solo.quotes.length < QUOTES_MAX) {
      const lines = m.transcript.filter((l) => l.speaker === "others" && l.text.split(/\s+/).length >= QUOTE_MIN_WORDS).slice(0, QUOTES_PER_MEETING);
      solo.quotes.push(...lines.slice(0, QUOTES_MAX - solo.quotes.length).map((l) => ({ ...base, at: l.at, text: l.text })));
    }
  }

  const byMeeting: Record<string, string[]> = {};
  for (const m of sorted) {
    const here = [...(mentions.get(m.id) ?? new Map<string, How>())];
    const invited = here.filter(([, how]) => how === "invited").map(([id]) => id);
    // Without an invite, a call's faces are the first couple of people it named as
    // owners or recap recipients. Payees often weren't on the call, so never them.
    const namedOnly = here.filter(([, how]) => how === "named").map(([id]) => id);
    byMeeting[m.id] = invited.length ? invited : namedOnly.slice(0, NAME_ONLY_MAX_PER_MEETING);
  }

  const out: Person[] = people
    .filter((p) => p.meetingIds.length > 0 && p.name)
    .map(({ nameRank: _rank, ...p }) => {
      const last = p.meetingIds[0];
      return { ...p, lastAt: time.get(last) ?? null, lastInvited: p.invitedTo.includes(last) };
    })
    .sort((a, b) => (b.lastAt ?? -Infinity) - (a.lastAt ?? -Infinity) || a.name.localeCompare(b.name));

  const byId = Object.fromEntries(out.map((p) => [p.id, p]));
  for (const id of Object.keys(byMeeting)) byMeeting[id] = byMeeting[id].filter((p) => byId[p]);
  return { people: out, byId, byMeeting, oneToOne };
}

/** The name the other side of a call goes by: the one person invited, or null. */
export function otherSideName(index: PeopleIndex, meetingId: string): string | null {
  const id = index.oneToOne[meetingId];
  return id ? (index.byId[id]?.name ?? null) : null;
}

/** First name for headings: "Ada" from "Ada Lovelace". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
