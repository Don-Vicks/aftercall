import { test } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { NOT_PROVEN, canonicalJson, decodePublicProof, droppedLine, encodePublicProof, groupChecks, hasStatements, noticeLine, proofHash, verifyProof, verifyProofGpu, type OnChainProof } from "./proof.ts";
import type { ProofBundle, ProofBundleV2 } from "./pipeline.ts";
import { expectedMrConfig, expectedReportData } from "../tee/checks.ts";
import { fakeNras, teeKey } from "../tee/testkit.ts";
import { sha256Hex, yourNotesHash } from "./verify.ts";

function signed(): { bundle: ProofBundle; notes: object } {
  const priv = secp256k1.utils.randomPrivateKey();
  const address = `0x${bytesToHex(keccak_256(secp256k1.getPublicKey(priv, false).slice(1)).slice(-20))}`;
  const requestHash = sha256Hex(utf8ToBytes("request"));
  const responseHash = sha256Hex(utf8ToBytes("response"));
  const text = `Qwen/Qwen3.8-27B:${requestHash}:${responseHash}`;
  const b = utf8ToBytes(text);
  const s = secp256k1.sign(keccak_256(new Uint8Array([...utf8ToBytes(`\x19Ethereum Signed Message:\n${b.length}`), ...b])), priv);
  const notes = { title: "Sync with Ada", summary: "s", decisions: [], action_items: [], followups: [] };
  return {
    notes,
    bundle: {
      version: 1,
      meetingId: "1793006441",
      summaryModel: "Qwen/Qwen3.8-27B",
      whisperModel: "openai/whisper-large-v3",
      attestationNonce: { summary: "n1", whisper: "n2" },
      attestedSigners: [address],
      requestHash,
      responseHash,
      signature: { text, signature: `0x${bytesToHex(s.toCompactRawBytes())}${(27 + s.recovery).toString(16)}`, signing_address: address },
      transcriptHash: sha256Hex(utf8ToBytes("[]")),
      notesHash: sha256Hex(utf8ToBytes(JSON.stringify(notes))),
    },
  };
}

const onChainFor = (bundle: ProofBundle): OnChainProof => ({ proof_hash: proofHash(bundle), model: bundle.summaryModel, recorded_at: "1793006500000000000" });

test("canonical JSON sorts keys at every level and ignores key order", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: "x" } }), '{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}');
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
});

test("every check passes for an honest proof", () => {
  const { bundle, notes } = signed();
  const checks = verifyProof(bundle, onChainFor(bundle), notes);
  assert.deepEqual(checks.map((c) => [c.id, c.ok]), [
    ["on-chain", true],
    ["matches", true],
    ["signed", true],
    ["attested", true],
    ["confidential", true],
    ["unchanged", true],
  ]);
});

test("each kind of tampering is caught by its check", () => {
  const { bundle, notes } = signed();
  const onChain = onChainFor(bundle);
  const fail = (b: ProofBundle, c: OnChainProof | null, n?: object) => verifyProof(b, c, n).filter((x) => !x.ok).map((x) => x.id);

  assert.deepEqual(fail(bundle, null), ["on-chain", "matches"]);
  assert.deepEqual(fail({ ...bundle, notesHash: "0".repeat(64) }, onChain), ["matches"], "a changed bundle no longer matches NEAR");
  assert.deepEqual(fail(bundle, onChain, { ...notes, title: "Edited" }), ["unchanged"]);
  const swapped = { ...bundle, responseHash: sha256Hex(utf8ToBytes("other")) };
  assert.ok(fail(swapped, onChainFor(swapped)).includes("signed"), "the signature must cover this response");
  const unattested = { ...bundle, attestedSigners: ["0x0"] };
  assert.deepEqual(fail(unattested, onChainFor(unattested)), ["attested"]);
  const open = { ...bundle, summaryModel: "deepseek-ai/DeepSeek-V3" };
  assert.deepEqual(fail(open, onChainFor(open)), ["confidential"]);
});

