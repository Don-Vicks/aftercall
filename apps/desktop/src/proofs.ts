import { proofHash } from "@aftercall/core";
import { near } from "./near";
import { recordingFiles, serializeNotes, type SavedNotes } from "./nearai";

/**
 * Whether this Mac can record a proof right now: ready (account saved, wallet
 * registered and key authorised), no account saved, setup not finished, or NEAR
 * couldn't be asked, with why.
 */
export type ProofReadiness =
  | { ready: true }
  | { ready: false; why: "not-connected" }
  | { ready: false; why: "not-set-up" }
  | { ready: false; why: "error"; error: string };

export async function proofReadiness(): Promise<ProofReadiness> {
  const config = await near.getConfig().catch(() => null);
  if (!config) return { ready: false, why: "not-connected" };
  try {
    const status = await near.status();
    return status.registered && status.keyAdded ? { ready: true } : { ready: false, why: "not-set-up" };
  } catch (e) {
    return { ready: false, why: "error", error: plainProofError(e) };
  }
}

/** Records the proof hash on NEAR and saves where it went into notes.json. */
export async function recordProof(recordingId: string, saved: SavedNotes): Promise<SavedNotes> {
  const config = await near.getConfig();
  if (!config) throw new Error("Connect your NEAR account in Settings first.");
  const hash = proofHash(saved.proof);
  const txHash = await near.recordProof(saved.proof.meetingId, hash, saved.proof.summaryModel);
  const updated: SavedNotes = {
    ...saved,
    onChain: { network: config.network, contract: config.contract, owner: config.account, txHash, proofHash: hash },
  };
  await recordingFiles.saveNotes(recordingId, serializeNotes(updated));
  return updated;
}

/** Why a meeting's proof didn't go on NEAR when its notes were made. */
export type ProofMiss = Exclude<ProofReadiness, { ready: true }>;

/**
 * Records the proof when this Mac can. A failed proof doesn't lose the notes: it
 * comes back with why, and can be recorded later from the Verify sheet.
 */
export async function tryRecordProof(recordingId: string, saved: SavedNotes): Promise<{ saved: SavedNotes; missed?: ProofMiss }> {
  const readiness = await proofReadiness();
  if (!readiness.ready) return { saved, missed: readiness };
  try {
    return { saved: await recordProof(recordingId, saved) };
  } catch (e) {
    return { saved, missed: { ready: false, why: "error", error: plainProofError(e) } };
  }
}

/**
 * The processing step's line on why the proof isn't on NEAR (no closing full stop, like
 * the other steps). "Connect your NEAR account" only when there is none.
 */
export function proofMissLine(missed: ProofMiss): string {
  if (missed.why === "not-connected") return "Connect your NEAR account, then record it from Verify";
  if (missed.why === "not-set-up") return "Finish setting up your NEAR account in Settings, then record it from Verify";
  return proofErrorLine(missed.error).replace(/\.$/, "");
}

/** "Couldn't record the proof on NEAR: <reason>. Try again from Verify." */
export function proofErrorLine(reason: string): string {
  return `Couldn't record the proof on NEAR: ${reason}. Try again from Verify.`;
}

/**
 * Why a proof didn't go on NEAR, in plain words for "Couldn't record the proof on NEAR:
 * <reason>." Unknown errors come through as they are, so nothing is hidden.
 */
export function plainProofError(e: unknown): string {
  const raw = (e instanceof Error ? e.message : String(e)).trim();
  if (/PROOF_EXISTS/.test(raw)) return "a proof for this meeting is already on NEAR";
  if (/STORAGE_CREDIT_LOW/.test(raw)) return "your agent wallet's storage credit has run out";
  if (/NOT_REGISTERED/.test(raw)) return "your account has no agent wallet on the contract yet";
  if (/UNKNOWN_ACCOUNT|CodeDoesNotExist|MethodNotFound/.test(raw)) return "there is no Aftercall contract at the saved contract id";
  if (/NotEnoughAllowance|allowance/i.test(raw)) return "this Mac's key has used up its allowance for fees. Authorise this Mac again in Settings";
  if (/key isn't on the account|UNKNOWN_ACCESS_KEY|AccessKeyDoesNotExist|InvalidAccessKey/i.test(raw))
    return "this Mac's key isn't on your account any more. Authorise this Mac again in Settings";
  if (/error sending request|network|timed? ?out|dns|offline|fetch/i.test(raw)) return "NEAR couldn't be reached. Check the connection";
  return raw.replace(/^Transaction failed: /, "").replace(/\.$/, "") || "NEAR gave no reason";
}
