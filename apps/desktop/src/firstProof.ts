import { isDesktop, recorder } from "./recorder";

/**
 * Which meeting's proof was this Mac's first NEAR transaction, kept so that one meeting gets
 * the "Your first NEAR transaction" card (on the processing page and in Verify) and every
 * later proof gets the usual compact line. Only ids and the transaction hash: no content.
 */
const KEY = "aftercall.firstNearProof";

interface FirstProof {
  /** The meeting whose proof came first, or null when this Mac had proofs before the flag existed. */
  meetingId: string | null;
  at: string;
}

function read(): FirstProof | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as FirstProof) : null;
  } catch {
    return null;
  }
}

function write(v: FirstProof) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // Storage blocked: the card may show again; nothing else depends on it.
  }
}

/** This meeting's proof was the first one recorded on NEAR from this Mac. */
export const isFirstProof = (meetingId: string): boolean => read()?.meetingId === meetingId;

/**
 * Called once a proof is on NEAR. The first time, it becomes the first proof, unless a
 * meeting on this Mac already has one (recorded before this flag was kept): then none is.
 * Returns whether this one was the first.
 */
export async function noteProofRecorded(meetingId: string): Promise<boolean> {
  const known = read();
  if (known) return known.meetingId === meetingId;
  const earlier = isDesktop
    ? await recorder
        .list()
        .then((all) => all.some((r) => r.id !== meetingId && r.notes?.includes('"onChain"')))
        .catch(() => false)
    : false;
  write({ meetingId: earlier ? null : meetingId, at: new Date().toISOString() });
  return !earlier;
}