test("public links round-trip and carry no meeting content", () => {
  const { bundle } = signed();
  const link = encodePublicProof({ network: "testnet", contract: "aftercall.testnet", owner: "victor.testnet", bundle });
  assert.match(link, /^[A-Za-z0-9_-]+$/);
  assert.equal(proofHash(decodePublicProof(`#${link}`).bundle), proofHash(bundle));
  assert.ok(!Buffer.from(link, "base64url").toString().includes("Sync with Ada"));
});

test("a public proof link names testnet or mainnet, nothing else", () => {
  const link = encodePublicProof({ network: "mainnet", contract: "wallet.victor.near", owner: "victor.near", bundle: {} as never });
  assert.equal(decodePublicProof(link).network, "mainnet");
  const bad = encodePublicProof({ network: "devnet" as never, contract: "w.near", owner: "v.near", bundle: {} as never });
  assert.throws(() => decodePublicProof(bad), /BAD_NETWORK/);
});

// ---------- v2 proofs: full attestation ----------

async function signedV2() {
  const node = teeKey("ed25519");
  const nonce = "11".repeat(32);
  const requestHash = sha256Hex("encrypted request");
  const responseHash = sha256Hex("encrypted response");
  const text = `Qwen/Qwen3.8-27B:${requestHash}:${responseHash}`;
  const nv = await fakeNras();
  const [[, platform]] = (await nv.answer(nonce)) as [[string, string]];
  const notes = { title: "Sync with Ada" };
  const composeHash = sha256Hex("compose");
  const bundle: ProofBundleV2 = {
    version: 2,
    meetingId: "1793006441",
    summaryModel: "Qwen/Qwen3.8-27B",
    whisperModel: "openai/whisper-large-v3",
    attestationNonce: { summary: nonce, whisper: "22".repeat(32) },
    signingAlgo: "ed25519",
    attestedSigners: [node.address],
    gatewaySigners: [],
    requestHash,
    responseHash,
    signature: { text, signature: node.sign(text), signing_address: node.address, signing_algo: "ed25519", signature_kind: "provider_tee" },
    e2ee: { used: true, modelKey: node.address },
    checks: [{ id: "gateway-tdx", scope: "gateway", label: "Genuine Intel TDX confidential VM", ok: true, detail: "Quote verified" }],
    evidence: [
      {
        scope: "model",
        model: "Qwen/Qwen3.8-27B",
        signingAlgo: "ed25519",
        signingAddress: node.address,
        nonce,
        tcbStatus: "UpToDate",
        reportData: expectedReportData(node.address, nonce),
        mrConfigId: expectedMrConfig(composeHash),
        composeHash,
        nvidiaToken: platform,
        verified: true,
      },
      {
        scope: "model",
        model: "openai/whisper-large-v3",
        signingAlgo: "ecdsa",
        signingAddress: "ab".repeat(20),
        nonce: "22".repeat(32),
        tcbStatus: "UpToDate",
        reportData: expectedReportData("ab".repeat(20), "22".repeat(32)),
        mrConfigId: expectedMrConfig(composeHash),
        composeHash,
        verified: true,
      },
    ],
    checkedAt: "2026-11-02T10:00:00.000Z",
    transcriptHash: sha256Hex("[]"),
    notesHash: sha256Hex(JSON.stringify(notes)),
  };
  return { bundle, notes, jwks: nv.jwks };
}

