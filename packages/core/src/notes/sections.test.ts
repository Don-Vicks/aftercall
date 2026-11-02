import { test } from "node:test";
import assert from "node:assert/strict";
import type { TranscriptLine } from "../meeting.ts";
import type { Notes } from "./schema.ts";
import { OVERLAP_LINES, SECTION_SECONDS, mergeSectionNotes, mergeSpeakers, nearSame, needsSplit, overallRequestText, planSections } from "./sections.ts";
import { estimateTokens, numberedTranscript } from "./transcript.ts";

/** A call of `minutes` with a turn every 20 seconds, the two sides taking turns. */
function call(minutes: number, words = 12): TranscriptLine[] {
  return Array.from({ length: Math.floor((minutes * 60) / 20) }, (_, i) => ({
    at: i * 20,
    speaker: i % 2 ? "others" : "you",
    text: `Line ${i} ${"word ".repeat(words).trim()}`,
  }));
}

const empty: Notes = { title: "", summary: "", decisions: [], action_items: [], followups: [], speakers: [] };

test("a call up to 45 minutes of ordinary talk is one part, as before", () => {
  for (const minutes of [1, 22, 44]) {
    const lines = call(minutes);
    assert.equal(needsSplit(lines), false, `${minutes} min`);
    assert.deepEqual(planSections(lines), [{ start: 0, lines, context: [] }]);
  }
  assert.equal(needsSplit([]), false);
});

test("a long call splits on line boundaries into even parts that cover every line once, each with a little context", () => {
  const lines = call(120);
  assert.equal(needsSplit(lines), true);
  const parts = planSections(lines);
  assert.equal(parts.length, Math.ceil(120 / (SECTION_SECONDS / 60)), "2 hours is 5 parts of at most about 25 minutes");
  assert.deepEqual(parts.flatMap((p) => p.lines), lines, "every line exactly once, in order");
  for (const [i, p] of parts.entries()) {
    assert.equal(p.lines[0], lines[p.start]);
    assert.deepEqual(p.context, i === 0 ? [] : lines.slice(p.start - OVERLAP_LINES, p.start), "the end of the part before, as context");
    const minutes = (p.lines[p.lines.length - 1].at - p.lines[0].at) / 60;
    assert.ok(minutes <= 25, `part ${i + 1} is ${minutes} min`);
  }
});

test("a dense call splits on its token estimate even when it is short", () => {
  const lines = call(30, 120);
  const tokens = estimateTokens(lines.map((l) => l.text).join("\n"));
  assert.ok(tokens > 12_000, `${tokens} tokens`);
  assert.equal(needsSplit(lines), true);
  assert.ok(planSections(lines).length >= 2);
});

test("the token estimate counts letters of scripts without spaces one each", () => {
  assert.equal(estimateTokens("abcdefgh"), 2);
  assert.equal(estimateTokens("日本語です"), 5);
});

