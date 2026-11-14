import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeVerifyLink } from "./disclosure.ts";
import { proofHash, verifyProof, type Check } from "./proof.ts";
import { provenClaims, tamperedLink } from "./verifyStory.ts";

// The 8 Nov sample call's public proof link (docs/proof-sample.txt), with NEAR's record stood in for.
const sample = readFileSync(new URL("../../../../docs/proof-sample.txt", import.meta.url), "utf8").trim();
const link = decodeVerifyLink(sample.slice(sample.indexOf("#")));
const onChain = { proof_hash: proofHash(link.proof.bundle), model: link.proof.bundle.summaryModel, recorded_at: "1794169374000000000" };
const byId = (checks: Check[], id: Check["id"]) => checks.find((c) => c.id === id);

test("what /verify says the proof establishes holds only on the checks behind each statement", () => {
  const checks = verifyProof(link.proof.bundle, onChain);
  const claims = provenClaims(link, checks);
  assert.ok(claims.length >= 3);
  assert.ok(claims.some((c) => c.text.startsWith("Not one character of this proof has changed") && c.holds === true));
  assert.ok(claims.some((c) => c.text.startsWith("That hardware signed exactly this request and this reply") && c.holds === true));
  // A statement whose checks didn't run (no contract check here) isn't made at all.
  assert.equal(claims.some((c) => c.rests.includes("contract")), false);
  // One failed check behind a statement turns it false, and a check that can't be re-run doesn't count either way.
  const failed = checks.map((c) => (c.id === "signed" ? { ...c, ok: false } : c));
  assert.equal(provenClaims(link, failed).find((c) => c.rests.includes("signed"))?.holds, false);
  const unknown: Check[] = [{ id: "gpu", label: "NVIDIA attested the signer's GPUs", ok: false, detail: "", cantRecheck: true }];
  assert.equal(provenClaims(link, unknown)[0].holds, null);
});

test("try to fake it: one changed character fails the NEAR hash and the hardware's signature", () => {
  const fake = tamperedLink(link);
  assert.notEqual(proofHash(fake.link.proof.bundle), proofHash(link.proof.bundle));
  const checks = verifyProof(fake.link.proof.bundle, onChain);
  assert.equal(byId(checks, "matches")?.ok, false, "the hash on NEAR no longer matches");
  assert.equal(byId(checks, "signed")?.ok, false, "the signature no longer covers the reply");
  const claims = provenClaims(fake.link, checks);
  assert.equal(claims.find((c) => c.rests.includes("matches"))?.holds, false);
  assert.equal(claims.find((c) => c.rests.includes("signed"))?.holds, false);
  // The original link is untouched.
  assert.equal(byId(verifyProof(link.proof.bundle, onChain), "signed")?.ok, true);
});
