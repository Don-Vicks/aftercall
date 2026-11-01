import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

/**
 * Signature helpers shared by the pipeline, the proof and the Verify page. The
 * attestation and response checks themselves live in ../tee/checks.ts.
 */

/** Address that signed `message` with EIP-191 personal_sign, or null if the signature is malformed. */
export function recoverPersonalSign(message: string, signatureHex: string): string | null {
  try {
    const sig = hexToBytes(signatureHex.replace(/^0x/, ""));
    if (sig.length !== 65) return null;
    const v = sig[64] >= 27 ? sig[64] - 27 : sig[64];
    const body = utf8ToBytes(message);
    const digest = keccak_256(new Uint8Array([...utf8ToBytes(`\x19Ethereum Signed Message:\n${body.length}`), ...body]));
    const pub = secp256k1.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(v).recoverPublicKey(digest).toRawBytes(false);
    return `0x${bytesToHex(keccak_256(pub.slice(1)).slice(-20))}`;
  } catch {
    return null;
  }
}

/** sha256 as hex, of bytes or of a string's UTF-8 bytes. */
export const sha256Hex = (data: Uint8Array | string) => bytesToHex(sha256(typeof data === "string" ? utf8ToBytes(data) : data));

/**
 * sha256(salt ‖ your notes): the salt's bytes, then the notes' UTF-8 bytes. The salt
 * is 32 random bytes kept only in notes.json, so the hash in a public proof link can't
 * be used to guess short notes ("Fix before demo") by trying likely phrases.
 */
export function yourNotesHash(saltHex: string, notes: string): string {
  const salt = hexToBytes(saltHex);
  const text = utf8ToBytes(notes);
  const both = new Uint8Array(salt.length + text.length);
  both.set(salt);
  both.set(text, salt.length);
  return sha256Hex(both);
}
