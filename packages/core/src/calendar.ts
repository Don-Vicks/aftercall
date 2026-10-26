import type { Meeting } from "./meeting.ts";

/** Someone invited to a calendar event, other than the user. */
export interface Attendee {
  /** Empty when the calendar has no name for them. */
  name: string;
  /** Empty when the invite has no email address. */
  email: string;
}

/** A macOS calendar event, as the desktop app reads it. */
export interface CalendarEvent {
  title: string;
  /** Unix seconds. */
  start: number;
  end: number;
  allDay: boolean;
  attendees: Attendee[];
}

/**
 * The event a recording belongs to: the timed event it overlaps most. An event
 * that shares only a sliver of time (the end of the previous meeting) doesn't count:
 * the overlap must be at least a quarter of the shorter of the two.
 */
export function bestEvent(events: CalendarEvent[], start: number, end: number): CalendarEvent | null {
  const recEnd = Math.max(end, start + 60);
  let best: { event: CalendarEvent; overlap: number; gap: number } | null = null;
  for (const event of events) {
    if (event.allDay || event.end <= event.start) continue;
    const overlap = Math.min(recEnd, event.end) - Math.max(start, event.start);
    if (overlap <= 0 || overlap < 0.25 * Math.min(recEnd - start, event.end - event.start)) continue;
    const gap = Math.abs(event.start - start);
    if (!best || overlap > best.overlap || (overlap === best.overlap && gap < best.gap)) best = { event, overlap, gap };
  }
  return best?.event ?? null;
}

const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]+/g) ?? [];

/**
 * The invited person a name from the notes ("Ada", "Ada Lovelace") refers to. Tries
 * the full name, then the first name, then the email's local part, and only answers
 * when exactly one person fits: a wrong guess would send the recap to the wrong person.
 */
export function matchAttendee(name: string, attendees: Attendee[]): Attendee | null {
  const want = words(name);
  if (want.length === 0) return null;
  const withEmail = attendees.filter((a) => a.email);
  const tests: ((a: Attendee) => boolean)[] = [
    (a) => words(a.name).join(" ") === want.join(" "),
    (a) => want.length === 1 && words(a.name)[0] === want[0],
    (a) => {
      const local = words(a.email.split("@")[0]);
      return local.join("") === want.join("") || (want.length === 1 && local[0] === want[0]);
    },
  ];
  for (const test of tests) {
    const found = withEmail.filter(test);
    if (found.length === 1) return found[0];
    if (found.length > 1) return null;
  }
  return null;
}

/**
 * Names a meeting after its calendar event and fills recap addresses from the
 * invite. Addresses the person already set are kept. A recap with no name goes to
 * the only other person invited, if there is exactly one.
 */
export function applyCalendarEvent(meeting: Meeting, event: CalendarEvent): Meeting {
  const invited = event.attendees.filter((a) => a.email);
  const followUps = meeting.followUps.map((f) => {
    if (f.kind !== "email" || f.to) return f;
    const match = f.toName ? matchAttendee(f.toName, invited) : invited.length === 1 ? invited[0] : null;
    return match ? { ...f, to: match.email, toName: f.toName || match.name } : f;
  });
  return { ...meeting, title: event.title || meeting.title, invited, followUps };
}
