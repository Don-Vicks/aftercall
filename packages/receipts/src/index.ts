/**
 * @aftercall/receipts: check Aftercall meeting proofs and shared transcript lines, in Node
 * 20+ or a browser. The checks are Aftercall's own (packages/core), the same code the public
 * /verify page runs; this package only wraps them without the page.
 */
import { hasFullChecks } from "../../core/src/notes/bundle.ts";
import { decodeVerifyLink, type VerifyLink } from "../../core/src/notes/disclosure.ts";
import { allChecksPassed, runLinkChecks, type ProofFetch } from "../../core/src/notes/proofLink.ts";
import { proofHash, type Check, type OnChainProof } from "../../core/src/notes/proof.ts";
import type { Network } from "../../core/src/network.ts";
import type { Speaker } from "../../core/src/meeting.ts";
import type { TeeCheck } from "../../core/src/tee/checks.ts";

export type { Check, OnChainProof, ProofFetch, Network, Speaker, TeeCheck, VerifyLink };
export type { ProofBundle, ProofBundleV1, ProofBundleV2, ProofBundleV3 } from "../../core/src/notes/bundle.ts";
export type { PublicProof } from "../../core/src/notes/proof.ts";
export type { LineDisclosure } from "../../core/src/notes/disclosure.ts";
export type { DisclosedLine, LineProblem, LineProof, LineTree } from "../../core/src/notes/lines.ts";

// The Merkle tree over transcript lines, and line links.
export { checkLineProof, disclosedLines, lineLeafHash, lineSalt, lineTreeOf, merklePath, merkleRoot, proveLine, rootFromPath } from "../../core/src/notes/lines.ts";
export { LINE_LINK_PREFIX, decodeVerifyLink, encodeLineDisclosure, lineCheck, makeLineDisclosure } from "../../core/src/notes/disclosure.ts";
// The proof itself, offline.
export { NOT_PROVEN, canonicalJson, encodePublicProof, proofHash, verifyProof } from "../../core/src/notes/proof.ts";
export { LINE_NOT_PROVEN } from "../../core/src/notes/disclosure.ts";

export interface VerifyOptions {
  /** Used for NEAR's RPC and NVIDIA's keys. Defaults to the global `fetch`. */
  fetch?: ProofFetch;
}

/** What a link checked out as. */
export interface Receipt {
  kind: "proof" | "line";
  /** Every check below passed, and every check the app recorded in the proof passed. */
  ok: boolean;
  network: Network;
  contract: string;
  /** The NEAR account that recorded the proof. */
  owner: string;
  meetingId: string;
  /** sha256 of the bundle in canonical JSON: what NEAR must hold for this owner and meeting. */
  proofHash: string;
  /** What `get_proof` returned, or null (none, or NEAR couldn't be read: see `rpcError`). */
  onChain: OnChainProof | null;
  /** The checks run now, in /verify's order: the line (for a line link), the contract (only when it isn't Aftercall's), NEAR, signature, attestation, model, NVIDIA. */
  checks: Check[];
  /** The checks the Mac app ran when it made the notes, as the proof recorded them; null for version 1 proofs. */
  recorded: TeeCheck[] | null;
  rpcError?: string;
  /** For a line link: the shared line. `speaker` is the side ("you": the recorder's mic; "others": the call's audio), never a name. */
  line?: { index: number; at: number; speaker: Speaker; text: string };
}

async function receipt(link: VerifyLink, options: VerifyOptions): Promise<Receipt> {
  const { bundle, network, contract, owner } = link.proof;
  const run = await runLinkChecks(link, options.fetch);
  const shared = link.kind === "line" ? link.line.line : undefined;
  return {
    kind: link.kind,
    ok: allChecksPassed(bundle, run.checks),
    network,
    contract,
    owner,
    meetingId: bundle.meetingId,
    proofHash: proofHash(bundle),
    onChain: run.onChain,
    checks: run.checks,
    recorded: hasFullChecks(bundle) ? bundle.checks : null,
    ...(run.rpcError ? { rpcError: run.rpcError } : {}),
    ...(shared ? { line: { index: shared.index, at: shared.at, speaker: shared.speaker, text: shared.text } } : {}),
  };
}

/**
 * Checks a proof link (`…/verify#<payload>`, the fragment, or the payload) as /verify does:
 * reads the proof hash from NEAR and re-runs the proof's checks. A line link is checked as
 * its proof only; use `verifyLineLink` to check the line too. Throws BAD_LINK.
 */
export async function verifyProofLink(link: string, options: VerifyOptions = {}): Promise<Receipt> {
  const read = decodeVerifyLink(link);
  return receipt({ kind: "proof", proof: read.proof }, options);
}

/**
 * Checks a line link (`…/verify#line=<payload>`): the line's salted hash and Merkle path
 * lead to the transcript root in the proof, and the proof checks out against NEAR. Throws
 * BAD_LINK, or NOT_A_LINE_LINK for a proof link.
 */
export async function verifyLineLink(link: string, options: VerifyOptions = {}): Promise<Receipt> {
  const read = decodeVerifyLink(link);
  if (read.kind !== "line") throw new Error("NOT_A_LINE_LINK");
  return receipt(read, options);
}
