import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import type { Speaker, TranscriptLine } from "../meeting.ts";

/**
 * A Merkle tree over the transcript's lines, so one line can be shown with a proof that it
 * is part of the transcript a meeting's proof committed to, without showing any other line.
 *
 * Leaf i = sha256(0x00 ‖ UTF-8 of JSON [i, at, speaker, text, salt]); node = sha256(0x01 ‖
 * left ‖ right); the tree's shape is RFC 9162's (Certificate Transparency v2, section
 * 2.1): the left subtree holds the largest power of two of leaves below n. The 0x00 and
 * 0x01 prefixes keep a leaf from passing for a node. Each line's salt is
 * HMAC-SHA256(key, "aftercall line salt v1:" ‖ i) under a 32-byte random key kept only in
 * the meeting's notes.json on the Mac: without a line's salt its leaf can't be guessed by
 * trying likely words, and one line's salt says nothing about another's.
 */

/** What the proof bundle holds: the root and how many lines it covers. */
export interface LineTree {
  /** The format above. A verifier refuses any other. */
  version: 1;
  /** Merkle root over the transcript's lines, hex. */
  root: string;
  /** How many lines the tree covers: the transcript's length. */
  lines: number;
}

/** One line, as it is hashed into the tree and as a share link reveals it. */
export interface DisclosedLine {
  /** Position in the transcript, from 0. */
  index: number;
  /** Seconds from the start of the recording. */
  at: number;
  speaker: Speaker;
  text: string;
  /** This line's salt (64 hex characters). */
  salt: string;
}

/** A line with the sibling hashes from its leaf up to the root, nearest first. */
export interface LineProof {
  line: DisclosedLine;
  path: string[];
}

const LEAF = 0x00;
const NODE = 0x01;
/** Longer paths would mean more than 2^63 lines: refused before any hashing. */
const MAX_PATH = 63;
const HEX64 = /^[0-9a-f]{64}$/;

function prefixed(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(1 + parts.reduce((n, p) => n + p.length, 0));
  out[0] = tag;
  let i = 1;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

const nodeHash = (left: Uint8Array, right: Uint8Array) => sha256(prefixed(NODE, left, right));

/** Line i's salt, from the meeting's line key. */
export function lineSalt(keyHex: string, index: number): string {
  return bytesToHex(hmac(sha256, hexToBytes(keyHex), utf8ToBytes(`aftercall line salt v1:${index}`)));
}

/** A line's leaf hash. */
export function lineLeafHash(line: DisclosedLine): Uint8Array {
  return sha256(prefixed(LEAF, utf8ToBytes(JSON.stringify([line.index, line.at, line.speaker, line.text, line.salt]))));
}

/** The transcript's lines as leaves, each with its salt from `keyHex`. */
export function disclosedLines(transcript: readonly TranscriptLine[], keyHex: string): DisclosedLine[] {
  return transcript.map((l, index) => ({ index, at: l.at, speaker: l.speaker, text: l.text, salt: lineSalt(keyHex, index) }));
}

/** The largest power of two below n (n ≥ 2). */
function split(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/** RFC 9162's Merkle tree hash over leaf hashes. No lines hash to sha256 of nothing. */
function treeHash(leaves: Uint8Array[]): Uint8Array {
  if (leaves.length === 0) return sha256(new Uint8Array());
  if (leaves.length === 1) return leaves[0];
  const k = split(leaves.length);
  return nodeHash(treeHash(leaves.slice(0, k)), treeHash(leaves.slice(k)));
}

/** The sibling hashes from leaf m up to the root, nearest first (RFC 9162 PATH). */
function auditPath(m: number, leaves: Uint8Array[]): Uint8Array[] {
  if (leaves.length <= 1) return [];
  const k = split(leaves.length);
  return m < k ? [...auditPath(m, leaves.slice(0, k)), treeHash(leaves.slice(k))] : [...auditPath(m - k, leaves.slice(k)), treeHash(leaves.slice(0, k))];
}

/** Merkle root over leaf hashes, hex. */
export function merkleRoot(leaves: Uint8Array[]): string {
  return bytesToHex(treeHash(leaves));
}

/** Leaf `index`'s path to the root, hex. */
export function merklePath(leaves: Uint8Array[], index: number): string[] {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) throw new Error("LINE_OUT_OF_RANGE");
  return auditPath(index, leaves).map(bytesToHex);
}

/**
 * The root a leaf and its path lead to in a tree of `count` leaves (RFC 9162 section
 * 2.1.3.2), or null when the path can't belong to that position: an index outside the
 * tree, a path too short or too long, or anything that isn't a 32-byte hex hash.
 */
export function rootFromPath(leaf: Uint8Array, index: number, count: number, path: readonly string[]): string | null {
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index < 0 || index >= count) return null;
  if (!Array.isArray(path) || path.length > MAX_PATH || !path.every((p) => typeof p === "string" && HEX64.test(p))) return null;
  // Big integers: the shifts must not wrap at 2^31 lines.
  let fn = BigInt(index);
  let sn = BigInt(count - 1);
  let r = leaf;
  for (const hex of path) {
    if (sn === 0n) return null;
    const p = hexToBytes(hex);
    if ((fn & 1n) === 1n || fn === sn) {
      r = nodeHash(p, r);
      while ((fn & 1n) === 0n && fn !== 0n) {
        fn >>= 1n;
        sn >>= 1n;
      }
    } else {
      r = nodeHash(r, p);
    }
    fn >>= 1n;
    sn >>= 1n;
  }
  return sn === 0n ? bytesToHex(r) : null;
}