test("a v2 proof re-checks its Ed25519 signature, key binding, compose and E2EE key", async () => {
  const { bundle, notes, jwks } = await signedV2();
  const checks = verifyProof(bundle, onChainFor(bundle as never), notes);
  assert.deepEqual(checks.map((c) => [c.id, c.ok]), [
    ["on-chain", true],
    ["matches", true],
    ["signed", true],
    ["attested", true],
    ["compose", true],
    ["e2ee", true],
    ["confidential", true],
    ["unchanged", true],
  ]);
  assert.equal((await verifyProofGpu(bundle, jwks))?.ok, true);
  assert.equal((await verifyProofGpu(bundle, (await fakeNras()).jwks))?.ok, false, "a token NVIDIA didn't sign fails");
  const gone = { keys: [] };
  assert.equal((await verifyProofGpu(bundle, gone))?.ok, false, "a recent token whose key isn't published fails");
  assert.equal(await verifyProofGpu(bundle, gone, Date.now() / 1000 + 2 * 86400), null, "NVIDIA retired the key of a two-day-old token: nothing to re-check");
  assert.equal((await verifyProofGpu(bundle, jwks, Date.now() / 1000 + 2 * 86400))?.ok, true, "a key still published is still checked");
});

test("v2 tampering is caught: report data, nonce, E2EE key, recorded failure", async () => {
  const { bundle } = await signedV2();
  const [ev, ...rest] = bundle.evidence;
  const fail = (b: ProofBundleV2) => verifyProof(b, null).filter((x) => !x.ok && x.id !== "on-chain" && x.id !== "matches").map((x) => x.id);
  assert.deepEqual(fail({ ...bundle, evidence: [{ ...ev, reportData: expectedReportData(teeKey("ed25519").address, ev.nonce) }, ...rest] }), ["attested", "e2ee"]);
  assert.deepEqual(fail({ ...bundle, attestationNonce: { ...bundle.attestationNonce, summary: "33".repeat(32) } }), ["attested"]);
  assert.deepEqual(fail({ ...bundle, e2ee: { used: true, modelKey: teeKey("ed25519").address } }), ["e2ee"]);
  assert.deepEqual(fail({ ...bundle, evidence: [{ ...ev, verified: false }, ...rest] }), ["attested", "confidential"], "no verified attestation of the summary model");
  assert.deepEqual(fail({ ...bundle, evidence: [ev] }), ["confidential"], "no attestation of Whisper");
  assert.deepEqual(fail({ ...bundle, evidence: [{ ...ev, mrConfigId: expectedMrConfig(sha256Hex("other")) }, ...rest] }), ["compose"]);
  assert.deepEqual(fail({ ...bundle, responseHash: sha256Hex("other") }), ["signed"]);
});

test("an older proof whose transcript went over TLS still passes every other check, with only the E2EE line failing", async () => {
  const { bundle, notes } = await signedV2();
  const old: ProofBundleV2 = { ...bundle, e2ee: { used: false, reason: "NEAR AI refused end-to-end encryption (400: it didn't accept the encryption headers)" } };
  const checks = verifyProof(old, onChainFor(old as never), notes);
  assert.deepEqual(checks.filter((c) => !c.ok).map((c) => c.id), ["e2ee"]);
  assert.equal(checks.find((c) => c.id === "e2ee")!.detail, "Not end to end: NEAR AI refused end-to-end encryption (400: it didn't accept the encryption headers)");
});

test("the panel groups checks as Gateway, Whisper TEE, Qwen TEE, Response", () => {
  const c = (id: string, scope: "gateway" | "model" | "response", model?: string) => ({ id, scope, model, label: id, ok: true, detail: "" });
  const groups = groupChecks(
    [c("gateway-tdx", "gateway"), c("w", "model", "openai/whisper-large-v3"), c("q", "model", "Qwen/Qwen3.8-27B"), c("response-signer", "response")],
    { whisperModel: "openai/whisper-large-v3", summaryModel: "Qwen/Qwen3.8-27B" },
  );
  assert.deepEqual(groups.map((g) => [g.title, g.checks.map((x) => x.id)]), [["Gateway", ["gateway-tdx"]], ["Whisper TEE", ["w"]], ["Qwen TEE", ["q"]], ["Response", ["response-signer"]]]);
});

// ---------- your notes ----------

