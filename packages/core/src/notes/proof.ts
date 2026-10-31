import { utf8ToBytes } from "@noble/hashes/utils";
import type { ProofBundle, ProofBundleV2 } from "./pipeline.ts";
import { isNetwork, type Network } from "../network.ts";
import { recoverPersonalSign, sha256Hex } from "./verify.ts";
import { expectedMrConfig, expectedReportData, signatureKind, signedParts, signerOf, strip0x, type TeeCheck } from "../tee/checks.ts";
import { verifyNrasJwt, type Jwks } from "../tee/nvidia.ts";

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
  id: "on-chain" | "matches" | "signed" | "attested" | "e2ee" | "compose" | "gpu" | "confidential" | "unchanged";
  label: string;
  ok: boolean;
  detail: string;
}

/**
 * The checks behind "Verified" that anyone can re-run from the bundle and NEAR:
 * the public Verify page runs them in the browser, the app runs them when the
 * Verify sheet opens. The app also passes the notes it shows, to prove they are
 * the ones that were signed.
 *
 * For a v2 bundle this re-checks the signature and that the signer is bound in
 * the report data recorded from a verified quote. It can't re-verify the quotes
 * (they aren't in the bundle, and Intel's collateral service doesn't allow
 * browser requests); the app's own checks are in `bundle.checks`.
 */