/** The tree for a transcript, as the proof bundle holds it. */
export function lineTreeOf(transcript: readonly TranscriptLine[], keyHex: string): LineTree {
  const leaves = disclosedLines(transcript, keyHex).map(lineLeafHash);
  return { version: 1, root: merkleRoot(leaves), lines: leaves.length };
}

/**
 * Line `index` with its salt and path, to share. Refused when the transcript and key no
 * longer give the root in `tree` (the transcript on this Mac changed, or the key is
 * wrong), so a link that wouldn't check out is never made.
 */
export function proveLine(transcript: readonly TranscriptLine[], keyHex: string, tree: LineTree, index: number): LineProof {
  const lines = disclosedLines(transcript, keyHex);
  const leaves = lines.map(lineLeafHash);
  if (tree.version !== 1 || leaves.length !== tree.lines || merkleRoot(leaves) !== tree.root) throw new Error("LINE_TREE_MISMATCH");
  const path = merklePath(leaves, index);
  return { line: lines[index], path };
}

/** Why a shared line doesn't check, or null when it does. */
export type LineProblem = "no-tree" | "unknown-version" | "malformed" | "out-of-range" | "mismatch";

/**
 * Checks a shared line against the tree in a proof: its fields are well formed, its
 * index is inside the tree, and its leaf and path lead to the root.
 */
export function checkLineProof(tree: LineTree | undefined, proof: LineProof): LineProblem | null {
  if (!tree) return "no-tree";
  if (tree.version !== 1) return "unknown-version";
  if (typeof tree.root !== "string" || !HEX64.test(tree.root) || !Number.isSafeInteger(tree.lines) || tree.lines < 1) return "malformed";
  const l = proof.line;
  const wellFormed =
    !!l &&
    Number.isSafeInteger(l.index) &&
    typeof l.at === "number" &&
    Number.isFinite(l.at) &&
    l.at >= 0 &&
    (l.speaker === "you" || l.speaker === "others") &&
    typeof l.text === "string" &&
    typeof l.salt === "string" &&
    HEX64.test(l.salt) &&
    Array.isArray(proof.path);
  if (!wellFormed) return "malformed";
  if (l.index < 0 || l.index >= tree.lines) return "out-of-range";
  return rootFromPath(lineLeafHash(l), l.index, tree.lines, proof.path) === tree.root ? null : "mismatch";
}
