import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUsdc } from "./money.ts";

test("formats base units with thousands separators and two decimals", () => {
  assert.equal(formatUsdc(5_000_000_000n), "5,000.00");
  assert.equal(formatUsdc(50_000_000n), "50.00");
  assert.equal(formatUsdc(1_234_567n), "1.23");
  assert.equal(formatUsdc(0n), "0.00");
});
