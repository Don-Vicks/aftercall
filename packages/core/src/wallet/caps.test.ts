import { test } from "node:test";
import assert from "node:assert/strict";
import { capsCrossed, crossChainCapRefusal } from "./caps.ts";

const usdc = (n: number) => BigInt(n) * 1_000_000n;

test("caps crossed follow the contract: a per-payment cap of 0 is none, the daily cap counts what's left", () => {
  const limits = { leftToday: usdc(150), perPaymentCap: usdc(100) };
  assert.deepEqual(capsCrossed(usdc(50), limits), { perPayment: false, today: false });
  assert.deepEqual(capsCrossed(usdc(100), limits), { perPayment: false, today: false });
  assert.deepEqual(capsCrossed(usdc(120), limits), { perPayment: true, today: false });
  assert.deepEqual(capsCrossed(usdc(5000), limits), { perPayment: true, today: true });
  assert.deepEqual(capsCrossed(usdc(5000), { ...limits, perPaymentCap: 0n }), { perPayment: false, today: true });
});

test("a refused payment on another chain says which cap to raise", () => {
  const perPaymentOnly = crossChainCapRefusal(usdc(120), "OVER_PAYMENT_CAP", usdc(150), usdc(200));
  assert.match(perPaymentOnly, /^Over your per-payment cap, so nothing was sent\./);
  assert.doesNotMatch(perPaymentOnly, /today|tomorrow|midnight/);

  // The contract names only OVER_PAYMENT_CAP when both caps are crossed; the daily cap needs room too.
  const both = crossChainCapRefusal(usdc(300), "OVER_PAYMENT_CAP", usdc(150), usdc(200));
  assert.match(both, /^Over your per-payment cap and what's left of today's cap \(150\.00 USDC\)/);
  assert.match(both, /raise both caps/);
});

test("waiting for the next day is offered only when the amount fits the daily cap at all", () => {
  // Fits the daily cap: tomorrow (the contract's UTC day) works.
  assert.match(crossChainCapRefusal(usdc(180), "OVER_CAP", usdc(150), usdc(200)), /Over what's left of today's cap \(150\.00 USDC\).*or try again after midnight UTC/);
  // Bigger than the daily cap itself: no day ever lets it through, so only raising the cap is offered.
  const never = crossChainCapRefusal(usdc(300), "OVER_CAP", usdc(150), usdc(200));
  assert.match(never, /^Over your daily cap of 200\.00 USDC, so nothing was sent\./);
  assert.doesNotMatch(never, /midnight|tomorrow/);
  // The wallet couldn't be read: no promise about tomorrow.
  assert.doesNotMatch(crossChainCapRefusal(usdc(180), "OVER_CAP", usdc(150), null), /midnight|tomorrow/);
});
