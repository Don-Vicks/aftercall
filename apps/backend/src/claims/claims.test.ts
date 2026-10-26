import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ClaimsService } from "./claims.service";

const claim = { payeeName: "Kemi", amount: "50000000", memo: "deck deposit", meeting: "Sync with Ada" };

test("a payee shares their account once; the owner sees it", () => {
  const claims = new ClaimsService();
  const { token, claim: c } = claims.create("victor.testnet", claim);
  assert.equal(claims.view(token).payeeName, "Kemi");
  assert.equal("owner" in claims.view(token) && claims.view(token).owner, "victor.testnet");
  claims.claim(token, "Kemi-Studio.testnet");
  const mine = claims.mine("victor.testnet");
  assert.equal(mine[0].id, c.id);
  assert.equal(mine[0].claimedAccount, "kemi-studio.testnet");
  assert.throws(() => claims.claim(token, "attacker.testnet"), /ALREADY_CLAIMED/);
  assert.equal(claims.mine("someone-else.testnet").length, 0, "owners only see their own claims");
});

test("links expire after 7 days and can be cancelled", () => {
  let now = 0;
  const claims = new ClaimsService(() => now);
  const a = claims.create("v.testnet", claim);
  const b = claims.create("v.testnet", claim);
  now += 7 * 86_400_000 + 1;
  assert.throws(() => claims.view(a.token), /CLAIM_EXPIRED/);
  now = 0;
  claims.cancel("v.testnet", b.claim.id);
  assert.throws(() => claims.view(b.token), /NO_SUCH_CLAIM/);
  assert.throws(() => claims.cancel("other.testnet", a.claim.id), /NO_SUCH_CLAIM/);
});

test("bad input is refused", () => {
  const claims = new ClaimsService();
  assert.throws(() => claims.create("v", { ...claim, amount: "-5" }), /BAD_CLAIM/);
  const { token } = claims.create("v", claim);
  assert.throws(() => claims.claim(token, "not an account!"), /BAD_ACCOUNT/);
  assert.throws(() => claims.view("made-up-token"), /NO_SUCH_CLAIM/);
});
