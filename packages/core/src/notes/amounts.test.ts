import { test } from "node:test";
import assert from "node:assert/strict";
import { amountProblem, amountsIn, currencyIn, parseAmount } from "./amounts.ts";

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
    ["forty US dollars", 40],
    ["“forty dollars.”", 40],
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
    ["$ 40", 40],
  ];
  for (const [heard, value] of cases) assert.equal(parseAmount(heard), usdc(value), heard);
});

test("cents are hundredths of a dollar, never whole dollars", () => {
  const cases: [string, number][] = [
    ["fifty cents", 0.5],
    ["50 cents", 0.5],
    ["one cent", 0.01],
    ["five dollars and fifty cents", 5.5],
    ["five dollars fifty cents", 5.5],
    ["$5 and 50 cents", 5.5],
    ["twenty dollars and five cents", 20.05],
    ["150 cents", 1.5],
  ];
  for (const [heard, value] of cases) assert.equal(parseAmount(heard), usdc(value), heard);
  assert.notEqual(parseAmount("fifty cents"), usdc(50), "the old bug: cents were dropped and fifty read as 50.00");
});

test("cents that don't read as one amount are refused", () => {
  for (const heard of ["five dollars and a hundred cents", "fifty cents and five dollars", "$5.50 and 20 cents", "a few cents", "5.5 cents", "cents"]) {
    assert.equal(parseAmount(heard), null, heard);
    assert.deepEqual(amountProblem(heard), { kind: "unclear" }, heard);
  }
});

test("any other currency is refused, never read as USDC", () => {
  const cases: [string, string][] = [
    ["fifty thousand naira", "naira"],
    ["₦50,000", "naira"],
    ["50,000 NGN", "naira"],
    ["fifty euros", "euros"],
    ["€50", "euros"],
    ["40 EUR", "euros"],
    ["twenty pounds", "pounds"],
    ["£20", "pounds"],
    ["20 GBP", "pounds"],
    ["five thousand yen", "yen"],
    ["¥5000", "yen"],
    ["a thousand rupees", "rupees"],
    ["₹1000", "rupees"],
    ["500 INR", "rupees"],
    ["two hundred cedis", "cedis"],
    ["ten thousand shillings", "shillings"],
    ["five hundred rand", "rand"],
    ["a thousand pesos", "pesos"],
    ["fifty yuan", "yuan"],
    ["300 RMB", "yuan"],
    ["fifty thousand won", "won"],
    ["a hundred dirhams", "dirhams"],
    ["fifty riyals", "riyals"],
    ["twenty francs", "francs"],
    ["half a bitcoin", "bitcoin"],
    ["0.1 BTC", "bitcoin"],
    ["two ETH", "ether"],
    ["one ether", "ether"],
    ["fifty SOL", "SOL"],
    ["a hundred near", "NEAR"],
    ["100 NEAR", "NEAR"],
    ["fifty Canadian dollars", "Canadian dollars"],
    ["50 USDT", "USDT"],
  ];
  for (const [heard, currency] of cases) {
    assert.equal(parseAmount(heard), null, heard);
    assert.deepEqual(amountProblem(heard), { kind: "not-usdc", currency }, heard);
  }
  assert.notEqual(parseAmount("fifty thousand naira"), usdc(50_000), "the old bug: naira was dropped and read as 50,000.00 USDC");
});

test("currency words that are ordinary words only count after a number", () => {
  assert.equal(currencyIn("we won the pitch"), null);
  assert.equal(currencyIn("near the end of the month"), null);
  assert.equal(currencyIn("fifty USDC on NEAR"), null, "USDC paid on NEAR is still USDC");
  assert.equal(parseAmount("fifty USDC"), usdc(50));
  assert.equal(currencyIn("sol"), null);
});

