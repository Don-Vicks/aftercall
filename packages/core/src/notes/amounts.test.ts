import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmount } from "./amounts.ts";

const usdc = (n: number) => BigInt(Math.round(n * 100)) * 10_000n;

test("words people say about money", () => {
  const cases: [string, number][] = [
    ["fifty dollar", 50],
    ["fifty dollars", 50],
    ["the fifty dollar deposit", 50],
    ["five thousand", 5_000],
    ["the full five thousand", 5_000],
    ["two hundred and fifty bucks", 250],
    ["a hundred", 100],
    ["one thousand two hundred", 1_200],
    ["fifty five dollars", 55],
    ["twenty-five USDC", 25],
    ["5 thousand", 5_000],
    ["two grand", 2_000],
  ];
  for (const [heard, value] of cases) assert.equal(parseAmount(heard), usdc(value), heard);
});

test("digits, symbols and suffixes", () => {
  const cases: [string, number][] = [
    ["$50", 50],
    ["$5,000", 5_000],
    ["5,000 USDC", 5_000],
    ["49.99", 49.99],
    ["1.5k", 1_500],
    ["250", 250],
  ];
  for (const [heard, value] of cases) assert.equal(parseAmount(heard), usdc(value), heard);
});

test("refuses anything it can't read with confidence", () => {
  for (const heard of ["twelve fifty", "some money", "", "the deposit", "fifty or sixty", "-50", "0"]) {
    assert.equal(parseAmount(heard), null, heard);
  }
});
