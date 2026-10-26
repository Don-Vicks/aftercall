import { test } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { checkAttestation, checkSignature, recoverPersonalSign, sha256Hex } from "./verify.ts";

/** An enclave-like signer: EIP-191 personal_sign with a secp256k1 key. */
function enclave() {
  const priv = secp256k1.utils.randomPrivateKey();
  const pub = secp256k1.getPublicKey(priv, false);
  const address = `0x${bytesToHex(keccak_256(pub.slice(1)).slice(-20))}`;
  const sign = (message: string) => {
    const body = utf8ToBytes(message);
    const digest = keccak_256(new Uint8Array([...utf8ToBytes(`\x19Ethereum Signed Message:\n${body.length}`), ...body]));
    const s = secp256k1.sign(digest, priv);
    return `0x${bytesToHex(s.toCompactRawBytes())}${(27 + s.recovery).toString(16)}`;
  };
  return { address, sign };
}

const request = utf8ToBytes('{"model":"Qwen/Qwen3.8-27B","messages":[]}');
const response = utf8ToBytes('{"id":"chatcmpl-1","choices":[]}');

test("recovers the signer of an EIP-191 message", () => {
  const e = enclave();
  assert.equal(recoverPersonalSign("hello", e.sign("hello")), e.address);
  assert.notEqual(recoverPersonalSign("hello!", e.sign("hello")), e.address);
  assert.equal(recoverPersonalSign("hello", "0x1234"), null);
});

test("a signature over our exact request and response, by an attested signer, passes", () => {
  const e = enclave();
  const text = `Qwen/Qwen3.8-27B:${sha256Hex(request)}:${sha256Hex(response)}`;
  const check = checkSignature({ text, signature: e.sign(text), signing_address: e.address }, request, response, [e.address]);
  assert.deepEqual(check, { ok: true, signer: e.address, reasons: [] });
});

test("a changed response, an unattested signer or a missing signature fails", () => {
  const e = enclave();
  const text = `Qwen/Qwen3.8-27B:${sha256Hex(request)}:${sha256Hex(response)}`;
  const sig = { text, signature: e.sign(text), signing_address: e.address };
  assert.deepEqual(checkSignature(sig, request, utf8ToBytes("{}"), [e.address]).reasons, ["RESPONSE_HASH_MISMATCH"]);
  assert.deepEqual(checkSignature(sig, request, response, [enclave().address]).reasons, ["SIGNER_NOT_ATTESTED"]);
  assert.deepEqual(checkSignature({}, request, response, [e.address]).reasons, ["NO_SIGNATURE"]);
});

test("attestation must echo our nonce and carry TDX and GPU evidence", () => {
  const good = { request_nonce: "n1", signing_address: "0xABC", intel_quote: "q", nvidia_payload: "p" };
  assert.deepEqual(checkAttestation({ model_attestations: [good] }, "n1"), { ok: true, signers: ["0xabc"], reasons: [] });
  assert.deepEqual(checkAttestation({ model_attestations: [good] }, "other").reasons, ["NONCE_NOT_ECHOED"]);
  assert.deepEqual(checkAttestation({ model_attestations: [{ ...good, nvidia_payload: undefined }] }, "n1").reasons, ["NO_GPU_EVIDENCE"]);
  assert.deepEqual(checkAttestation({}, "n1").reasons, ["NO_ATTESTATION", "NO_SIGNING_ADDRESS"]);
});
