import { test } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { canonicalJson, decodePublicProof, encodePublicProof, groupChecks, proofHash, verifyProof, verifyProofGpu, type OnChainProof } from "./proof.ts";
import type { ProofBundle, ProofBundleV2 } from "./pipeline.ts";
import { expectedMrConfig, expectedReportData } from "../tee/checks.ts";
import { fakeNras, teeKey } from "../tee/testkit.ts";
import { sha256Hex } from "./verify.ts";

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

const onChainFor = (bundle: ProofBundle): OnChainProof => ({ proof_hash: proofHash(bundle), model: bundle.summaryModel, recorded_at: 1_793_006_500_000_000_000 });

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
});

test("v2 tampering is caught: report data, nonce, E2EE key, recorded failure", async () => {
  const { bundle } = await signedV2();
  const ev = bundle.evidence[0];
  const fail = (b: ProofBundleV2) => verifyProof(b, null).filter((x) => !x.ok && x.id !== "on-chain" && x.id !== "matches").map((x) => x.id);
  assert.deepEqual(fail({ ...bundle, evidence: [{ ...ev, reportData: expectedReportData(teeKey("ed25519").address, ev.nonce) }] }), ["attested", "e2ee"]);
  assert.deepEqual(fail({ ...bundle, attestationNonce: { ...bundle.attestationNonce, summary: "33".repeat(32) } }), ["attested"]);
  assert.deepEqual(fail({ ...bundle, e2ee: { used: true, modelKey: teeKey("ed25519").address } }), ["e2ee"]);
  assert.deepEqual(fail({ ...bundle, evidence: [{ ...ev, verified: false }] }), ["attested"]);
  assert.deepEqual(fail({ ...bundle, evidence: [{ ...ev, mrConfigId: expectedMrConfig(sha256Hex("other")) }] }), ["compose"]);
  assert.deepEqual(fail({ ...bundle, responseHash: sha256Hex("other") }), ["signed"]);
});

test("the panel groups checks as Gateway, Whisper TEE, Qwen TEE, Response", () => {
  const c = (id: string, scope: "gateway" | "model" | "response", model?: string) => ({ id, scope, model, label: id, ok: true, detail: "" });
  const groups = groupChecks(
    [c("gateway-tdx", "gateway"), c("w", "model", "openai/whisper-large-v3"), c("q", "model", "Qwen/Qwen3.8-27B"), c("response-signer", "response")],
    { whisperModel: "openai/whisper-large-v3", summaryModel: "Qwen/Qwen3.8-27B" },
  );
  assert.deepEqual(groups.map((g) => [g.title, g.checks.map((x) => x.id)]), [["Gateway", ["gateway-tdx"]], ["Whisper TEE", ["w"]], ["Qwen TEE", ["q"]], ["Response", ["response-signer"]]]);
});
