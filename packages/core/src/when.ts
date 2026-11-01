import type { Meeting } from "./meeting.ts";

/**
 * Dates for lists of meetings, people and action items: when a meeting happened,
 * which week it falls in, and when "by Friday" said in a meeting actually is.
 * Everything is local time and takes `now`, so it is the same in tests.
 */

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Local midnight of the day `ms` falls in. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** `n` calendar days after the day `ms` falls in, at midnight (safe across clock changes). */
function addDays(ms: number, n: number): number {
  const d = new Date(startOfDay(ms));
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** Monday 00:00 of the week `ms` falls in. */
export function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  return addDays(d.getTime(), -((d.getDay() + 6) % 7));
}

/**
 * When a meeting started, in ms. New meetings store an ISO time in `startedAt`.
 * Older ones stored a label written on the day ("Today 14:02"), which goes stale, so
 * the time comes from the recording id instead: recordings are named after their
 * start time in Unix seconds. The built-in sample says "Today 14:02" and means today.
 * Null when none of these applies.
 */
export function meetingTime(m: Pick<Meeting, "id" | "startedAt">, now = Date.now()): number | null {
  if (/^\d{4}-\d{2}-\d{2}T/.test(m.startedAt)) {
    const t = Date.parse(m.startedAt);
    if (!Number.isNaN(t)) return t;
  }
  if (/^\d{9,11}$/.test(m.id)) return Number(m.id) * 1000;
  const today = /^Today (\d{1,2}):(\d{2})$/.exec(m.startedAt.trim());
  if (today) {
    const d = new Date(startOfDay(now));
    d.setHours(Number(today[1]), Number(today[2]));
    return d.getTime();
  }
  return null;
}

/** The meeting's start as an ISO time for machines (the MCP server), or null when it has none. */
export function meetingIso(m: Pick<Meeting, "id" | "startedAt">, now = Date.now()): string | null {
  const t = meetingTime(m, now);
  return t === null ? null : new Date(t).toISOString();
}

