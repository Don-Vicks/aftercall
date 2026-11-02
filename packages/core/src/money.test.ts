import { test } from "node:test";
import assert from "node:assert/strict";
import { formatNear, formatUsdc } from "./money.ts";

test("formats base units with thousands separators and two decimals", () => {
  assert.equal(formatUsdc(5_000_000_000n), "5,000.00");
  assert.equal(formatUsdc(50_000_000n), "50.00");
  assert.equal(formatUsdc(1_234_567n), "1.23");
  assert.equal(formatUsdc(0n), "0.00");
});

test("yoctoNEAR reads as NEAR, short and without trailing zeros", () => {
  assert.equal(formatNear(10n ** 25n), "10");
  assert.equal(formatNear(10n ** 28n), "10,000");
  assert.equal(formatNear(35n * 10n ** 22n), "0.35");
  assert.equal(formatNear(542_800_000_000_000_000_000n), "0.00054");
  assert.equal(formatNear(0n), "0");
  assert.equal(formatNear(1n), "< 0.00001");
  assert.equal(formatNear(123_456_789n * 10n ** 16n, 2), "1.23");
});
