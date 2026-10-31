import { test } from "node:test";
import assert from "node:assert/strict";
import { claimLink, parseClaimFragment } from "./claimLink.ts";

test("a claim link carries the name, memo and meeting in the fragment only", () => {
  const link = claimLink("https://aftercall.app/claim", "tok_AbC-123", { payeeName: "Kemi & Co", memo: "Deck deposit #2", meeting: "Sync with Ada" });
  const url = new URL(link);
  assert.equal(url.pathname, "/claim");
  assert.equal(url.search, "", "nothing in the query string, which servers see");
  assert.deepEqual(parseClaimFragment(url.hash), { token: "tok_AbC-123", payeeName: "Kemi & Co", memo: "Deck deposit #2", meeting: "Sync with Ada" });
});

test("details are optional, trimmed and capped; old bare-token links still work", () => {
  assert.deepEqual(parseClaimFragment(new URL(claimLink("https://x/claim", "t1")).hash), { token: "t1" });
  assert.equal(parseClaimFragment(claimLink("https://x/claim", "t1", { memo: "x".repeat(500) }).split("#")[1]).memo?.length, 200);
  assert.deepEqual(parseClaimFragment("#legacyToken_123"), { token: "legacyToken_123" });
  assert.deepEqual(parseClaimFragment(""), { token: "" });
});