export function verifyProof(bundle: ProofBundle, onChain: OnChainProof | null, shownNotes?: unknown): Check[] {
  const hash = proofHash(bundle);
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
    ...(bundle.version === 2 ? signatureChecksV2(bundle) : signatureChecksV1(bundle)),
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

function signatureChecksV1(bundle: Exclude<ProofBundle, ProofBundleV2>): Check[] {
  const sig = bundle.signature;
  const signer = sig.text && sig.signature ? recoverPersonalSign(sig.text, sig.signature) : null;
  const signedParts = sig.text?.split(":") ?? [];
  const coversExchange = signedParts.includes(bundle.requestHash) && signedParts.includes(bundle.responseHash);
  return [
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
  ];
}

function signatureChecksV2(bundle: ProofBundleV2): Check[] {
  const sig = bundle.signature;
  const signer = signerOf(sig, bundle.signingAlgo);
  const parts = signedParts(sig.text ?? "");
  const kind = signatureKind(sig);
  const coversExchange = parts.request === bundle.requestHash && parts.response === bundle.responseHash && (parts.model === null || parts.model === bundle.summaryModel);
  // The signer must be a TEE of the right kind whose recorded report data binds its key and our nonce.
  const scope = kind === "gateway" ? "gateway" : kind === "provider_tee" ? "model" : null;
  const tee = bundle.evidence.find(
    (e) =>
      !!signer &&
      (scope === null || e.scope === scope) &&
      (e.scope === "gateway" || e.model === bundle.summaryModel) &&
      e.signingAddress === strip0x(signer) &&
      e.nonce === bundle.attestationNonce.summary &&
      e.reportData === expectedReportData(e.signingAddress, e.nonce),
  );
  const algo = bundle.signingAlgo === "ed25519" ? "Ed25519" : "ECDSA";
  const checks: Check[] = [
    {
      id: "signed",
      label: "Summary signed inside secure hardware",
      ok: !!signer && coversExchange,
      detail: !signer ? `${algo} signature didn't verify` : coversExchange ? `${algo} signature by ${signer.slice(0, 10)}… over the exact request and response` : "The signature doesn't cover this request and response",
    },
    {
      id: "attested",
      label: "Signer was attested",
      ok: !!tee && tee.verified,
      detail: tee
        ? `The key is in the report data of the ${tee.scope === "gateway" ? "gateway" : "model"} TEE's quote, next to this meeting's nonce${tee.verified ? "" : "; the app recorded a failed check for that TEE"}`
        : "The signer isn't bound in any quote the app recorded",
    },
  ];
  if (tee) {
    checks.push({
      id: "compose",
      label: "Signer ran the attested software",
      ok: tee.composeHash.length === 64 && tee.mrConfigId === expectedMrConfig(tee.composeHash),
      detail: `Recorded mr_config is 01 + sha256 of the attested compose (${tee.composeHash.slice(0, 12)}…)`,
    });
  }
  const e2eeTee = bundle.e2ee.used ? bundle.evidence.find((e) => e.scope === "model" && e.model === bundle.summaryModel && e.signingAddress === strip0x(bundle.e2ee.modelKey ?? "")) : undefined;
  checks.push({
    id: "e2ee",
    label: "Transcript encrypted to the attested model",
    ok: !!e2eeTee && e2eeTee.reportData === expectedReportData(e2eeTee.signingAddress, e2eeTee.nonce),
    detail: bundle.e2ee.used
      ? e2eeTee
        ? "The key the app encrypted to is bound in the summary TEE's recorded report data"
        : "The key the app encrypted to isn't one the app recorded"
      : `Not end to end: ${bundle.e2ee.reason ?? "unavailable"}`,
  });
  return checks;
}

/**
 * Re-checks NVIDIA's platform token kept in a v2 proof against NVIDIA's keys
 * (fetched by the caller; NVIDIA serves them to browsers). Not expiry: the token
 * expired an hour after the meeting, but it is still NVIDIA's signed statement.
 */
export async function verifyProofGpu(bundle: ProofBundle, jwks: Jwks | null): Promise<Check | null> {
  if (bundle.version !== 2) return null;
  const tee = bundle.evidence.find((e) => e.nvidiaToken);
  if (!tee?.nvidiaToken) return null;
  const label = "NVIDIA attested the signer's GPUs";
  if (!jwks) return { id: "gpu", label, ok: false, detail: "Couldn't get NVIDIA's signing keys" };
  const v = await verifyNrasJwt(tee.nvidiaToken, jwks);
  if (!v.ok) return { id: "gpu", label, ok: false, detail: `NVIDIA's token didn't verify: ${v.error}` };
  const fresh = strip0x(String(v.claims.eat_nonce ?? "")) === tee.nonce;
  const passed = v.claims["x-nvidia-overall-att-result"] === true;
  const at = typeof v.claims.iat === "number" ? new Date(v.claims.iat * 1000).toISOString().replace("T", " ").slice(0, 16) : "?";
  return {
    id: "gpu",
    label,
    ok: fresh && passed,
    detail: `Token signed by NVIDIA at ${at} UTC; ${passed ? "overall result pass" : "overall result fail"}; ${fresh ? "carries this meeting's nonce" : "nonce doesn't match"}`,
  };
}

/** The app's own checks from a v2 proof, as recorded when the meeting was processed. */
export function recordedChecks(bundle: ProofBundle): TeeCheck[] | null {
  return bundle.version === 2 ? bundle.checks : null;
}

export interface CheckGroup {
  key: "gateway" | "whisper" | "summary" | "response";
  title: string;
  checks: TeeCheck[];
}

/** The app's checks grouped as the Verified panel shows them: Gateway, Whisper TEE, summary TEE, Response. */
export function groupChecks(checks: TeeCheck[], models: { whisperModel: string; summaryModel: string }): CheckGroup[] {
  const summaryTitle = models.summaryModel.startsWith("Qwen/") ? "Qwen TEE" : `${models.summaryModel.split("/").pop()} TEE`;
  const groups: CheckGroup[] = [
    { key: "gateway", title: "Gateway", checks: checks.filter((c) => c.scope === "gateway") },
    { key: "whisper", title: "Whisper TEE", checks: checks.filter((c) => c.scope === "model" && c.model === models.whisperModel) },
    { key: "summary", title: summaryTitle, checks: checks.filter((c) => c.scope === "model" && c.model !== models.whisperModel) },
    { key: "response", title: "Response", checks: checks.filter((c) => c.scope === "response") },
  ];
  return groups.filter((g) => g.checks.length > 0);
}

/** Shown with the Whisper checks: what attestation can and can't say about transcription. */
export const WHISPER_NOTE =
  "Transcription runs in an attested TEE but isn't signed per response. The audio travels over TLS through the attested gateway; it isn't end-to-end encrypted.";

/** What the proof does not show; shown under the checks so nobody reads more into them. */
export const NOT_PROVEN = [
  "That the transcript is accurate: Whisper can mishear names and numbers.",
  "That this transcription came from the attested Whisper TEE: NEAR AI signs chat responses, not transcriptions.",
  "That everyone on the call agreed to be recorded: Aftercall asks you to confirm it, and can't check it.",
  "Who said what: “You” is your microphone and “Others” is the call's audio.",
];

/** Public link payload: everything the Verify page needs, base64url in the URL fragment. */
export interface PublicProof {
  network: Network;
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
  const p = JSON.parse(new TextDecoder().decode(fromBase64Url(fragment.replace(/^#/, "")))) as PublicProof;
  if (!isNetwork(p.network)) throw new Error("BAD_NETWORK");
  return p;
}
