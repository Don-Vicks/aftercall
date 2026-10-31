import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { ed25519, edwardsToMontgomeryPriv, edwardsToMontgomeryPub, x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils";

/**
 * NEAR AI end-to-end encrypted chat, protocol v2
 * (docs.near.ai/cloud/guides/e2ee-chat-completions):
 *
 *   X25519 ECDH (Ed25519 keys converted to X25519) → HKDF-SHA256 with info
 *   "ed25519_encryption" → XChaCha20-Poly1305. Every encrypted field is hex of
 *   [ephemeral X25519 public key (32)][nonce (24)][ciphertext + tag].
 *
 * Requests are encrypted to the model TEE's attested Ed25519 key; replies come
 * back encrypted to a key pair made for this one request.
 */

const INFO = utf8ToBytes("ed25519_encryption");

export interface ClientKeys {
  /** Ed25519 public key, hex: the X-Client-Pub-Key header. */
  publicKey: string;
  /** X25519 secret derived from the Ed25519 secret; used to decrypt replies. */
  x25519Secret: Uint8Array;
}

/** A fresh Ed25519 key pair for one request. */
export function newClientKeys(seed: Uint8Array = ed25519.utils.randomPrivateKey()): ClientKeys {
  return { publicKey: bytesToHex(ed25519.getPublicKey(seed)), x25519Secret: edwardsToMontgomeryPriv(seed) };
}

function seal(plaintext: Uint8Array, recipientX25519: Uint8Array, ephemeral: Uint8Array, nonce: Uint8Array): Uint8Array {
  const key = hkdf(sha256, x25519.getSharedSecret(ephemeral, recipientX25519), undefined, INFO, 32);
  const ct = xchacha20poly1305(key, nonce).encrypt(plaintext);
  return new Uint8Array([...x25519.getPublicKey(ephemeral), ...nonce, ...ct]);
}

/** Encrypts `plaintext` to an Ed25519 public key (hex). Returns the hex wire format. */
export function encryptTo(plaintext: string, ed25519PublicKeyHex: string): string {
  const pub = hexToBytes(ed25519PublicKeyHex.replace(/^0x/i, ""));
  if (pub.length !== 32) throw new Error("The model key isn't a 32-byte Ed25519 key");
  return bytesToHex(seal(utf8ToBytes(plaintext), edwardsToMontgomeryPub(pub), randomBytes(32), randomBytes(24)));
}

/** Decrypts a hex wire-format field with our X25519 secret. Throws if it was tampered with. */
export function decryptWith(hex: string, x25519Secret: Uint8Array): string {
  const data = hexToBytes(hex.trim());
  if (data.length < 32 + 24 + 16) throw new Error("Encrypted field is too short");
  const key = hkdf(sha256, x25519.getSharedSecret(x25519Secret, data.slice(0, 32)), undefined, INFO, 32);
  return new TextDecoder("utf-8", { fatal: true }).decode(xchacha20poly1305(key, data.slice(32, 56)).decrypt(data.slice(56)));
}

/** The same message list with every `content` encrypted to the model. */
export function encryptMessages<M extends { content: string }>(messages: M[], modelKeyHex: string): M[] {
  return messages.map((m) => ({ ...m, content: encryptTo(m.content, modelKeyHex) }));
}