test("each part numbers its own lines from 1 and shows the context unnumbered", () => {
  const lines = call(120);
  const p = planSections(lines)[1];
  const text = numberedTranscript(p.lines, p.context);
  assert.match(text, /^Before this part \(context only\):\n\[\d\d:\d\d\] (You|Others): /);
  assert.match(text, /\n\nThis part:\n#1 \[\d\d:\d\d\] (You|Others): /);
  assert.ok(!text.includes(`#${p.lines.length + 1} `));
  assert.equal(numberedTranscript(lines.slice(0, 2)), `#1 [00:00] You: ${lines[0].text}\n#2 [00:20] Others: ${lines[1].text}`);
});

test("near-identical text: same words, or most words shared; numbers must match", () => {
  assert.ok(nearSame("Send Ada the recap.", "send ada the recap"));
  assert.ok(nearSame("Ship the beta to the first ten customers on Friday", "Ship the beta to the first ten customers by Friday"));
  assert.ok(!nearSame("Pay Ada 50 for the logo", "Pay Ada 500 for the logo"), "a different number is a different item");
  assert.ok(!nearSame("Send the deck", "Send the budget"), "short texts must be the same words");
  assert.ok(!nearSame("Theo owns the hiring plan for Q1", "Ines owns the launch plan for Q1"));
});

test("merging parts keeps every item once, in order, and never merges payments that differ", () => {
  const parts = planSections(call(120)).slice(0, 2);
  const pay = (amount: string, evidence: string) => ({ type: "payment" as const, payee_name: "Designer", amount_words: amount, memo: null, evidence });
  const a: Notes = {
    ...empty,
    decisions: [{ text: "Launch on Friday", evidence: "we launch on Friday then" }],
    action_items: [{ text: "Send Ada the recap", owner: "You", due: null, evidence: "send Ada the recap after this" }],
    followups: [pay("fifty dollars", "pay the designer fifty dollars"), { type: "email", to_name: "Ada", subject: "Recap", evidence: "send Ada the recap after this" }],
  };
  const b: Notes = {
    ...empty,
    // The same decision quoted again from the overlap, and the same action item reworded.
    decisions: [
      { text: "We launch Friday", evidence: "We launch on Friday then." },
      { text: "Hire a second designer", evidence: "let's hire a second designer" },
    ],
    action_items: [
      { text: "Send Ada the recap.", owner: "you", due: null, evidence: "the recap goes to Ada" },
      { text: "Send Ada the recap", owner: "Theo", due: null, evidence: "Theo sends Ada the recap" },
    ],
    followups: [
      pay("fifty dollars", "the designer fifty dollars"),
      pay("five hundred dollars", "pay the designer fifty dollars"),
      pay("fifty dollars", "another fifty dollars for the designer next week"),
      { type: "email", to_name: "Ada", subject: "The recap", evidence: "send Ada the recap after this" },
    ],
  };
  const merged = mergeSectionNotes(parts, [a, b], { title: "Long sync", summary: "Two parts." });
  assert.equal(merged.title, "Long sync");
  assert.equal(merged.summary, "Two parts.");
  assert.deepEqual(merged.decisions.map((d) => d.text), ["Launch on Friday", "Hire a second designer"], "same quote: kept once, the first part's wording");
  assert.deepEqual(merged.action_items.map((x) => [x.text, x.owner]), [["Send Ada the recap", "You"], ["Send Ada the recap", "Theo"]], "same text and owner merge; another owner doesn't");
  assert.deepEqual(
    merged.followups.map((f) => (f.type === "payment" ? `pay ${f.amount_words}: ${f.evidence}` : `email ${f.to_name}`)),
    ["pay fifty dollars: pay the designer fifty dollars", "email Ada", "pay five hundred dollars: pay the designer fifty dollars", "pay fifty dollars: another fifty dollars for the designer next week"],
    "a payment merges only with the same payee, amount words and an overlapping quote",
  );
});

test("speaker lines are mapped from each part back to the whole transcript; doubtful ones are dropped", () => {
  const lines = call(120);
  const parts = planSections(lines);
  const second = parts[1];
  // Local line 2 of part 2 is an "others" line when the part starts on a "you" line.
  const local = second.lines.findIndex((l) => l.speaker === "others") + 1;
  const youLine = second.lines.findIndex((l) => l.speaker === "you") + 1;
  const speakers = mergeSpeakers(parts.slice(0, 2), [
    { ...empty, speakers: [{ name: "Ada", lines: [2, 4] }] },
    { ...empty, speakers: [{ name: "Ada", lines: [local] }, { name: "Theo", lines: [youLine, 0, 9999, local + 2] }] },
  ]);
  const ada = speakers.find((s) => s.name === "Ada")!;
  assert.deepEqual(ada.lines, [2, 4, second.start + local], "line numbers in the whole transcript, from 1");
  assert.ok(lines[ada.lines[2] - 1].speaker === "others");
  assert.deepEqual(speakers.find((s) => s.name === "Theo")?.lines, [second.start + local + 2], "You lines and lines outside the part are dropped");

  const clash = mergeSpeakers([{ start: 0, lines: lines.slice(0, 4), context: [] }, { start: 0, lines: lines.slice(0, 4), context: [] }], [
    { ...empty, speakers: [{ name: "Ada", lines: [2] }] },
    { ...empty, speakers: [{ name: "Theo", lines: [2] }] },
  ]);
  assert.deepEqual(clash, [], "a line named two ways is left unnamed");
});

test("the overall request holds only the parts' titles and summaries", () => {
  const parts = planSections(call(120)).slice(0, 2);
  const text = overallRequestText("Fundraise", parts, [
    { ...empty, title: "Budget", summary: "You set the budget." },
    { ...empty, title: "Hiring", summary: "You agreed to hire." },
  ]);
  assert.match(text, /^Project: Fundraise\n\nPart 1 of 2 of the call, 00:00 to \d\d:\d\d\.\nTitle: Budget\nSummary: You set the budget\.\n\nPart 2 of 2/);
  assert.ok(!text.includes("word word"), "no transcript");
});