test("refuses anything it can't read with confidence", () => {
  for (const heard of ["twelve fifty", "some money", "", "the deposit", "fifty or sixty", "-50", "0", "40 50", "fifty percent", "50%", "twelve dollars and fifty"]) {
    assert.equal(parseAmount(heard), null, heard);
  }
  assert.deepEqual(amountProblem("twelve fifty"), { kind: "unclear" });
  assert.equal(amountProblem("fifty dollars"), null, "no problem when the words read as an amount");
});

test("amountsIn finds digits and words in a quote, as values", () => {
  const cases: [string, number[]][] = [
    ["pay the designer $40 today", [40]],
    ["pay the designer forty dollars today", [40]],
    ["send them 5,000 USDC when the deck is done.", [5_000]],
    ["it's 1.5k for the logo", [1_500]],
    ["two hundred and fifty for the site", [250]],
    ["The deposit is $5,000.", [5_000]],
    ["fifty cents a page", [0.5]],
    ["five dollars and fifty cents each", [5.5]],
    ["twenty-five USDC", [25]],
    ["a hundred now and two hundred later", [100, 200]],
    ["pay fifty a month", [50]],
    ["no money mentioned here", []],
    ["at 14:02 we agreed", []],
  ];
  for (const [quote, values] of cases) assert.deepEqual(amountsIn(quote), values.map(usdc), quote);
});

test("amountsIn takes the longest span, so parts of a number are never amounts of their own", () => {
  const quote = "pay Ines two hundred and fifty for the logo";
  assert.deepEqual(amountsIn(quote), [usdc(250)]);
  assert.ok(!amountsIn(quote).includes(usdc(200)), "200 is only part of 250");
  assert.ok(!amountsIn(quote).includes(usdc(50)), "50 is only part of 250");
  assert.deepEqual(amountsIn("one thousand two hundred dollars"), [usdc(1_200)]);
  assert.deepEqual(amountsIn("forty 50"), [usdc(40), usdc(50)], "two numbers side by side are two amounts, not 4,050");
  assert.deepEqual(amountsIn("twelve fifty"), [], "ambiguous as one amount, so no part of it is one either");
  assert.deepEqual(amountsIn("Pay Ada one fifty for the logo work."), [], "one fifty is never fifty");
});

test("amountsIn stops at commas and full stops, so two amounts never join into one", () => {
  assert.deepEqual(amountsIn("Ada gets fifty. Two hundred goes to Ben."), [usdc(50), usdc(200)]);
  assert.deepEqual(amountsIn("Pay Ada forty, fifty dollars"), [usdc(40), usdc(50)]);
  assert.deepEqual(amountsIn("Pay Ada twenty, three to Ben"), [usdc(20), usdc(3)]);
  assert.deepEqual(amountsIn("send the $5,000 deposit"), [usdc(5_000)], "a comma inside a number isn't a stop");
  assert.deepEqual(amountsIn("It's $40."), [usdc(40)]);
});

test("amountsIn skips values in another currency or given as a percentage", () => {
  assert.deepEqual(amountsIn("Send Ada 2,500 euros for the design work."), []);
  assert.deepEqual(amountsIn("Send 500 naira"), []);
  assert.deepEqual(amountsIn("Send €2,500 to Ada"), []);
  assert.deepEqual(amountsIn("Ada gets the 50 percent deposit on 4,000 dollars."), [usdc(4_000)]);
  assert.deepEqual(amountsIn("Ada gets 50% of 4,000 dollars"), [usdc(4_000)]);
  assert.deepEqual(amountsIn("fifty per cent up front"), []);
  assert.deepEqual(amountsIn("Pay Ada $500, not 500 naira"), [usdc(500)]);
});

test("two numbers in a row are two numbers: tens after tens, hundred after hundred", () => {
  assert.equal(parseAmount("forty fifty"), null);
  assert.equal(parseAmount("two hundred three hundred"), null);
  assert.equal(parseAmount("two hundred and fifty"), usdc(250), "still one amount");
  assert.equal(parseAmount("twenty three hundred"), usdc(2_300));
  assert.equal(parseAmount("one thousand fifty"), usdc(1_050));
});
