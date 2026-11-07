import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTOPILOT_HELD, agentProposalReason, autopilotDecision, DEFAULT_RULES, holdInterruptedAutopilot } from "./autopilot.ts";
import type { EmailFollowUp, Meeting, PaymentFollowUp } from "../meeting.ts";

const usdc = (n: number) => BigInt(n) * 1_000_000n;
const payment: PaymentFollowUp = {
  id: "f2", kind: "payment", status: "proposed", payeeName: "Designer", payeeAccount: "designer.testnet",
  amount: usdc(50), heard: "fifty dollar", payeeListed: true, evidence: { quote: "pay the designer the fifty dollar deposit", at: 0 },
};
const recap: EmailFollowUp = { id: "f1", kind: "email", status: "proposed", to: "tola@acme.co", toName: "Tola", subject: "Recap", evidence: { quote: "send Tola the recap after this", at: 0 } };
const limits = { leftToday: usdc(150), perPaymentCap: usdc(50) };
const on = { payments: true, recapDomains: ["acme.co"] };

test("off by default: nothing runs without a tap", () => {
  assert.equal(autopilotDecision(payment, DEFAULT_RULES, limits).run, false);
  assert.equal(autopilotDecision(recap, DEFAULT_RULES, limits).run, false);
});

test("a listed payee within both limits is paid; recaps go to your team's domain", () => {
  assert.deepEqual(autopilotDecision(payment, on, limits), { run: true, reasons: [] });
  assert.deepEqual(autopilotDecision(recap, on, limits), { run: true, reasons: [] });
  assert.equal(autopilotDecision({ ...recap, to: "ada@client.com" }, on, limits).run, false);
});

test("any failing rule leaves it for a person, and says why", () => {
  assert.deepEqual(autopilotDecision({ ...payment, amount: usdc(60) }, on, limits).reasons, ["Over your per-payment cap"]);
  assert.deepEqual(autopilotDecision(payment, on, { ...limits, leftToday: usdc(10) }).reasons, ["Over what's left today"]);
  assert.deepEqual(autopilotDecision({ ...payment, payeeListed: false }, on, limits).reasons, ["Payee isn't on your list"]);
  assert.deepEqual(autopilotDecision({ ...payment, amount: null }, on, limits).reasons, ["Amount unclear"]);
  assert.deepEqual(autopilotDecision(payment, on, { ...limits, perPaymentCap: 0n }).reasons, ["No per-payment cap set"]);
  assert.deepEqual(autopilotDecision(payment, on, null).reasons, ["Agent wallet not connected"]);
});

test("a follow-up a coding agent proposed never runs by itself, even when every rule passes", () => {
  const proposedBy = { agent: "Codex", at: "2026-11-02T10:00:00.000Z", reason: "Olamide asked for the staging DNS" };
  const { evidence: _e1, ...payNoQuote } = payment;
  const { evidence: _e2, ...recapNoQuote } = recap;
  assert.deepEqual(autopilotDecision({ ...payNoQuote, proposedBy }, on, limits), { run: false, reasons: [agentProposalReason("Codex")] });
  assert.deepEqual(autopilotDecision({ ...recapNoQuote, proposedBy }, on, limits), { run: false, reasons: ["Proposed by Codex: what an agent proposes always waits for you"] });
  // Not even with a quote attached, nor with no quote and no name.
  assert.equal(autopilotDecision({ ...payment, proposedBy }, on, limits).run, false);
  assert.equal(autopilotDecision(payNoQuote, on, limits).run, false);
  assert.equal(autopilotDecision(payment, on, limits).run, true, "the same payment from the call still runs");
});

test("a queued follow-up read from disk at launch is held for you, never run", () => {
  const meeting = (followUps: Meeting["followUps"]): Meeting => ({
    id: "m1", project: "General", title: "Call", startedAt: "2026-11-01T10:00:00Z", durationSec: 60, verified: true,
    summary: "", decisions: [], actionItems: [], followUps, transcript: [],
  });
  // Quit 20 seconds into the undo window; the next launch is long after it would have run.
  const queued = { ...payment, autopilotAt: Date.now() - 3_600_000 };
  const held = holdInterruptedAutopilot(meeting([queued, recap]))!;
  const [pay, mail] = held.followUps;
  assert.equal(pay.autopilotAt, undefined, "off the queue, so the run loop never sees it");
  assert.equal(pay.autopilotHeld, true);
  assert.equal(pay.status, "proposed", "waits for your approval");
  assert.deepEqual(autopilotDecision(pay, on, limits), { run: false, reasons: [AUTOPILOT_HELD] }, "every rule passing still doesn't run it");
  assert.equal(mail, recap, "a follow-up that wasn't queued is untouched");
  assert.equal(holdInterruptedAutopilot(meeting([payment, recap])), null, "nothing queued: nothing to save");
  assert.equal(holdInterruptedAutopilot(meeting([queued, recap]), (id) => id === queued.id), null, "queued in this run: its countdown goes on");
  assert.equal(JSON.parse(JSON.stringify({ ...pay, amount: null })).autopilotHeld, true, "the flag is plain JSON, so notes.json keeps it");
});
