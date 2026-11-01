import { test } from "node:test";
import assert from "node:assert/strict";
import { applyItemEdit, changedFields, cleanItemFields, editsLine, itemEdits, originalItem, restoreItem, signedIndex, type ItemFields } from "./edits.ts";
import { buildMeeting } from "./build.ts";
import { notesSchema, type Notes } from "./schema.ts";
import { sha256Hex } from "./verify.ts";
import { buildRecap } from "../followups/recap.ts";
import { autopilotDecision, DEFAULT_RULES } from "../followups/autopilot.ts";
import { search } from "../search/search.ts";
import { buildPeople } from "../people-index.ts";
import type { EmailFollowUp, Meeting, TranscriptLine } from "../meeting.ts";

const transcript: TranscriptLine[] = [
  { at: 10, speaker: "you", text: "I'll send Ada the recap after this call." },
  { at: 20, speaker: "others", text: "Theo will book the venue by Friday." },
  { at: 30, speaker: "you", text: "Someone should look at the pricing page." },
  { at: 40, speaker: "you", text: "And pay the designer the fifty dollar deposit today." },
];

const notes: Notes = notesSchema.parse({
  title: "Sync",
  summary: "Recap, venue, pricing page.",
  decisions: [],
  action_items: [
    { text: "Send Ada the recap", owner: "You", due: "today", evidence: "send Ada the recap after this call" },
    { text: "Book the launch venue", owner: "Theo", due: "by Friday", evidence: "will book the venue" },
    { text: "Ask about the hotel", owner: "You", due: null, evidence: "not in the transcript at all" },
    { text: "Look at the pricing page", owner: null, due: null, evidence: "look at the pricing page" },
  ],
  followups: [{ type: "payment", payee_name: "Designer", amount_words: "fifty dollar", memo: null, evidence: "pay the designer the fifty dollar deposit today" }],
});

const enc = new TextEncoder();
const hashOf = (n: Notes) => sha256Hex(enc.encode(JSON.stringify(n)));

function meeting(): Meeting {
  return buildMeeting({ id: "1793006441", project: "Launch", startedAt: "2026-10-26T09:20:41.000Z", durationSec: 60, notes, transcript, payees: [{ name: "Designer", account: "designer.near" }], verified: true })
    .meeting;
}

/** Edits one item the way the app does: the signed original from notes, then the cleaned draft. */
function edit(m: Meeting, id: string, draft: { text: string; owner: string; due?: string }, at = "2026-10-26T10:00:00.000Z"): Meeting {
  const original = originalItem(notes, id)!;
  const cleaned = cleanItemFields(draft);
  if ("error" in cleaned) throw new Error(cleaned.error);
  return { ...m, actionItems: m.actionItems.map((a) => (a.id === id ? applyItemEdit(a, original, cleaned.fields, at) : a)) };
}

test("item ids point at the signed item, even when one before it was dropped", () => {
  const m = meeting();
  assert.deepEqual(
    m.actionItems.map((a) => a.id),
    ["a1", "a2", "a4"],
  );
  assert.equal(signedIndex("a4"), 3);
  assert.equal(signedIndex("f1"), -1);
  assert.equal(signedIndex("a0"), -1);
  assert.deepEqual(originalItem(notes, "a4"), { text: "Look at the pricing page", owner: "Unassigned" });
  assert.deepEqual(originalItem(notes, "a2"), { text: "Book the launch venue", owner: "Theo", due: "by Friday" });
  assert.equal(originalItem(notes, "a9"), null);
  assert.equal(originalItem(undefined, "a1"), null);
});

test("cleanItemFields trims, reads an empty owner as Unassigned and an empty date as none, and refuses what can't be saved", () => {
  assert.deepEqual(cleanItemFields({ text: "  Send the deck ", owner: " ", due: "  " }), { fields: { text: "Send the deck", owner: "Unassigned" } });
  assert.deepEqual(cleanItemFields({ text: "Send", owner: "Ada", due: "13 Nov" }), { fields: { text: "Send", owner: "Ada", due: "13 Nov" } });
  assert.deepEqual(cleanItemFields({ text: "   ", owner: "Ada" }), { error: "Write what needs doing" });
  assert.match((cleanItemFields({ text: "x".repeat(301), owner: "Ada" }) as { error: string }).error, /300 characters/);
  assert.match((cleanItemFields({ text: "x", owner: "Ada", due: "y".repeat(61) }) as { error: string }).error, /due date under 60/);
  // Characters, not UTF-16 units: 300 emoji-free CJK letters fit.
  assert.ok("fields" in cleanItemFields({ text: "資".repeat(300), owner: "Ada" }));
});

test("an edit changes the meeting's item and records which fields differ from the signed one", () => {
  const m = edit(meeting(), "a1", { text: "Send Ada the recap and the deck", owner: "You", due: "tomorrow" });
  const a1 = m.actionItems[0];
  assert.equal(a1.text, "Send Ada the recap and the deck");
  assert.equal(a1.due, "tomorrow");
  assert.deepEqual(a1.edited, { at: "2026-10-26T10:00:00.000Z", fields: ["text", "due"] });
  assert.equal(a1.done, false);

  // Clearing the due date removes it; owner change only.
  const m2 = edit(m, "a2", { text: "Book the launch venue", owner: "Ines", due: "" });
  assert.equal(m2.actionItems[1].owner, "Ines");
  assert.equal("due" in m2.actionItems[1], false);
  assert.deepEqual(m2.actionItems[1].edited?.fields, ["owner", "due"]);

  assert.deepEqual(changedFields({ text: "a", owner: "b" }, { text: "a", owner: "b", due: undefined }), []);
});

