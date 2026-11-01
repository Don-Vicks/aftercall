import { test } from "node:test";
import assert from "node:assert/strict";
import { dayWord, dueGroup, dueLabel, groupRows, longDate, meetingIso, meetingLabel, meetingTime, parseDue, relativeDay, shortDate, weekGroup } from "./when.ts";

// Local times, so the tests hold in any time zone. Wednesday 4 November 2026, noon.
const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 11, 4);
const day = (y: number, mo: number, d: number) => new Date(y, mo - 1, d).getTime();

test("meetingTime reads an ISO startedAt, a recording id (Unix seconds) or the sample's 'Today HH:MM'", () => {
  assert.equal(meetingTime({ id: "1793006441", startedAt: "whatever" }), 1793006441_000);
  assert.equal(meetingTime({ id: "1793006441", startedAt: new Date(at(2026, 11, 2, 9, 15)).toISOString() }), at(2026, 11, 2, 9, 15), "the ISO time wins");
  assert.equal(meetingTime({ id: "sync-ada", startedAt: "2026-11-03T10:00:00.000Z" }), Date.UTC(2026, 10, 3, 10));
  assert.equal(meetingTime({ id: "sync-ada", startedAt: "2026-13-45Tnonsense" }), null);
  assert.equal(meetingTime({ id: "sync-ada", startedAt: "Today 14:02" }, NOW), at(2026, 11, 4, 14, 2));
  assert.equal(meetingTime({ id: "sync-ada", startedAt: "3 Nov 10:00" }, NOW), null);
  assert.equal(meetingIso({ id: "1793006441", startedAt: "Today 09:00" }), "2026-10-26T09:20:41.000Z");
  assert.equal(meetingIso({ id: "x", startedAt: "Someday" }), null);
});

test("meetingLabel: today, yesterday, a weekday within the last week, then the date", () => {
  const iso = (ms: number) => new Date(ms).toISOString();
  assert.equal(meetingLabel({ id: "1", startedAt: iso(at(2026, 11, 4, 8, 5)) }, NOW), "Today 08:05");
  assert.equal(meetingLabel({ id: "1", startedAt: iso(at(2026, 11, 3, 23, 59)) }, NOW), "Yesterday 23:59");
  assert.equal(meetingLabel({ id: "1", startedAt: iso(at(2026, 11, 2, 9, 30)) }, NOW), "Monday 09:30");
  assert.equal(meetingLabel({ id: "1", startedAt: iso(at(2026, 10, 29, 16)) }, NOW), "Thursday 16:00", "six days ago");
  assert.equal(meetingLabel({ id: "1", startedAt: iso(at(2026, 10, 28, 17)) }, NOW), "28 Oct 17:00", "a week ago");
  assert.equal(meetingLabel({ id: "1", startedAt: iso(at(2025, 12, 30, 11)) }, NOW), "30 Dec 2025 11:00");
  // The same meeting, read on later days: the label moves with the clock.
  const m = { id: "1", startedAt: iso(at(2026, 11, 4, 14, 2)) };
  assert.equal(meetingLabel(m, at(2026, 11, 5)), "Yesterday 14:02");
  assert.equal(meetingLabel(m, at(2026, 11, 20)), "4 Nov 14:02");
  assert.equal(dayWord(at(2026, 11, 4, 1), NOW), "Today");
  assert.equal(longDate(NOW), "Wednesday 4 Nov 2026");
});

test("meetingLabel ignores the stale 'Today HH:MM' that older meetings saved and reads the recording id", () => {
  const id = String(at(2026, 10, 28, 17) / 1000);
  assert.equal(meetingLabel({ id, startedAt: "Today 17:00" }, NOW), "28 Oct 17:00");
  assert.equal(meetingLabel({ id: String(at(2026, 11, 3, 9, 30) / 1000), startedAt: "Today 09:30" }, NOW), "Yesterday 09:30");
  assert.equal(meetingLabel({ id: String(at(2026, 11, 1, 10) / 1000), startedAt: "Today 10:00" }, NOW), "Sunday 10:00");
  assert.equal(meetingLabel({ id: String(at(2026, 11, 3, 9, 30) / 1000), startedAt: "" }, NOW), "Yesterday 09:30");
  // The built-in sample has no recording id: "Today" is always today.
  assert.equal(meetingLabel({ id: "sync-ada", startedAt: "Today 14:02" }, NOW), "Today 14:02");
  assert.equal(meetingLabel({ id: "x", startedAt: "Someday" }, NOW), "Someday");
});

