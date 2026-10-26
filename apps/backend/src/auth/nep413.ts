import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { base58, base64 } from "@scure/base";

/**
 * NEP-413 off-chain message signing ("sign in with NEAR").
 * Spec: https://github.com/near/NEPs/blob/master/neps/nep-0413.md
 *
 * The wallet signs sha256(borsh(u32 tag) ++ borsh(payload)), where the tag is
 * 2^31 + 413 so the bytes can never be a valid NEAR transaction.
 */
export const NEP413_TAG = 2 ** 31 + 413;

export interface SignedMessage {
  accountId: string;
  /** "ed25519:<base58>" */
  publicKey: string;
  /** base64, as wallets return it */
  signature: string;
  message: string;
  /** 32 bytes, base64 */
  nonce: string;
  recipient: string;
  callbackUrl?: string | null;
}

function borshString(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The 32-byte hash a wallet signs for this payload. */
export function nep413Hash(message: string, nonce: Uint8Array, recipient: string, callbackUrl?: string | null): Uint8Array {
  if (nonce.length !== 32) throw new Error("NONCE_MUST_BE_32_BYTES");
  const tag = new Uint8Array(4);
  new DataView(tag.buffer).setUint32(0, NEP413_TAG, true);
  const callback = callbackUrl ? concat([Uint8Array.of(1), borshString(callbackUrl)]) : Uint8Array.of(0);
  return sha256(concat([tag, borshString(message), nonce, borshString(recipient), callback]));
}

export function parsePublicKey(key: string): Uint8Array {
  const [curve, data] = key.split(":");
  if (curve !== "ed25519" || !data) throw new Error("ONLY_ED25519_KEYS");
  const bytes = base58.decode(data);
  if (bytes.length !== 32) throw new Error("BAD_PUBLIC_KEY");
  return bytes;
}

/** Checks the signature only. Whether the key belongs to the account is a separate RPC check. */
export function verifySignature(m: SignedMessage): boolean {
  try {
    const hash = nep413Hash(m.message, base64.decode(m.nonce), m.recipient, m.callbackUrl);
    return ed25519.verify(base64.decode(m.signature), hash, parsePublicKey(m.publicKey));
  } catch {
    return false;
  }
}
