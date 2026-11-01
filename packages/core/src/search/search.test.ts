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

test("finds words in any language, accents and case aside only where they are case", () => {
  const world = [
    m("Tokyo", { transcript: [{ at: 5, speaker: "others", text: "来週の月曜日までに、デザイナーに500ドルを払います。それから、ロゴの案を三つ送ってもらって、金曜日にみんなで決めましょう。" }] }),
    m("Moscow", { decisions: ["Платим дизайнеру в понедельник."] }),
    m("Paris", { transcript: [{ at: 9, speaker: "you", text: "On a déjà décidé pour vendredi." }] }),
    m("Delhi", { actionItems: [{ id: "a1", text: "डिज़ाइनर को भुगतान करना", owner: "You", done: false }] }),
  ];
  assert.equal(search(world, "デザイナー").transcript.length, 1);
  assert.equal(search(world, "ДИЗАЙНЕРУ").decisions.length, 1);
  assert.equal(search(world, "DÉJÀ").transcript.length, 1);
  assert.equal(search(world, "deja").transcript.length, 0, "déjà is not deja");
  assert.equal(search(world, "भुगतान").actions.length, 1);
  assert.equal(search(world, "pricing").meetings, 0, "English queries don't match other scripts");
});

test("snippets in Chinese or Japanese are cut by letters, since there are no spaces", () => {
  const text = "来週の月曜日までに、デザイナーに500ドルを払います。それから、ロゴの案を三つ送ってもらって、金曜日にみんなで決めましょう。";
  assert.equal(snippet(text, "ロゴの案"), "…イナーに500ドルを払います。それから、ロゴの案を三つ送ってもらって、金曜日にみんなで決…");
  assert.equal(snippet("短い文です。", "文"), "短い文です。", "short lines are shown whole");
});
