import { test } from "node:test";
import assert from "node:assert/strict";
import { agentWallet } from "./wallet.ts";

const now = Date.parse("2026-11-07T12:00:00Z");
const today = Math.floor(now / 86_400_000);
const payees = [{ name: "Designer", account: "designer.testnet" }];
const wallet = { per_payment_cap: "50000000", daily_cap: "100000000", spent_today: "70000000", day: today };

test("agents get the payees and caps just read, with what's left of today's cap", () => {
  assert.deepEqual(agentWallet(wallet, payees, now), { payees, perPaymentCap: "50000000", leftToday: "30000000" });
  assert.equal(agentWallet({ ...wallet, day: today - 1 }, payees, now)?.leftToday, "100000000", "a new UTC day starts from nothing spent");
  assert.equal(agentWallet({ ...wallet, spent_today: "120000000" }, payees, now)?.leftToday, "0", "never below nothing");
});

test("no wallet, no snapshot: the app clears the one agents had", () => {
  assert.equal(agentWallet(null, payees, now), null);
});
