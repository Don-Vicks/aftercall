import { test } from "node:test";
import assert from "node:assert/strict";
import { autopilotDecision, DEFAULT_RULES } from "./autopilot.ts";
import type { EmailFollowUp, PaymentFollowUp } from "../meeting.ts";

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
  assert.deepEqual(autopilotDecision({ ...payment, amount: usdc(60) }, on, limits).reasons, ["Over your per-payment limit"]);
  assert.deepEqual(autopilotDecision(payment, on, { ...limits, leftToday: usdc(10) }).reasons, ["Over what's left today"]);
  assert.deepEqual(autopilotDecision({ ...payment, payeeListed: false }, on, limits).reasons, ["Payee isn't on your list"]);
  assert.deepEqual(autopilotDecision({ ...payment, amount: null }, on, limits).reasons, ["Amount unclear"]);
  assert.deepEqual(autopilotDecision(payment, on, { ...limits, perPaymentCap: 0n }).reasons, ["No per-payment limit set"]);
  assert.deepEqual(autopilotDecision(payment, on, null).reasons, ["Agent wallet not connected"]);
});