test("old proofs hash exactly as before and get no your-notes check", async () => {
  // A bundle's hash from before your notes existed (same value on the commit before them); it must never move.
  const fixed = { version: 2, meetingId: "1793006441", summaryModel: "Qwen/Qwen3.8-27B", whisperModel: "openai/whisper-large-v3", requestHash: "aa", responseHash: "bb", transcriptHash: "cc", notesHash: "dd", checkedAt: "2026-11-02T10:00:00.000Z" };
  assert.equal(proofHash(fixed as never), "11bb23c4d909137da92a6a38a17c3691d93c002c2d8494275bacd37d297a33e5");
  assert.equal(proofHash({ ...fixed, yourNotesHash: undefined } as never), proofHash(fixed as never), "an absent key and an undefined one hash the same");
  const { bundle, notes } = signed();
  assert.equal(verifyProof(bundle, onChainFor(bundle), notes, { text: "" }).some((c) => c.id === "your-notes"), false);
  const v2 = (await signedV2()).bundle;
  assert.equal("yourNotesHash" in v2, false);
  assert.equal(verifyProof(v2, null, undefined, { text: "", salt: undefined }).some((c) => c.id === "your-notes"), false);
});

test("your notes check: matches with the salt, fails if changed, added or the salt is lost", async () => {
  const { bundle: base, notes } = await signedV2();
  const salt = "ab".repeat(32);
  const typed = "Fix before demo, no exceptions.";
  const bundle = { ...base, yourNotesHash: yourNotesHash(salt, typed) };
  const check = (b: ProofBundleV2, text: string, s?: string) => verifyProof(b, onChainFor(b as never), notes, { text, salt: s }).find((c) => c.id === "your-notes");

  assert.deepEqual(check(bundle, typed, salt), { id: "your-notes", label: "Your notes unchanged since signing", ok: true, detail: "What you typed is what the model was given, by a salted hash" });
  assert.equal(check(bundle, "Fix before demo, no exceptions!", salt)?.detail, "Your notes were changed after signing");
  assert.equal(check(bundle, typed, "cd".repeat(32))?.ok, false, "another salt gives another hash");
  assert.equal(check(bundle, typed)?.detail, "The salt for your notes is missing from this Mac's copy");
  assert.equal(check(base, typed, salt)?.detail, "Your notes aren't in the signed proof; they were added afterwards");
  assert.equal(yourNotesHash(salt, typed), sha256Hex(new Uint8Array([...Buffer.from(salt, "hex"), ...utf8ToBytes(typed)])), "sha256(salt bytes ‖ UTF-8 notes)");
  // The public page passes no notes: nothing to check, and the hash alone says nothing about the words.
  assert.equal(verifyProof(bundle, null).some((c) => c.id === "your-notes"), false);
});

// ---------- dropped items and the notice ----------

test("old proofs without dropped or notice hash exactly as before", () => {
  const fixed = { version: 2, meetingId: "1793006441", summaryModel: "Qwen/Qwen3.8-27B", whisperModel: "openai/whisper-large-v3", requestHash: "aa", responseHash: "bb", transcriptHash: "cc", notesHash: "dd", checkedAt: "2026-11-02T10:00:00.000Z" };
  assert.equal(proofHash({ ...fixed, dropped: undefined, notice: undefined } as never), "11bb23c4d909137da92a6a38a17c3691d93c002c2d8494275bacd37d297a33e5");
  assert.notEqual(proofHash({ ...fixed, dropped: { decisions: 0, actionItems: 0, followUps: 0 } } as never), proofHash(fixed as never), "a recorded count is covered by the hash");
});

