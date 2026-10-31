import { test } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { recoverPersonalSign, sha256Hex } from "./verify.ts";

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

test("recovers the signer of an EIP-191 message", () => {
  const e = enclave();
  assert.equal(recoverPersonalSign("hello", e.sign("hello")), e.address);
  assert.notEqual(recoverPersonalSign("hello!", e.sign("hello")), e.address);
  assert.equal(recoverPersonalSign("hello", "0x1234"), null);
});

test("sha256 of a string is sha256 of its UTF-8 bytes", () => {
  assert.equal(sha256Hex("naïve"), sha256Hex(utf8ToBytes("naïve")));
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});
