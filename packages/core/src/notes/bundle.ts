import type { SignatureResponse, TeeCheck } from "../tee/checks.ts";
import type { TeeEvidence } from "../tee/attest.ts";
import type { NoticeLog } from "../meeting.ts";

/**
 * What a meeting's proof bundle holds, by version. The proof on NEAR is the sha256 of
 * the bundle in canonical JSON (proof.ts). Kept apart from the pipeline so the checks
 * (proof.ts) and the receipts package load without it.
 */

/** Proofs made before full attestation checks: the signature and attested signers only. */
export interface ProofBundleV1 {
  version: 1;
  meetingId: string;
  summaryModel: string;
  whisperModel: string;
  attestationNonce: { summary: string; whisper: string };
  attestedSigners: string[];
  /** sha256 of the exact chat request and response bodies, as signed by the enclave. */
  requestHash: string;
  responseHash: string;
  signature: SignatureResponse;
  /** sha256 of the transcript and notes the app shows, so later edits are detectable. */
  transcriptHash: string;
  notesHash: string;
}

/** How the transcript reached the summary model. */
export interface E2eeRecord {
  used: boolean;
  /** The model TEE's attested Ed25519 key the transcript was encrypted to. */
  modelKey?: string;
  /**
   * Why it wasn't used, when it wasn't. Only in proofs from earlier versions, which
   * could send the transcript over TLS; the app now sends it encrypted or not at all.
   */
  reason?: string;
}

/**
 * Proofs with every attestation check: the gateway TEE and each model TEE,
 * verified against Intel and NVIDIA with a fresh nonce, and the summary's
 * signature bound to an attested key. Still no meeting content.
 */
export interface ProofBundleV2 extends Omit<ProofBundleV1, "version"> {
  version: 2;
  /** Algorithm of the summary signature and of the keys in `attestedSigners`/`gatewaySigners`. */
  signingAlgo: "ecdsa" | "ed25519";
  /** Gateway keys whose quote verified and bound them. */
  gatewaySigners: string[];
  e2ee: E2eeRecord;
  /** Every check the app ran, pass or fail. */
  checks: TeeCheck[];
  /** The values those checks compared, per TEE. */
  evidence: TeeEvidence[];
  checkedAt: string;
  /**
   * `yourNotesHash(salt, meeting.yourNotes)`, only when you typed notes during the call.
   * The salt stays in notes.json, never in the bundle. Bundles without notes leave the
   * key out, so they hash exactly as before it existed.
   */
  yourNotesHash?: string;
  /**
   * How many items the model proposed that the app dropped because their quote wasn't
   * in the transcript. A statement the app recorded, covered by the hash on NEAR; it
   * can't be re-run from the bundle. Older bundles lack the key and hash as before.
   */
  dropped?: DroppedCounts;
  /** The notice you logged before recording, when you did. Absent otherwise, so older bundles hash as before. */
  notice?: NoticeLog;
}

export interface DroppedCounts {
  decisions: number;
  actionItems: number;
  followUps: number;
}

/** One encrypted chat request of a long call's notes, as the proof keeps it. */
export interface ChatCallRecord {
  /** "section": the notes for one part of the transcript; "overall": the title and summary from the parts' summaries. */
  role: "section" | "overall";
  /** For a section, which part (from 1). */
  part?: number;
  /** sha256 of the exact request bytes sent and of the exact event stream received, as signed by the enclave. */
  requestHash: string;
  responseHash: string;
  signature: SignatureResponse;
}

/**
 * Proofs of a long call's notes, written in several encrypted requests (one per part,
 * then one for the overall summary). The same as version 2, except that every request's
 * hashes and signature are in `calls` instead of one pair at the top. Every request was
 * encrypted to `e2ee.modelKey`, from the attestation behind `attestationNonce.summary`.
 * `notesHash` covers the notes the app merged from the parts (see `mergeSectionNotes`).
 */
export interface ProofBundleV3 extends Omit<ProofBundleV2, "version" | "requestHash" | "responseHash" | "signature"> {
  version: 3;
  calls: ChatCallRecord[];
}

export type ProofBundle = ProofBundleV1 | ProofBundleV2 | ProofBundleV3;

/** Proofs with the full attestation checks and statements: version 2, and version 3 for long calls. */
export const hasFullChecks = (b: ProofBundle | undefined): b is ProofBundleV2 | ProofBundleV3 => b?.version === 2 || b?.version === 3;
