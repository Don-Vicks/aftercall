import { test } from "node:test";
import assert from "node:assert/strict";
import { decisionEvidence, formatClock, formatDuration, phoneDecision } from "./meeting.ts";

test("formats transcript clock times", () => {
  assert.equal(formatClock(134), "02:14");
  assert.equal(formatClock(4), "00:04");
});

test("formats meeting durations", () => {
  assert.equal(formatDuration(192), "3 min 12 s");
  assert.equal(formatDuration(42), "42 s");
});

test("a decision's quote, and none for meetings saved before quotes were kept", () => {
  const ev = { quote: "The API fix has to ship before the demo", at: 31 };
  assert.deepEqual(decisionEvidence({ decisions: ["Ship it"], decisionEvidence: [ev] }, 0), ev);
  assert.equal(decisionEvidence({ decisions: ["Ship it"] }, 0), undefined, "old notes.json has no decisionEvidence");
  assert.equal(decisionEvidence({ decisions: ["Ship it", "Hire"], decisionEvidence: [ev] }, 0), undefined, "lists that don't line up show no quote rather than a wrong one");
});

test("a follow-up decided on your phone says so, dismissed as well as approved", () => {
  assert.equal(phoneDecision({ status: "dismissed", byPhone: true }), "Dismissed on your phone");
  assert.equal(phoneDecision({ status: "sent", byPhone: true }), "Approved on your phone");
  assert.equal(phoneDecision({ status: "paid", byPhone: true }), "Approved on your phone");
  assert.equal(phoneDecision({ status: "sending", byPhone: true }), null, "approved there, but nothing has gone out yet");
  assert.equal(phoneDecision({ status: "dismissed" }), null, "dismissed on the Mac");
  assert.equal(phoneDecision({ status: "paid" }), null);
});
