import { utf8ToBytes } from "@noble/hashes/utils";
import type { ProofBundle } from "./pipeline.ts";
import { recoverPersonalSign, sha256Hex } from "./verify.ts";

/**
 * The proof on NEAR is the sha256 of the proof bundle in canonical JSON (keys
 * sorted, no spaces). The bundle holds hashes, nonces, the model and its
 * signature, never meeting content, so it can be shared in a public link.
 */

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function proofHash(bundle: ProofBundle): string {
  return sha256Hex(utf8ToBytes(canonicalJson(bundle)));
}

/** What `get_proof` on the agent-wallet contract returns. */
export interface OnChainProof {
  proof_hash: string;
  model: string;
  /** Block timestamp in nanoseconds. */
  recorded_at: number;
}

/** Models whose summaries Aftercall treats as private (NEAR AI Confidential TEE tier). */
export const CONFIDENTIAL_MODELS = ["Qwen/Qwen3.8-27B", "Qwen/Qwen3.6-35B-A3B-FP8"];

export interface Check {
  id: "on-chain" | "matches" | "signed" | "attested" | "confidential" | "unchanged";
  label: string;
  ok: boolean;
  detail: string;
}

/**
 * The checks behind "Verified". Anyone can run them: the public Verify page uses
 * the bundle from the link and the proof read from NEAR. The app also passes the
 * notes it shows, to prove they are the ones that were signed.
 */
export function verifyProof(bundle: ProofBundle, onChain: OnChainProof | null, shownNotes?: unknown): Check[] {
  const hash = proofHash(bundle);
  const sig = bundle.signature;
  const signer = sig.text && sig.signature ? recoverPersonalSign(sig.text, sig.signature) : null;
  const signedParts = sig.text?.split(":") ?? [];
  const coversExchange = signedParts.includes(bundle.requestHash) && signedParts.includes(bundle.responseHash);

  const checks: Check[] = [
    {
      id: "on-chain",
      label: "Proof recorded on NEAR",
      ok: onChain !== null,
      detail: onChain
        ? `Recorded ${new Date(onChain.recorded_at / 1e6).toISOString().replace("T", " ").slice(0, 16)} UTC`
        : "No proof for this meeting on the agent-wallet contract",
    },
    {
      id: "matches",
      label: "Proof matches this meeting",
      ok: onChain !== null && onChain.proof_hash === hash,
      detail: onChain ? (onChain.proof_hash === hash ? `sha256 ${hash.slice(0, 16)}…` : "The hash on NEAR is different") : "Nothing on NEAR to compare",
    },
    {
      id: "signed",
      label: "Summary signed inside secure hardware",
      ok: !!signer && coversExchange && signer === sig.signing_address?.toLowerCase(),
      detail: !signer
        ? "No valid signature"
        : coversExchange
          ? `Signed by ${signer.slice(0, 10)}… over the exact request and response`
          : "The signature doesn't cover this request and response",
    },
    {
      id: "attested",
      label: "Signer was attested",
      ok: !!signer && bundle.attestedSigners.includes(signer),
      detail: signer && bundle.attestedSigners.includes(signer)
        ? "The signing key belonged to an attested enclave, checked with a fresh nonce"
        : "The signer isn't in the attestation recorded at processing time",
    },
    {
      id: "confidential",
      label: "Private model",
      ok: CONFIDENTIAL_MODELS.includes(bundle.summaryModel),
      detail: `${bundle.summaryModel} on NEAR AI Confidential TEE · transcription by ${bundle.whisperModel}`,
    },
  ];

  if (shownNotes !== undefined) {
    const same = sha256Hex(utf8ToBytes(JSON.stringify(shownNotes))) === bundle.notesHash;
    checks.push({
      id: "unchanged",
      label: "Notes unchanged since signing",
      ok: same,
      detail: same ? "The notes shown are the ones the model returned" : "The notes were changed after signing",
    });
  }
  return checks;
}

/** What the proof does not show; shown under the checks so nobody reads more into them. */
export const NOT_PROVEN = [
  "That the transcript is accurate: Whisper can mishear names and numbers.",
  "That transcription ran in secure hardware: NEAR AI signs chat responses, not transcriptions.",
  "That everyone on the call agreed to be recorded: Aftercall asks you to confirm it, and can't check it.",
  "Who said what: “You” is your microphone and “Others” is the call's audio.",
];

/** Public link payload: everything the Verify page needs, base64url in the URL fragment. */
export interface PublicProof {
  network: "testnet" | "mainnet";
  contract: string;
  owner: string;
  bundle: ProofBundle;
}

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export function encodePublicProof(p: PublicProof): string {
  return toBase64Url(utf8ToBytes(canonicalJson(p)));
}

export function decodePublicProof(fragment: string): PublicProof {
  return JSON.parse(new TextDecoder().decode(fromBase64Url(fragment.replace(/^#/, "")))) as PublicProof;
}
