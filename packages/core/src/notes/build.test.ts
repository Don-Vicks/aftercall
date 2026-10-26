import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMeeting } from "./build.ts";
import { notesSchema, type Notes } from "./schema.ts";
import type { TranscriptLine } from "../meeting.ts";

const transcript: TranscriptLine[] = [
  { at: 31, speaker: "others", text: "The API fix has to ship before the demo." },
  { at: 134, speaker: "you", text: "Send Ada the recap after this call, and pay the designer the fifty dollar deposit today." },
];

const notes: Notes = notesSchema.parse({
  title: "Sync with Ada",
  summary: "The API fix ships before the demo. A 50 USDC deposit goes to the designer.",
  decisions: [
    { text: "Ship the API fix before the demo.", evidence: "The API fix has to ship before the demo" },
    { text: "Hire a second designer.", evidence: "we should hire a second designer" },
  ],
  action_items: [{ text: "Send Ada the recap", owner: "Victor", due: "today", evidence: "Send Ada the recap after this call" }],
  followups: [
    { type: "email", to_name: "Ada", subject: "Recap: API fix before the demo", evidence: "Send Ada the recap after this call" },
    { type: "payment", payee_name: "Designer", amount_words: "fifty dollar", memo: "deposit", evidence: "pay the designer the fifty dollar deposit today" },
    { type: "payment", payee_name: "Designer", amount_words: "five thousand", memo: null, evidence: "and the full five thousand when the deck is done" },
  ],
});

const base = { id: "m1", project: "Fundraise", startedAt: "Today 14:02", durationSec: 192, transcript, verified: true };

test("keeps what the transcript backs up and drops what it doesn't", () => {
  const { meeting, dropped } = buildMeeting({ ...base, notes, payees: [{ name: "Designer", account: "designer.near" }] });
  assert.deepEqual(meeting.decisions, ["Ship the API fix before the demo."]);
  assert.equal(meeting.actionItems.length, 1);
  assert.equal(meeting.followUps.length, 2);
  assert.deepEqual(
    dropped.map((d) => [d.kind, d.text]),
    [
      ["decision", "Hire a second designer."],
      ["follow-up", "Pay Designer five thousand"],
    ],
  );
});

test("payments carry the heard words, the parsed amount and the listed payee", () => {
  const { meeting } = buildMeeting({ ...base, notes, payees: [{ name: "Designer", account: "designer.near" }] });
  const pay = meeting.followUps.find((f) => f.kind === "payment");
  assert.ok(pay && pay.kind === "payment");
  assert.equal(pay.heard, "fifty dollar");
  assert.equal(pay.amount, 50_000_000n);
  assert.equal(pay.payeeAccount, "designer.near");
  assert.equal(pay.payeeListed, true);
  assert.deepEqual(pay.evidence, { quote: "pay the designer the fifty dollar deposit today", at: 134 });
});

test("an unlisted payee is shown but marked, and can't be paid", () => {
  const { meeting } = buildMeeting({ ...base, notes, payees: [] });
  const pay = meeting.followUps.find((f) => f.kind === "payment");
  assert.ok(pay && pay.kind === "payment");
  assert.equal(pay.payeeListed, false);
  assert.equal(pay.payeeAccount, "");
});

test("the model's reply is checked against the schema", () => {
  assert.throws(() => notesSchema.parse({ title: "x", summary: "y", decisions: [], action_items: [], followups: [{ type: "transfer" }] }));
});