test("dates read as people say them", () => {
  assert.equal(shortDate(at(2026, 10, 29), NOW), "29 Oct");
  assert.equal(shortDate(at(2025, 10, 29), NOW), "29 Oct 2025");
  assert.equal(relativeDay(at(2026, 11, 4, 9), NOW), "today");
  assert.equal(relativeDay(at(2026, 11, 3, 23), NOW), "yesterday");
  assert.equal(relativeDay(at(2026, 11, 1), NOW), "1 Nov");
});

test("weekGroup: today, this week, last week, then months; no date last", () => {
  assert.deepEqual(weekGroup(at(2026, 11, 4, 8), NOW, { today: true }), { key: "today", title: "Today" });
  assert.equal(weekGroup(at(2026, 11, 4, 8), NOW).title, "This week");
  assert.equal(weekGroup(at(2026, 11, 2, 8), NOW, { today: true }).title, "Earlier this week");
  assert.equal(weekGroup(at(2026, 11, 1, 20), NOW).title, "Last week", "Sunday belongs to the week before");
  assert.equal(weekGroup(at(2026, 10, 26, 9), NOW).title, "Last week");
  assert.equal(weekGroup(at(2026, 10, 25, 9), NOW).title, "October");
  assert.equal(weekGroup(at(2025, 12, 25), NOW).title, "December 2025");
  assert.equal(weekGroup(null, NOW).title, "No date");
});

test("groupRows starts a new heading only where the group changes", () => {
  const groups = groupRows([1, 2, 3, 5], (n) => ({ key: n < 3 ? "a" : "b", title: n < 3 ? "A" : "B" }));
  assert.deepEqual(
    groups.map((g) => [g.group.title, g.rows]),
    [
      ["A", [1, 2]],
      ["B", [3, 5]],
    ],
  );
});

test("parseDue: relative words count from the day of the meeting", () => {
  const said = at(2026, 10, 26, 10); // Monday 26 October
  assert.equal(parseDue("today", said), day(2026, 10, 26));
  assert.equal(parseDue("Tomorrow", said), day(2026, 10, 27));
  assert.equal(parseDue("by Friday", said), day(2026, 10, 30));
  assert.equal(parseDue("Monday", said), day(2026, 10, 26), "the same weekday means that day");
  assert.equal(parseDue("next Monday", said), day(2026, 11, 2));
  assert.equal(parseDue("next Friday", said), day(2026, 11, 6));
  assert.equal(parseDue("end of the week", said), day(2026, 10, 30));
  assert.equal(parseDue("next week", said), day(2026, 11, 6));
  assert.equal(parseDue("end of month", said), day(2026, 10, 31));
  assert.equal(parseDue("in 3 days", said), day(2026, 10, 29));
  assert.equal(parseDue("in two weeks", said), day(2026, 11, 9));
  assert.equal(parseDue("Friday at 5pm", said), day(2026, 10, 30));
});

test("parseDue: dates, with the year rolling over in December", () => {
  const said = at(2026, 10, 26, 10);
  assert.equal(parseDue("29 Oct", said), day(2026, 10, 29));
  assert.equal(parseDue("October 29th", said), day(2026, 10, 29));
  assert.equal(parseDue("by 13 November", said), day(2026, 11, 13));
  assert.equal(parseDue("2026-11-13", said), day(2026, 11, 13));
  assert.equal(parseDue("5 Jan", at(2026, 12, 20)), day(2027, 1, 5));
});

test("parseDue: anything vague, or a meeting with no date, has no due day", () => {
  const said = at(2026, 10, 26, 10);
  for (const vague of ["soon", "after the launch", "ASAP", "", "next quarter", "13/11"]) assert.equal(parseDue(vague, said), null, vague);
  assert.equal(parseDue(undefined, said), null);
  assert.equal(parseDue("by Friday", null), null);
});

test("dueGroup and dueLabel from today's point of view", () => {
  const cases: [number | null, string, string][] = [
    [day(2026, 10, 30), "overdue", "Due 30 Oct"],
    [day(2026, 11, 4), "today", "Today"],
    [day(2026, 11, 5), "week", "Tomorrow"],
    [day(2026, 11, 6), "week", "by Friday"],
    [day(2026, 11, 8), "week", "by Sunday"],
    [day(2026, 11, 13), "later", "13 Nov"],
    [null, "none", ""],
  ];
  for (const [due, group, label] of cases) {
    assert.equal(dueGroup(due, NOW), group, label);
    assert.equal(dueLabel(due, NOW), label);
  }
});
