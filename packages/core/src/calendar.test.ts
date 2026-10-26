import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCalendarEvent, bestEvent, matchAttendee, type Attendee, type CalendarEvent } from "./calendar.ts";
import type { EmailFollowUp, Meeting } from "./meeting.ts";

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return 1_800_000_000 + h * 3600 + m * 60;
};
const event = (title: string, from: string, to: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  title, start: at(from), end: at(to), allDay: false, attendees: [], ...extra,
});

test("picks the event the recording overlaps most", () => {
  const events = [event("Standup", "14:00", "15:00"), event("Sync with Ada", "15:00", "15:30")];
  assert.equal(bestEvent(events, at("14:58"), at("15:28"))?.title, "Sync with Ada");
  assert.equal(bestEvent(events, at("14:10"), at("14:40"))?.title, "Standup");
});

test("ignores all-day events and slivers of a neighbouring meeting", () => {
  assert.equal(bestEvent([event("Offsite", "00:00", "23:59", { allDay: true })], at("10:00"), at("10:30")), null);
  assert.equal(bestEvent([event("Standup", "14:00", "15:00")], at("14:57"), at("15:40")), null);
  assert.equal(bestEvent([], at("10:00"), at("10:30")), null);
});

test("a short recording inside a long meeting still matches it", () => {
  assert.equal(bestEvent([event("Board meeting", "09:00", "11:00")], at("09:30"), at("09:30"))?.title, "Board meeting");
});

test("on equal overlap, the event that started nearest the recording wins", () => {
  const events = [event("Long", "09:00", "11:00"), event("Short", "10:00", "10:30")];
  assert.equal(bestEvent(events, at("10:00"), at("10:20"))?.title, "Short");
});

const people: Attendee[] = [
  { name: "Ada Lovelace", email: "ada@example.com" },
  { name: "Grace Hopper", email: "grace@navy.mil" },
  { name: "", email: "charles.babbage@example.com" },
  { name: "Ada Byron", email: "" },
];

test("matches names from the notes to invited people", () => {
  assert.equal(matchAttendee("Ada Lovelace", people)?.email, "ada@example.com");
  assert.equal(matchAttendee("grace", people)?.email, "grace@navy.mil");
  assert.equal(matchAttendee("Charles", people)?.email, "charles.babbage@example.com");
  assert.equal(matchAttendee("Charles Babbage", people)?.email, "charles.babbage@example.com");
  assert.equal(matchAttendee("Zoë", [{ name: "Zoe Adams", email: "zoe@example.com" }])?.email, "zoe@example.com");
});

test("doesn't guess when the name fits nobody or more than one person", () => {
  assert.equal(matchAttendee("Bob", people), null);
  assert.equal(matchAttendee("", people), null);
  const twoAdas = [...people, { name: "Ada Smith", email: "asmith@example.com" }];
  assert.equal(matchAttendee("Ada", twoAdas), null);
  assert.equal(matchAttendee("Ada Smith", twoAdas)?.email, "asmith@example.com");
});

const recap = (id: string, toName: string, to = ""): EmailFollowUp => ({
  id, kind: "email", status: "proposed", to, toName, subject: "Recap", evidence: { quote: "send the recap", at: 0 },
});
const meeting = (followUps: EmailFollowUp[]): Meeting => ({
  id: "1", project: "General", title: "API fix and demo", startedAt: "Today 15:00", durationSec: 1800, verified: true,
  summary: "", decisions: [], actionItems: [], followUps, transcript: [],
});

test("names the meeting after the event and fills recap addresses", () => {
  const out = applyCalendarEvent(
    meeting([recap("f1", "Ada"), recap("f2", "Grace", "grace@other.org"), recap("f3", "Bob")]),
    event("Sync with Ada", "15:00", "15:30", { attendees: people }),
  );
  assert.equal(out.title, "Sync with Ada");
  assert.deepEqual(out.followUps.map((f) => (f.kind === "email" ? f.to : "")), ["ada@example.com", "grace@other.org", ""]);
  assert.deepEqual(out.invited?.map((a) => a.email), ["ada@example.com", "grace@navy.mil", "charles.babbage@example.com"]);
});

test("an unnamed recap goes to the only other person invited, and only then", () => {
  const one = event("1:1", "15:00", "15:30", { attendees: [{ name: "Ada Lovelace", email: "ada@example.com" }] });
  const f = applyCalendarEvent(meeting([recap("f1", "")]), one).followUps[0] as EmailFollowUp;
  assert.equal(f.to, "ada@example.com");
  assert.equal(f.toName, "Ada Lovelace");
  const many = applyCalendarEvent(meeting([recap("f1", "")]), event("Team", "15:00", "15:30", { attendees: people }));
  assert.equal((many.followUps[0] as EmailFollowUp).to, "");
});

test("an event without a title keeps the notes' title", () => {
  assert.equal(applyCalendarEvent(meeting([]), event("", "15:00", "15:30")).title, "API fix and demo");
});