test("droppedLine: counts in words, none for old bundles, never a check", async () => {
  const { bundle } = await signedV2();
  assert.equal(droppedLine(bundle), null, "a bundle made before the count existed");
  assert.equal(droppedLine(signed().bundle), null, "v1");
  const line = (decisions: number, actionItems: number, followUps: number) => droppedLine({ ...bundle, dropped: { decisions, actionItems, followUps } });
  assert.equal(line(0, 0, 0), "Every item the model proposed had an exact quote in the transcript.");
  assert.equal(line(0, 1, 0), "The app dropped 1 item the model proposed (1 action item) because its quote wasn't in the transcript.");
  assert.equal(line(1, 0, 1), "The app dropped 2 items the model proposed (1 decision, 1 follow-up) because their quotes weren't in the transcript.");
  assert.equal(line(2, 3, 0), "The app dropped 5 items the model proposed (2 decisions, 3 action items) because their quotes weren't in the transcript.");
  const withCount = { ...bundle, dropped: { decisions: 1, actionItems: 0, followUps: 0 } };
  assert.deepEqual(verifyProof(withCount, null).map((c) => c.id), verifyProof(bundle, null).map((c) => c.id), "no new check: the transcript isn't public, so it can't be re-run");
});

test("noticeLine: who said it, when they said it, how, and that the app can't check it", () => {
  const at = "2026-11-01T14:02:45.000Z";
  // The time is when the statement was made (the tick), not when people were told.
  assert.equal(noticeLine({ by: "you", at, how: "chat" }, { timeZone: "UTC" }), "Stated by the person who recorded at 14:02: they told everyone in chat. Aftercall can't check this.");
  assert.equal(noticeLine({ by: "you", at, how: "aloud" }, { timeZone: "UTC" }), "Stated by the person who recorded at 14:02: they told everyone aloud. Aftercall can't check this.");
  assert.equal(noticeLine({ by: "you", at, how: "invite" }, { timeZone: "Africa/Lagos" }), "Stated by the person who recorded at 15:02: they told everyone in the invite. Aftercall can't check this.");
  assert.equal(noticeLine({ by: "you", at, how: "email" }, { timeZone: "UTC" }), "Stated by the person who recorded at 14:02: they told everyone by email. Aftercall can't check this.");
  assert.equal(noticeLine({ by: "you", at }, { timeZone: "UTC" }), "Stated by the person who recorded at 14:02: they told everyone. Aftercall can't check this.");
  assert.equal(noticeLine({ by: "you", at: "not a time" }), "Stated by the person who recorded: they told everyone. Aftercall can't check this.");
  assert.equal(noticeLine(undefined), "No notice logged");
});

test("hasStatements tells a proof made before notices were kept from one with no notice", async () => {
  const { bundle } = await signedV2();
  assert.equal(hasStatements(signed().bundle), false, "v1");
  assert.equal(hasStatements(bundle), false, "an older v2 proof: no dropped count, no notice");
  assert.equal(hasStatements({ ...bundle, dropped: { decisions: 0, actionItems: 0, followUps: 0 } }), true, "a new proof without a notice");
  assert.equal(hasStatements({ ...bundle, notice: { by: "you", at: "2026-11-01T14:02:45.000Z" } }), true);
});

test("what the proof doesn't show includes NEAR AI's data policy and older meetings sent over TLS", () => {
  assert.ok(NOT_PROVEN.some((l) => /What NEAR AI keeps or trains on/.test(l) && /NEAR AI's own policy/.test(l)));
  assert.ok(!NOT_PROVEN.some((l) => /stated policy/.test(l)), "no claim about what NEAR AI's policy says");
  assert.ok(NOT_PROVEN.some((l) => /every older meeting/.test(l) && /earlier versions of the app could send it over TLS/.test(l)));
  assert.ok(!NOT_PROVEN.some((l) => /every summary node passed|refuses an encryption header/.test(l)), "no TLS path in the app today");
  assert.ok(NOT_PROVEN.some((l) => /Whisper can mishear/.test(l)), "the existing items stay");
  for (const l of NOT_PROVEN) assert.equal(l.split(/\.\s/).length, 1, `one sentence: ${l}`);
});

test("who said what: a likely name from the model is listed as not proven", () => {
  assert.ok(NOT_PROVEN.some((l) => /^Who said what/.test(l) && /“likely”, from the model/.test(l) && /isn't checked like quotes/.test(l)));
});
