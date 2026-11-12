import { test } from "node:test";
import assert from "node:assert/strict";
import { ADDED_BY_YOU_REASON, AUTOPILOT_HELD, agentProposalReason, autopilotDecision, DEFAULT_RULES, holdInterruptedAutopilot, meetingAutopilotDecision, NOT_VERIFIED_REASON } from "./autopilot.ts";
import { awaitsYou, type EmailFollowUp, type Meeting, type PaymentFollowUp } from "../meeting.ts";

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

test("nothing runs by itself from notes that aren't verified, even when every rule passes", () => {
  // A reply whose signature isn't the attested model's leaves the notes unverified.
  assert.deepEqual(meetingAutopilotDecision({ verified: false }, payment, on, limits), { run: false, reasons: [NOT_VERIFIED_REASON] });
  assert.deepEqual(meetingAutopilotDecision({ verified: false }, recap, on, limits), { run: false, reasons: [NOT_VERIFIED_REASON] });
  assert.deepEqual(meetingAutopilotDecision({ verified: true }, payment, on, limits), { run: true, reasons: [] }, "the same payment from verified notes runs");
  assert.equal(meetingAutopilotDecision({ verified: true }, payment, DEFAULT_RULES, limits).run, false, "and the rules still apply");
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

test("a payment that waits on a condition, or is held in escrow, never runs by itself", () => {
  const condition = { text: "when the icons are delivered", evidence: { quote: "once the icons are delivered on Friday", at: 0 } };
  assert.deepEqual(autopilotDecision({ ...payment, condition }, on, limits), { run: false, reasons: ["It waits on a condition: only you can say it's met"] });
  assert.deepEqual(autopilotDecision({ ...payment, conditionDropped: true }, on, limits).reasons, ["The call may have set a condition: check it yourself"]);
  const escrow = { id: "m1-f2", state: "open" as const, link: "https://x/deal#t", termsHash: "a".repeat(64), on: { network: "testnet" as const, contract: "w.testnet", account: "v.testnet" } };
  assert.deepEqual(autopilotDecision({ ...payment, escrow }, on, limits).reasons, ["Held in escrow for the payee to confirm"]);
});

test("a recap already posted to Slack no longer waits: autopilot leaves it, and it isn't counted as waiting", () => {
  const posted = { ...recap, slackPostedAt: "14:06" };
  assert.deepEqual(autopilotDecision(posted, on, limits), { run: false, reasons: ["Already posted to Slack"] });
  assert.equal(awaitsYou(posted), false);
  assert.equal(awaitsYou(recap), true);
  assert.equal(awaitsYou({ ...recap, draftedAt: "14:06" }), true, "a draft in Mail may not have gone out");
});

test("a recap you added never goes out on autopilot, even to your team's domain", () => {
  const f: EmailFollowUp = { id: "you1", kind: "email", status: "proposed", addedByYou: true, to: "ada@team.com", toName: "Ada", subject: "Recap: Sync" };
  const d = autopilotDecision(f, { payments: true, recapDomains: ["team.com"] }, null);
  assert.equal(d.run, false);
  assert.deepEqual(d.reasons, [ADDED_BY_YOU_REASON]);
});
