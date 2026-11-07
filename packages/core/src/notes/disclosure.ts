import { hasFullChecks, type ProofBundle } from "./bundle.ts";
import { checkLineProof, proveLine, type LineProof } from "./lines.ts";
import { decodeLinkPayload, decodePublicProof, encodeLinkPayload, type Check, type PublicProof } from "./proof.ts";
import { isNetwork } from "../network.ts";
import type { Evidence, Speaker, TranscriptLine } from "../meeting.ts";

/**
 * Sharing one transcript line. The link is /verify#line=<base64url of canonical JSON>: the
 * proof link's fields (network, contract, owner, bundle) plus the line (index, time,
 * speaker, words, salt) and its Merkle path. It reveals that line and what the proof link
 * already does, nothing else of the meeting. Only in the fragment, so no server sees it.
 */

/** What a line link carries. */
export interface LineDisclosure extends PublicProof, LineProof {}

/** A line link's fragment starts with this; a proof link's is the payload alone. */
export const LINE_LINK_PREFIX = "line=";

export function encodeLineDisclosure(d: LineDisclosure): string {
  return `${LINE_LINK_PREFIX}${encodeLinkPayload({ network: d.network, contract: d.contract, owner: d.owner, bundle: d.bundle, line: d.line, path: d.path })}`;
}

/** A /verify link, read: the proof alone, or the proof and one shared line. */
export type VerifyLink = { kind: "proof"; proof: PublicProof } | { kind: "line"; proof: PublicProof; line: LineProof };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function wellFormedProof(p: unknown): p is PublicProof {
  return isObject(p) && isNetwork(p.network) && typeof p.contract === "string" && typeof p.owner === "string" && isObject(p.bundle) && typeof p.bundle.meetingId === "string";
}

/** A line a page can show: its words a string, its time a number, its side one of the two. */
function readableLine(l: unknown): boolean {
  return isObject(l) && typeof l.text === "string" && typeof l.at === "number" && (l.speaker === "you" || l.speaker === "others");
}

/**
 * Reads a /verify link: the whole URL, its fragment ("#…") or the fragment's text. Throws
 * BAD_LINK when it can't be read. A line link whose line doesn't check still reads; the
 * check says why.
 */
export function decodeVerifyLink(link: string): VerifyLink {
  const at = link.indexOf("#");
  const fragment = (at >= 0 ? link.slice(at + 1) : link).trim();
  try {
    if (fragment.startsWith(LINE_LINK_PREFIX)) {
      const d = decodeLinkPayload(fragment.slice(LINE_LINK_PREFIX.length));
      if (!isObject(d) || !wellFormedProof(d) || !readableLine(d.line) || !Array.isArray(d.path)) throw new Error("shape");
      const { network, contract, owner, bundle } = d;
      return { kind: "line", proof: { network, contract, owner, bundle }, line: { line: d.line as unknown as LineProof["line"], path: d.path as string[] } };
    }
    const proof = decodePublicProof(fragment);
    if (!wellFormedProof(proof)) throw new Error("shape");
    return { kind: "proof", proof };
  } catch {
    throw new Error("BAD_LINK");
  }
}

/** "Line is in the transcript the proof commits to": the shared line's leaf and path lead to the bundle's root. */
export function lineCheck(bundle: ProofBundle, shared: LineProof): Check {
  const tree = hasFullChecks(bundle) ? bundle.lineTree : undefined;
  const problem = checkLineProof(tree, shared);
  const label = "Line is in the transcript the proof commits to";
  if (problem === null && tree) {
    return {
      id: "line",
      label,
      ok: true,
      detail: `Its salted hash and ${shared.path.length} sibling ${shared.path.length === 1 ? "hash lead" : "hashes lead"} to the proof's transcript root ${tree.root.slice(0, 12)}… (${tree.lines} lines)`,
    };
  }
  const detail =
    problem === "no-tree"
      ? "This proof has no transcript root: it was made before Aftercall could share lines"
      : problem === "unknown-version"
        ? "The proof's transcript root is in a format this page doesn't know"
        : problem === "out-of-range"
          ? `The link puts the line outside the transcript's ${tree?.lines} lines`
          : problem === "malformed"
            ? "The line in the link can't be read"
            : "The line, its salt or its path don't lead to the proof's transcript root: something in the link was changed";
  return { id: "line", label, ok: false, detail };
}

/**
 * The line link for line `index` of a meeting whose proof is on NEAR. Throws NO_LINE_TREE
 * for a proof made before lines could be shared, and LINE_TREE_MISMATCH when the transcript
 * and key on this Mac no longer give the proof's root, so a link that fails is never made.
 */
export function makeLineDisclosure(place: Omit<PublicProof, "bundle">, bundle: ProofBundle, transcript: readonly TranscriptLine[], lineKey: string | undefined, index: number): LineDisclosure {
  const tree = hasFullChecks(bundle) ? bundle.lineTree : undefined;
  if (!tree || !lineKey) throw new Error("NO_LINE_TREE");
  const shared = proveLine(transcript, lineKey, tree, index);
  return { network: place.network, contract: place.contract, owner: place.owner, bundle, ...shared };
}

/** Whether a meeting's lines can be shared: its proof has a transcript root and this Mac has the key. */
export function canShareLines(bundle: ProofBundle | undefined, lineKey: string | undefined): boolean {
  return !!bundle && hasFullChecks(bundle) && !!bundle.lineTree && !!lineKey;
}

/** The transcript line a quote was taken from: said at its time, with its words in it. Null if none. */
export function lineOfQuote(transcript: readonly TranscriptLine[], evidence: Evidence): number | null {
  const squash = (s: string) => s.replace(/\s+/g, " ");
  const quote = squash(evidence.quote);
  const i = transcript.findIndex((l) => l.at === evidence.at && squash(l.text).includes(quote));
  return i >= 0 ? i : null;
}

/** Who a shared line came from, as far as Aftercall knows: which side of the call, never a name. */
export function lineSpeakerWords(speaker: Speaker): string {
  return speaker === "you" ? "The person who recorded, on their microphone" : "The call's audio: someone on the other side";
}

/**
 * When the recording started, from its meeting id: the Mac app names a recording by the Unix
 * second it started, and the id is on NEAR with the proof. Null for any other id.
 */
export function recordingStartMs(meetingId: string): number | null {
  return /^\d{9,11}$/.test(meetingId) ? Number(meetingId) * 1000 : null;
}

/** What a line link doesn't show, above the proof's own list (NOT_PROVEN). */
export const LINE_NOT_PROVEN = [
  "That anyone else heard it: this shows the line is in the transcript the recorder's Mac committed to in its proof on NEAR, with that proof's checks, not that someone else heard it said.",
];
