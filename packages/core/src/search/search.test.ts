import { test } from "node:test";
import assert from "node:assert/strict";
import { search, snippet } from "./search.ts";
import type { Meeting } from "../meeting.ts";

const m = (id: string, over: Partial<Meeting>): Meeting => ({
  id, project: "Fundraise", title: id, startedAt: "Today", durationSec: 60, verified: true, summary: "",
  decisions: [], actionItems: [], followUps: [], transcript: [], ...over,
});

const meetings = [
  m("Deck review", {
    decisions: ["Show pricing in the deck only as a range."],
    transcript: [{ at: 482, speaker: "you", text: "If we change pricing now we confuse the pilots and lose the trust we built over three months." }],
  }),
  m("Planning", { project: "Platform API", actionItems: [{ id: "a1", text: "Draft the pricing page copy", owner: "Victor", done: false }] }),
  m("Hiring sync", { transcript: [{ at: 10, speaker: "others", text: "Let's hire a designer." }] }),
];

test("finds decisions, action items and transcript lines, case and punctuation aside", () => {
  const r = search(meetings, "PRICING");
  assert.equal(r.decisions.length, 1);
  assert.equal(r.actions.length, 1);
  assert.equal(r.transcript.length, 1);
  assert.equal(r.meetings, 2);
});

test("transcript hits show the words around the match", () => {
  const r = search(meetings, "pricing");
  const hit = r.transcript[0];
  assert.ok(hit.kind === "transcript" && hit.at === 482);
  assert.equal(snippet("one two three four five six seven eight nine ten pricing eleven twelve", "pricing"), "… four five six seven eight nine ten pricing eleven twelve");
});

test("too-short queries return nothing", () => {
  assert.equal(search(meetings, "a").meetings, 0);
});
