import { test } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { canonicalJson, decodePublicProof, encodePublicProof, proofHash, verifyProof, type OnChainProof } from "./proof.ts";
import type { ProofBundle } from "./pipeline.ts";
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
