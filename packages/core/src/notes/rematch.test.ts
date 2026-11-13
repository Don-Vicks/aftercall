import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMeeting } from "./build.ts";
import { rematchPayees } from "./rematch.ts";
import { matchPayee, payeeLabel } from "./build.ts";
import { notesSchema } from "./schema.ts";
import type { FollowUp, Meeting, PaymentFollowUp, TranscriptLine } from "../meeting.ts";

const transcript: TranscriptLine[] = [{ at: 134, speaker: "you", text: "Send Ada the recap, and pay the designer the fifty dollar deposit today." }];

const notes = notesSchema.parse({
  title: "Sync with Ada",
  summary: "A 50 USDC deposit goes to the designer.",
  decisions: [],
  action_items: [],
  followups: [
    { type: "email", to_name: "Ada", subject: "Recap", evidence: "Send Ada the recap" },
    { type: "payment", payee_name: "Designer", amount_words: "fifty dollar", memo: "deposit", evidence: "pay the designer the fifty dollar deposit today" },
  ],
});

const designer = { name: "Designer", account: "designer.testnet" };

/** A meeting whose payment was heard before any payee was on the list. */
const heardFirst = (): Meeting =>
  buildMeeting({ id: "m1", project: "Fundraise", startedAt: "2026-11-02T10:00:00Z", durationSec: 192, transcript, notes, payees: [], verified: true }).meeting;

const payment = (m: Meeting) => m.followUps.find((f): f is PaymentFollowUp => f.kind === "payment")!;

const withPayment = (m: Meeting, patch: Partial<PaymentFollowUp>): Meeting => ({
  ...m,
  followUps: m.followUps.map((f): FollowUp => (f.kind === "payment" ? { ...f, ...patch } : f)),
});

test("a payment heard before its payee was added is on the list once the payee is", () => {
  const before = heardFirst();
  assert.equal(payment(before).payeeListed, false);
  const after = rematchPayees(before, [designer]);
  assert.equal(payment(after).payeeListed, true);
  assert.equal(payment(after).payeeAccount, "designer.testnet");
  assert.equal(payment(after).payeeName, "Designer");
  // Everything else stays as the model and the transcript gave it.
  assert.equal(payment(after).amount, 50_000_000n);
  assert.equal(payment(after).heard, "fifty dollar");
  assert.deepEqual(after.followUps[0], before.followUps[0]);
});

test("the same rule as building the notes: label or account, any case", () => {
  assert.equal(payment(rematchPayees(heardFirst(), [{ name: "designer", account: "d.testnet" }])).payeeListed, true);
  const byAccount = withPayment(heardFirst(), { payeeName: "designer.testnet" });
  assert.equal(payment(rematchPayees(byAccount, [designer])).payeeName, "Designer");
  assert.equal(payment(rematchPayees(heardFirst(), [{ name: "Ada", account: "ada.testnet" }])).payeeListed, false);
});

test("a renamed payee still matches by the account it already has", () => {
  const listed = rematchPayees(heardFirst(), [designer]);
  const renamed = rematchPayees(listed, [{ name: "Ines (design)", account: "designer.testnet" }]);
  assert.equal(payment(renamed).payeeListed, true);
  assert.equal(payment(renamed).payeeName, "Ines (design)");
});

test("a payment whose payee was removed is no longer on the list", () => {
  const listed = rematchPayees(heardFirst(), [designer]);
  const removed = rematchPayees(listed, []);
  assert.equal(payment(removed).payeeListed, false);
  assert.equal(payment(removed).payeeAccount, "");
  assert.equal(payment(removed).payeeName, "Designer");
});

test("returns the same meeting when nothing changed, so callers can skip the save", () => {
  const m = heardFirst();
  assert.equal(rematchPayees(m, []), m);
  const listed = rematchPayees(m, [designer]);
  assert.equal(rematchPayees(listed, [designer]), listed);
});

test("only proposed payments change: sending, paid, blocked, failed and dismissed keep what they had", () => {
  for (const status of ["sending", "paid", "blocked", "failed", "dismissed"] as const) {
    const m = withPayment(heardFirst(), { status });
    assert.equal(rematchPayees(m, [designer]), m, status);
  }
});

test("a payment autopilot has queued keeps what it had", () => {
  const m = withPayment(rematchPayees(heardFirst(), [designer]), { autopilotAt: Date.now() + 10_000 });
  assert.equal(rematchPayees(m, []), m);
});

test("a name given back as the model saw it, \"Label (account)\", still means that payee", () => {
  const kemi = { name: "Kemi", account: "kemi-ac.testnet" };
  const relabelled = { name: "Kemi (kemi-ac.testnet)", account: "kemi-ac.testnet" };
  assert.equal(matchPayee([kemi], "Kemi (kemi-ac.testnet)"), kemi, "the account in brackets decides");
  assert.equal(matchPayee([kemi], "kemi (KEMI-AC.TESTNET)"), kemi);
  assert.equal(matchPayee([relabelled], "Kemi"), relabelled, "a label saved as \"Kemi (kemi-ac.testnet)\" answers to \"Kemi\"");
  assert.equal(matchPayee([relabelled], "Kemi (kemi-ac.testnet)"), relabelled);
  assert.equal(matchPayee([kemi], "Kemi (other.testnet)"), kemi, "an unknown account falls back to the label");
  assert.equal(matchPayee([kemi], "Ada (ada.testnet)"), undefined);
  // Both halves must point at the same payee: a stranger's name on a listed account is no one.
  assert.equal(matchPayee([kemi], "Mallory (kemi-ac.testnet)"), undefined, "another name on Kemi's account isn't Kemi");
  const ada = { name: "Ada", account: "ada.testnet" };
  assert.equal(matchPayee([kemi, ada], "Ada (kemi-ac.testnet)"), undefined, "a label and an account of two different payees match neither");
  assert.equal(matchPayee([kemi], "Kemi Adeyemi (kemi-ac.testnet)"), kemi, "a longer form of the label still matches");
  assert.equal(payeeLabel("Kemi (kemi-ac.testnet)"), "Kemi");
  assert.equal(payeeLabel(" Kemi "), "Kemi");
});

test("the quote check follows the payee: named once listed, and a payee the quote doesn't name isn't", () => {
  const before = heardFirst();
  assert.equal(payment(before).quoteCheck?.namesPayee, false, "no payee on the list yet");
  assert.equal(payment(rematchPayees(before, [designer])).quoteCheck?.namesPayee, true, "the quote says “the designer”");
  // Listed under a label the quote never says: autopilot leaves it to you.
  const studio = { name: "Studio Nine", account: "designer.testnet" };
  const relisted = rematchPayees(rematchPayees(before, [designer]), [studio]);
  assert.equal(payment(relisted).payeeName, "Studio Nine");
  assert.equal(payment(relisted).quoteCheck?.namesPayee, false);
  // Who said it, and how the amount was said, don't change.
  assert.deepEqual({ ...payment(relisted).quoteCheck, namesPayee: true }, { ...payment(before).quoteCheck, namesPayee: true });
});
