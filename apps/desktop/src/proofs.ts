import { proofHash } from "@aftercall/core";
import { near } from "./near";
import { recordingFiles, serializeNotes, type SavedNotes } from "./nearai";

/** Whether this Mac can record proofs right now (account set up and key authorised). */
export async function nearReady(): Promise<boolean> {
  try {
    const config = await near.getConfig();
    if (!config) return false;
    const status = await near.status();
    return status.registered && status.keyAdded;
  } catch {
    return false;
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
