import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, diffieHellman, hkdfSync } from "node:crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { ed25519, edwardsToMontgomeryPriv } from "@noble/curves/ed25519";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { decryptWith, encryptMessages, encryptTo, newClientKeys } from "./e2ee.ts";

/** The model TEE's side: an Ed25519 key, whose X25519 form decrypts. */
function modelTee() {
  const seed = ed25519.utils.randomPrivateKey();
  return { publicKey: bytesToHex(ed25519.getPublicKey(seed)), x25519Secret: edwardsToMontgomeryPriv(seed) };
}

test("a message encrypted to the model's key decrypts only with the model's key", () => {
  const model = modelTee();
  const sealed = encryptTo("Pay the designer fifty dollars", model.publicKey);
  const bytes = hexToBytes(sealed);
  assert.equal(bytes.length, 32 + 24 + "Pay the designer fifty dollars".length + 16, "eph_pub || nonce || ct+tag");
  assert.equal(decryptWith(sealed, model.x25519Secret), "Pay the designer fifty dollars");
  assert.throws(() => decryptWith(sealed, modelTee().x25519Secret), "another key can't open it");
  const tampered = bytesToHex(Uint8Array.from(bytes, (b, i) => (i === bytes.length - 1 ? b ^ 1 : b)));
  assert.throws(() => decryptWith(tampered, model.x25519Secret), "a changed byte fails authentication");
});

test("every encryption uses a fresh ephemeral key and nonce", () => {
  const model = modelTee();
  const a = encryptTo("same", model.publicKey);
  const b = encryptTo("same", model.publicKey);
  assert.notEqual(a.slice(0, 64), b.slice(0, 64));
  assert.notEqual(a.slice(64, 112), b.slice(64, 112));
});

test("round trip: request to the model, reply to our one-off key", () => {
  const model = modelTee();
  const client = newClientKeys();
  const [system, user] = encryptMessages([{ role: "system", content: "Notes as JSON" }, { role: "user", content: "Transcript: naïve café" }], model.publicKey);
  assert.equal(system.role, "system");
  assert.equal(decryptWith(user.content, model.x25519Secret), "Transcript: naïve café");
  // The TEE encrypts its reply to X-Client-Pub-Key, our Ed25519 public key.
  const reply = encryptTo('{"title":"Sync"}', client.publicKey);
  assert.equal(decryptWith(reply, client.x25519Secret), '{"title":"Sync"}');
});

test("key agreement and derivation match Node's own X25519 and HKDF-SHA256", () => {
  // Decrypt with Node's crypto for ECDH + HKDF (only XChaCha20 from noble), so the
  // derivation isn't only checked against itself.
  const model = modelTee();
  const sealed = hexToBytes(encryptTo("hello", model.publicKey));
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), Buffer.from(model.x25519Secret)]);
  const spki = Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), Buffer.from(sealed.slice(0, 32))]);
  const shared = diffieHellman({ privateKey: createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" }), publicKey: createPublicKey({ key: spki, format: "der", type: "spki" }) });
  const key = new Uint8Array(hkdfSync("sha256", shared, new Uint8Array(0), "ed25519_encryption", 32));
  assert.equal(new TextDecoder().decode(xchacha20poly1305(key, sealed.slice(32, 56)).decrypt(sealed.slice(56))), "hello");
});

test("keys that aren't 32-byte Ed25519 keys are refused", () => {
  assert.throws(() => encryptTo("x", "ab".repeat(20)), /32-byte/);
  assert.throws(() => decryptWith("00", newClientKeys().x25519Secret), /too short/);
});
