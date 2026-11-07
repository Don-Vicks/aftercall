// Runs against the built package (dist), through its own exports, as plain JavaScript:
// what someone who installs @aftercall/receipts gets. `npm test` builds first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LINE_LINK_PREFIX,
  checkLineProof,
  encodeLineDisclosure,
  encodePublicProof,
  lineLeafHash,
  lineTreeOf,
  makeLineDisclosure,
  merklePath,
  merkleRoot,
  proofHash,
  proveLine,
  rootFromPath,
  verifyLineLink,
  verifyProofLink,
} from "@aftercall/receipts";

// A real version 2 bundle from Aftercall's notes pipeline, made with its test kit (no NEAR AI).
const sample = JSON.parse(readFileSync(new URL("../../../apps/desktop/src/sampleProof.json", import.meta.url), "utf8"));
const KEY = "5a".repeat(32);
const transcript = [
  { at: 3, speaker: "you", text: "Let's ship the export fix on Thursday, and send Sam the recap tonight." },
  { at: 9, speaker: "others", text: "Thursday works. I'll look out for the recap." },
  { at: 14, speaker: "you", text: "The budget is forty thousand, keep it between us." },
];
// NVIDIA's token is left out, so the checks need no NVIDIA keys.
const bundle = { ...sample.bundle, meetingId: "1793006441", evidence: sample.bundle.evidence.map(({ nvidiaToken, ...e }) => e), lineTree: lineTreeOf(transcript, KEY) };
const place = { network: "testnet", contract: "wallet.aftercall.testnet", owner: "ada.testnet" };
const lineLink = `https://getaftercall.vercel.app/verify#${encodeLineDisclosure(makeLineDisclosure(place, bundle, transcript, KEY, 1))}`;

/** NEAR's RPC answering `get_proof` with `hash` (or nothing), and NVIDIA unreachable. */
const near = (hash) => async (url, init) => {
  if (!init) return { ok: false, json: async () => ({}) };
  const answer = hash ? { proof_hash: hash, model: bundle.summaryModel, recorded_at: "1793006500000000000" } : null;
  return { ok: true, json: async () => ({ result: { result: [...new TextEncoder().encode(JSON.stringify(answer))] } }) };
};

test("Merkle helpers: every leaf proves to the root; a changed leaf or path doesn't", () => {
  const leaves = Array.from({ length: 5 }, (_, i) => lineLeafHash({ index: i, at: i, speaker: "you", text: `line ${i}`, salt: "ab".repeat(32) }));
  const root = merkleRoot(leaves);
  for (let i = 0; i < 5; i++) assert.equal(rootFromPath(leaves[i], i, 5, merklePath(leaves, i)), root);
  assert.notEqual(rootFromPath(leaves[0], 1, 5, merklePath(leaves, 1)), root);
  assert.equal(rootFromPath(leaves[0], 5, 5, []), null);
});

test("a line proves to the tree from its transcript and key, and a changed word fails", () => {
  const tree = lineTreeOf(transcript, KEY);
  const p = proveLine(transcript, KEY, tree, 2);
  assert.equal(checkLineProof(tree, p), null);
  assert.equal(checkLineProof(tree, { ...p, line: { ...p.line, text: "The budget is fifty thousand, keep it between us." } }), "mismatch");
});

test("verifyLineLink: an honest line link checks out against NEAR", async () => {
  const r = await verifyLineLink(lineLink, { fetch: near(proofHash(bundle)) });
  assert.equal(r.ok, true);
  assert.equal(r.kind, "line");
  assert.deepEqual(r.line, { index: 1, at: 9, speaker: "others", text: "Thursday works. I'll look out for the recap." });
  assert.deepEqual([r.owner, r.meetingId, r.network], ["ada.testnet", "1793006441", "testnet"]);
  assert.equal(r.proofHash, proofHash(bundle));
  assert.deepEqual(r.checks.map((c) => c.id), ["line", "on-chain", "matches", "signed", "attested", "compose", "e2ee", "confidential"]);
  assert.equal(r.recorded?.length, bundle.checks.length);
});

test("verifyLineLink: another hash on NEAR, no proof, or a changed line fails, and says which check", async () => {
  const failed = (r) => r.checks.filter((c) => !c.ok).map((c) => c.id);
  const other = await verifyLineLink(lineLink, { fetch: near("00".repeat(32)) });
  assert.deepEqual([other.ok, failed(other)], [false, ["matches"]]);
  const none = await verifyLineLink(lineLink, { fetch: near(null) });
  assert.deepEqual([none.ok, failed(none)], [false, ["on-chain", "matches"]]);
  const forged = makeLineDisclosure(place, bundle, transcript, KEY, 1);
  const changed = `#${encodeLineDisclosure({ ...forged, line: { ...forged.line, text: "Thursday doesn't work." } })}`;
  const r = await verifyLineLink(changed, { fetch: near(proofHash(bundle)) });
  assert.deepEqual([r.ok, failed(r)], [false, ["line"]]);
});

test("verifyProofLink checks a proof link, and a line link as its proof only", async () => {
  const proof = await verifyProofLink(`#${encodePublicProof({ ...place, bundle })}`, { fetch: near(proofHash(bundle)) });
  assert.equal(proof.ok, true);
  assert.equal(proof.kind, "proof");
  assert.equal(proof.line, undefined);
  const asProof = await verifyProofLink(lineLink, { fetch: near(proofHash(bundle)) });
  assert.equal(asProof.checks.some((c) => c.id === "line"), false);
});

test("a proof made before line trees verifies as before; its lines can't be shared", async () => {
  const old = await verifyProofLink(encodePublicProof({ ...place, bundle: sample.bundle }), { fetch: near(proofHash(sample.bundle)) });
  assert.equal(old.proofHash, "6b450663ddd3a82b84cc012576ab67ac12e0aa8aa3caca6c1cc29981231ec437");
  // Its NVIDIA token is in the proof; with NVIDIA's keys unreachable that one check fails, as on /verify.
  assert.deepEqual(old.checks.filter((c) => !c.ok).map((c) => c.id), ["gpu"]);
  assert.throws(() => makeLineDisclosure(place, sample.bundle, transcript, KEY, 0), /NO_LINE_TREE/);
});

test("bad links are refused in plain error codes", async () => {
  await assert.rejects(verifyLineLink("https://getaftercall.vercel.app/verify#nope", { fetch: near(null) }), /BAD_LINK/);
  await assert.rejects(verifyLineLink(`#${LINE_LINK_PREFIX}e30`, { fetch: near(null) }), /BAD_LINK/);
  await assert.rejects(verifyLineLink(encodePublicProof({ ...place, bundle }), { fetch: near(null) }), /NOT_A_LINE_LINK/);
});