/** "29 Oct", with the year when it isn't this year's. */
export function shortDate(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const year = d.getFullYear() === new Date(now).getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}`;
}

/** "today", "yesterday" or "29 Oct". */
export function relativeDay(ms: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return shortDate(ms, now);
}

/**
 * When a meeting started, for people and prompts: "Today 14:02", "Yesterday 09:30",
 * "Monday 10:15" within the last week, then "28 Oct 17:00". Worked out at display time
 * from the real time, never the stored label. The stored text only when there is no time.
 */
export function meetingLabel(m: Pick<Meeting, "id" | "startedAt">, now = Date.now()): string {
  const t = meetingTime(m, now);
  if (t === null) return m.startedAt;
  return `${dayWord(t, now)} ${clockTime(t)}`;
}

/** "Today", "Yesterday", "Monday" within the last week, then "28 Oct". */
export function dayWord(ms: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return WEEKDAY_NAMES[new Date(ms).getDay()];
  return shortDate(ms, now);
}

/** "Sunday 1 Nov 2026" */
export function longDate(ms: number): string {
  const d = new Date(ms);
  return `${WEEKDAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "14:02" */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export interface Group {
  key: string;
  title: string;
}

/**
 * The heading a dated row sits under in a list that runs newest first: "Today" (when
 * `today` is set), "This week" or "Earlier this week", "Last week", then the month
 * ("October", or "October 2025" in another year). "No date" when there is none.
 */
export function weekGroup(ms: number | null, now: number, opts: { today?: boolean } = {}): Group {
  if (ms === null) return { key: "none", title: "No date" };
  const week = startOfWeek(now);
  if (opts.today && ms >= startOfDay(now)) return { key: "today", title: "Today" };
  if (ms >= week) return { key: "week", title: opts.today ? "Earlier this week" : "This week" };
  if (ms >= addDays(week, -7)) return { key: "last-week", title: "Last week" };
  const d = new Date(ms);
  const year = d.getFullYear() === new Date(now).getFullYear() ? "" : ` ${d.getFullYear()}`;
  return { key: `m-${d.getFullYear()}-${d.getMonth()}`, title: `${MONTH_NAMES[d.getMonth()]}${year}` };
}

/** Rows in order, with a heading wherever the group changes. */
export function groupRows<T>(rows: T[], groupOf: (row: T) => Group): { group: Group; rows: T[] }[] {
  const out: { group: Group; rows: T[] }[] = [];
  for (const row of rows) {
    const g = groupOf(row);
    const last = out[out.length - 1];
    if (last && last.group.key === g.key) last.rows.push(row);
    else out.push({ group: g, rows: [row] });
  }
  return out;
}

/** The date `day` (0 = Sunday) falls on, on or after `from`. */
function nextWeekday(from: number, day: number): number {
  const d = new Date(startOfDay(from));
  return addDays(d.getTime(), (day - d.getDay() + 7) % 7);
}

/** Friday of the week `ms` falls in, or `ms`'s own day once Friday has passed. */
function endOfWorkWeek(ms: number): number {
  const friday = addDays(startOfWeek(ms), 4);
  return Math.max(friday, startOfDay(ms));
}

/**
 * When a due date said in a meeting falls, as local midnight of that day. `said` is
 * when the meeting happened, since "by Friday" means the Friday after it. Reads
 * today, tomorrow, weekdays ("by Friday", "next Monday"), "this week", "next week",
 * "end of the month", "in 3 days", "29 Oct", "October 29th" and "2026-11-13".
 * Null for anything else ("soon", "after the launch"), and when the meeting has no date.
 */
export function parseDue(due: string | undefined | null, said: number | null): number | null {
  if (!due || said === null) return null;
  let s = due.toLowerCase().replace(/[.,!]/g, " ").replace(/\s+/g, " ").trim();
  s = s
    .replace(/^(due|by|before|on|until|no later than|for)\s+/, "")
    .replace(/^the\s+/, "")
    .replace(/\s+at\s+.*$/, "");

  if (/^(today|tonight|end of (the )?day|eod|this (morning|afternoon|evening))$/.test(s)) return startOfDay(said);
  if (/^tomorrow( (morning|afternoon|evening))?$/.test(s)) return addDays(said, 1);
  if (/^(end of (the )?week|this week|eow)$/.test(s)) return endOfWorkWeek(said);
  if (/^next week$/.test(s)) return endOfWorkWeek(addDays(startOfWeek(said), 7));
  if (/^(end of (the )?month|this month|eom)$/.test(s)) {
    const d = new Date(said);
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime();
  }

  const inN = /^in (\d{1,2}|a|one|two|three) (day|days|week|weeks)$/.exec(s);
  if (inN) {
    const n = { a: 1, one: 1, two: 2, three: 3 }[inN[1] as "a"] ?? Number(inN[1]);
    return addDays(said, inN[2].startsWith("week") ? n * 7 : n);
  }

  const wd = /^(this |next |coming )?(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*( morning| afternoon| evening| eod)?$/.exec(s);
  if (wd) {
    const day = WEEKDAYS.findIndex((w) => w.startsWith(wd[2]));
    if (day < 0) return null;
    if (wd[1]?.trim() === "next") return addDays(startOfWeek(addDays(startOfWeek(said), 7)), (day + 6) % 7);
    return nextWeekday(said, day);
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])).getTime();

  const month = (word: string) => (word.length >= 3 ? MONTH_NAMES.findIndex((n) => n.toLowerCase().startsWith(word)) : -1);
  const dm = /^(\d{1,2})(st|nd|rd|th)? (?:of )?([a-z]+)( \d{4})?$/.exec(s);
  const md = /^([a-z]+) (\d{1,2})(st|nd|rd|th)?( \d{4})?$/.exec(s);
  const parts = dm ? { day: Number(dm[1]), month: month(dm[3]), year: dm[4] } : md ? { day: Number(md[2]), month: month(md[1]), year: md[4] } : null;
  if (parts && parts.month >= 0 && parts.day >= 1 && parts.day <= 31) {
    const saidYear = new Date(said).getFullYear();
    let at = new Date(parts.year ? Number(parts.year) : saidYear, parts.month, parts.day).getTime();
    // "5 Jan" said in late December is next year's.
    if (!parts.year && at < addDays(said, -31)) at = new Date(saidYear + 1, parts.month, parts.day).getTime();
    return at;
  }
  return null;
}

export type DueGroup = "overdue" | "today" | "week" | "later" | "none";

/** Where a due day sits from today's point of view. */
export function dueGroup(due: number | null, now: number): DueGroup {
  if (due === null) return "none";
  const today = startOfDay(now);
  if (due < today) return "overdue";
  if (due < addDays(today, 1)) return "today";
  if (due < addDays(startOfWeek(now), 7)) return "week";
  return "later";
}

/** "Due 29 Oct", "Today", "Tomorrow", "by Friday" or "13 Nov". Empty when there's no date. */
export function dueLabel(due: number | null, now: number): string {
  const group = dueGroup(due, now);
  if (due === null) return "";
  if (group === "overdue") return `Due ${shortDate(due, now)}`;
  if (group === "today") return "Today";
  if (startOfDay(due) === addDays(now, 1)) return "Tomorrow";
  if (group === "week") return `by ${WEEKDAY_NAMES[new Date(due).getDay()]}`;
  return shortDate(due, now);
}