test("an edit back to the original clears the mark, and Restore original brings back the signed item but keeps ticks and agents", () => {
  let m = edit(meeting(), "a1", { text: "Changed", owner: "You", due: "today" });
  m = edit(m, "a1", { text: "Send Ada the recap", owner: "You", due: "today" });
  assert.equal(m.actionItems[0].edited, undefined);

  m = edit(m, "a2", { text: "Book a bigger venue", owner: "Theo", due: "next week" });
  const claimed = { ...m.actionItems[1], done: true, claimed: { agent: "Codex", at: "t1" }, completed: { agent: "Codex", at: "t2" } };
  const restored = restoreItem(claimed, originalItem(notes, "a2")!);
  assert.deepEqual(restored, {
    id: "a2",
    text: "Book the launch venue",
    owner: "Theo",
    due: "by Friday",
    done: true,
    claimed: { agent: "Codex", at: "t1" },
    completed: { agent: "Codex", at: "t2" },
  });
});

test("saving an item unchanged is no edit, even when the model gave an empty owner or spaces around the text", () => {
  const loose: Notes = { ...notes, action_items: [{ text: "  Send Ada the recap ", owner: "", due: " today ", evidence: "send Ada the recap after this call" }] };
  const m = buildMeeting({ id: "1793006441", project: "Launch", startedAt: "2026-10-26T09:20:41.000Z", durationSec: 60, notes: loose, transcript, payees: [], verified: true }).meeting;
  const item = m.actionItems[0];
  assert.equal(item.owner, "Unassigned");
  assert.deepEqual(originalItem(loose, "a1"), { text: "Send Ada the recap", owner: "Unassigned", due: "today" });
  assert.deepEqual(itemEdits(m, loose), [], "the meeting as built is not edited");
  // The editor starts from the item as shown ("Unassigned" reads as an empty owner box).
  const saved = cleanItemFields({ text: item.text, owner: "", due: item.due });
  assert.ok("fields" in saved);
  const after = applyItemEdit(item, originalItem(loose, "a1")!, saved.fields, "t");
  assert.equal(after.edited, undefined);
  assert.deepEqual(changedFields({ text: "x", owner: "" }, { text: " x ", owner: "Unassigned" }), []);
});

test("itemEdits compares the meeting with the signed notes; the signed notes and their hash never change", () => {
  const before = hashOf(notes);
  const signed = structuredClone(notes);
  let m = meeting();
  assert.deepEqual(itemEdits(m, notes), []);
  assert.equal(editsLine(itemEdits(m, notes)), "None");

  m = edit(m, "a1", { text: "Send Ada the recap and the deck", owner: "You", due: "today" });
  m = edit(m, "a4", { text: "Look at the pricing page", owner: "Ines", due: "Friday" });
  const edits = itemEdits(m, notes);
  assert.deepEqual(
    edits.map((e) => [e.id, e.text, e.fields]),
    [
      ["a1", "Send Ada the recap and the deck", ["text"]],
      ["a4", "Look at the pricing page", ["owner", "due"]],
    ],
  );
  assert.equal(edits[0].original.text, "Send Ada the recap");
  assert.equal(editsLine(edits), "2 action items (text, owner, due date)");
  assert.equal(editsLine(edits.slice(1)), "1 action item (owner, due date)");

  // An edit whose `edited` mark went missing still shows: the comparison is on content.
  const unmarked = { ...m, actionItems: m.actionItems.map(({ edited: _e, ...a }) => a) };
  assert.equal(itemEdits(unmarked, notes).length, 2);

  assert.deepEqual(notes, signed);
  assert.equal(hashOf(notes), before);
});

test("everything that reads action items gets the edited version; no edit makes anything payable", () => {
  const plain = meeting();
  const m = edit(plain, "a2", { text: "Book the riverside venue", owner: "Ines Rocha", due: "13 Nov" });

  const recap = buildRecap(m, { id: "f9", kind: "email", status: "proposed", to: "ada@example.com", toName: "Ada", subject: "Recap", evidence: { quote: "x", at: 0 } } satisfies EmailFollowUp, {
    facts: { verified: true, e2ee: true, handlingUrl: "https://example.com/handling" },
  });
  assert.match(recap.text, /- Book the riverside venue · Ines Rocha · 13 Nov/);
  assert.doesNotMatch(recap.text, /launch venue/);

  assert.equal(search([m], "riverside").actions.length, 1);
  assert.equal(search([m], "launch venue").actions.length, 0);

  const people = buildPeople([m], { me: ["You"], now: Date.UTC(2026, 10, 1) });
  const ines = people.people.find((p) => p.name === "Ines Rocha");
  assert.ok(ines?.theyOwe.some((i) => i.itemId === "a2"));
  assert.ok(!people.people.find((p) => p.name === "Theo")?.theyOwe.length);

  // Payments are follow-ups, decided on their own quote and amount; action items never pay.
  assert.deepEqual(m.followUps, plain.followUps);
  const limits = { leftToday: 100_000_000n, perPaymentCap: 100_000_000n };
  const rules = { ...DEFAULT_RULES, payments: true };
  assert.deepEqual(
    m.followUps.map((f) => autopilotDecision(f, rules, limits)),
    plain.followUps.map((f) => autopilotDecision(f, rules, limits)),
  );
  assert.ok(m.actionItems.every((a) => !("amount" in a)));
});
