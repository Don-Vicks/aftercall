import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

/**
 * Checks that make the "Verified" badge mean something.
 *
 * 1. Attestation preflight: NEAR AI returns attestation evidence for the model
 *    (an Intel TDX quote and NVIDIA GPU evidence) bound to a fresh nonce we chose,
 *    plus the address the model's enclave signs with. Here we check the evidence
 *    is present and fresh; verifying the quotes themselves with Intel and NVIDIA
 *    is part of the Verify page (M3).
 * 2. Response signature: the enclave signs "<...>:<sha256 of request>:<sha256 of
 *    response>" with an Ethereum-style (EIP-191) key. We recompute both hashes
 *    from the exact bytes we sent and received, recover the signer, and require
 *    it to be one of the attested signing addresses.
 *
 * Transcription has no per-response signature on NEAR AI; the app says so.
 */

export interface AttestationReport {
  model_attestations?: {
    request_nonce?: string;
    signing_address?: string;
    intel_quote?: string;
    nvidia_payload?: unknown;
  }[];
}

export interface AttestationCheck {
  ok: boolean;
  signers: string[];
  reasons: string[];
}

export function checkAttestation(report: AttestationReport, nonce: string): AttestationCheck {
  const all = report.model_attestations ?? [];
  const reasons: string[] = [];
  if (all.length === 0) reasons.push("NO_ATTESTATION");
  if (all.some((a) => a.request_nonce !== nonce)) reasons.push("NONCE_NOT_ECHOED");
  if (all.some((a) => !a.intel_quote)) reasons.push("NO_TDX_QUOTE");
  if (all.some((a) => !a.nvidia_payload)) reasons.push("NO_GPU_EVIDENCE");
  const signers = all.map((a) => (a.signing_address ?? "").toLowerCase()).filter(Boolean);
  if (signers.length === 0) reasons.push("NO_SIGNING_ADDRESS");
  return { ok: reasons.length === 0, signers, reasons };
}

export interface SignatureResponse {
  text?: string;
  signature?: string;
  signing_address?: string;
}

export interface SignatureCheck {
  ok: boolean;
  signer: string | null;
  reasons: string[];
}

const hex = (b: Uint8Array) => bytesToHex(b);

/** Address that signed `message` with EIP-191 personal_sign, or null if the signature is malformed. */
export function recoverPersonalSign(message: string, signatureHex: string): string | null {
  try {
    const sig = hexToBytes(signatureHex.replace(/^0x/, ""));
    if (sig.length !== 65) return null;
    const v = sig[64] >= 27 ? sig[64] - 27 : sig[64];
    const body = utf8ToBytes(message);
    const digest = keccak_256(new Uint8Array([...utf8ToBytes(`\x19Ethereum Signed Message:\n${body.length}`), ...body]));
    const pub = secp256k1.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(v).recoverPublicKey(digest).toRawBytes(false);
    return `0x${hex(keccak_256(pub.slice(1)).slice(-20))}`;
  } catch {
    return null;
  }
}

export function checkSignature(
  sig: SignatureResponse,
  requestBytes: Uint8Array,
  responseBytes: Uint8Array,
  attestedSigners: string[],
): SignatureCheck {
  const reasons: string[] = [];
  if (!sig.text || !sig.signature) return { ok: false, signer: null, reasons: ["NO_SIGNATURE"] };
  const parts = sig.text.split(":");
  if (!parts.includes(hex(sha256(requestBytes)))) reasons.push("REQUEST_HASH_MISMATCH");
  if (!parts.includes(hex(sha256(responseBytes)))) reasons.push("RESPONSE_HASH_MISMATCH");
  const signer = recoverPersonalSign(sig.text, sig.signature);
  if (!signer) reasons.push("BAD_SIGNATURE");
  else {
    if (sig.signing_address && signer !== sig.signing_address.toLowerCase()) reasons.push("SIGNER_MISMATCH");
    if (!attestedSigners.includes(signer)) reasons.push("SIGNER_NOT_ATTESTED");
  }
  return { ok: reasons.length === 0, signer, reasons };
}

export const sha256Hex = (bytes: Uint8Array) => hex(sha256(bytes));
