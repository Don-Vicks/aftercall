import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { checkLineProof, disclosedLines, lineLeafHash, lineSalt, lineTreeOf, merklePath, merkleRoot, proveLine, rootFromPath, type LineProof } from "./lines.ts";
import type { TranscriptLine } from "../meeting.ts";

const KEY = "11".repeat(32);
const transcriptOf = (n: number): TranscriptLine[] =>
  Array.from({ length: n }, (_, i) => ({ at: i * 7, speaker: i % 2 ? "others" : "you", text: `Line ${i}: we ship on Thursday` }));

const h = (...parts: (number | Uint8Array)[]) => sha256(new Uint8Array(parts.flatMap((p) => (typeof p === "number" ? [p] : [...p]))));

test("the root follows RFC 9162: 0x00 leaves, 0x01 nodes, left subtree the largest power of two", () => {
  const leaves = [0, 1, 2, 3, 4].map((i) => h(0x00, utf8ToBytes(`leaf ${i}`)));
  const n = (l: Uint8Array, r: Uint8Array) => h(0x01, l, r);
  // Five leaves split 4 + 1: ((0 1)(2 3)) 4.
  const expected = n(n(n(leaves[0], leaves[1]), n(leaves[2], leaves[3])), leaves[4]);
  assert.equal(merkleRoot(leaves), bytesToHex(expected));
  assert.equal(merkleRoot([leaves[0]]), bytesToHex(leaves[0]), "one leaf is its own root");
  assert.equal(merkleRoot([]), bytesToHex(sha256(new Uint8Array())), "no lines hash to sha256 of nothing");
});

test("a leaf hashes its index, time, speaker, words and salt, after a 0x00", () => {
  const line = { index: 3, at: 21, speaker: "others" as const, text: "We ship on “Thursday”", salt: "ab".repeat(32) };
  assert.equal(bytesToHex(lineLeafHash(line)), bytesToHex(h(0x00, utf8ToBytes(JSON.stringify([3, 21, "others", "We ship on “Thursday”", "ab".repeat(32)])))));
});

test("each line's salt comes from the key and its index; lines get different salts", () => {
  const salts = disclosedLines(transcriptOf(4), KEY).map((l) => l.salt);
  assert.equal(new Set(salts).size, 4);
  assert.ok(salts.every((s) => /^[0-9a-f]{64}$/.test(s)));
  assert.equal(salts[2], lineSalt(KEY, 2));
  assert.notEqual(lineSalt("22".repeat(32), 2), salts[2], "another key, other salts");
});

test("every line of trees from 1 to 33 lines proves to the root, odd counts included", () => {
  for (let n = 1; n <= 33; n++) {
    const transcript = transcriptOf(n);
    const tree = lineTreeOf(transcript, KEY);
    assert.equal(tree.lines, n);
    for (let i = 0; i < n; i++) {
      const p = proveLine(transcript, KEY, tree, i);
      assert.equal(p.line.text, transcript[i].text);
      assert.equal(checkLineProof(tree, p), null, `line ${i} of ${n}`);
      assert.ok(p.path.length <= Math.ceil(Math.log2(n)), "a path no longer than the tree is deep");
    }
  }
});

test("a one-line transcript: the leaf is the root and the path is empty", () => {
  const transcript = transcriptOf(1);
  const tree = lineTreeOf(transcript, KEY);
  const p = proveLine(transcript, KEY, tree, 0);
  assert.deepEqual(p.path, []);
  assert.equal(tree.root, bytesToHex(lineLeafHash(p.line)));
  assert.equal(checkLineProof(tree, p), null);
});

const seven = transcriptOf(7);
const tree7 = lineTreeOf(seven, KEY);
const proof5 = proveLine(seven, KEY, tree7, 5);

test("a changed word, speaker or time in the line fails", () => {
  assert.equal(checkLineProof(tree7, { ...proof5, line: { ...proof5.line, text: proof5.line.text.replace("Thursday", "Friday") } }), "mismatch");
  assert.equal(checkLineProof(tree7, { ...proof5, line: { ...proof5.line, speaker: "you" } }), "mismatch");
  assert.equal(checkLineProof(tree7, { ...proof5, line: { ...proof5.line, at: proof5.line.at + 1 } }), "mismatch");
});

test("a wrong path fails: a changed hash, one missing, one extra, or another line's", () => {
  const flip = (hex: string) => (hex[0] === "0" ? "1" : "0") + hex.slice(1);
  assert.equal(checkLineProof(tree7, { ...proof5, path: [flip(proof5.path[0]), ...proof5.path.slice(1)] }), "mismatch");
  assert.equal(checkLineProof(tree7, { ...proof5, path: proof5.path.slice(1) }), "mismatch");
  assert.equal(checkLineProof(tree7, { ...proof5, path: [...proof5.path, "00".repeat(32)] }), "mismatch");
  assert.equal(checkLineProof(tree7, { ...proof5, path: proveLine(seven, KEY, tree7, 4).path }), "mismatch");
  assert.equal(checkLineProof(tree7, { ...proof5, path: ["not hex"] }), "mismatch");
});

test("a wrong salt fails: guessing a line's words needs its salt", () => {
  assert.equal(checkLineProof(tree7, { ...proof5, line: { ...proof5.line, salt: lineSalt(KEY, 4) } }), "mismatch");
  assert.equal(checkLineProof(tree7, { ...proof5, line: { ...proof5.line, salt: "00".repeat(32) } }), "mismatch");
  assert.equal(checkLineProof(tree7, { ...proof5, line: { ...proof5.line, salt: "short" } }), "malformed");
});

test("a swapped index fails: a line can't be moved to another position, or outside the tree", () => {
  const p4 = proveLine(seven, KEY, tree7, 4);
  // Line 5's words, salt and path, claimed as line 4: the leaf commits to its index.
  assert.equal(checkLineProof(tree7, { ...proof5, line: { ...proof5.line, index: 4 } }), "mismatch");
  // Line 5's leaf with line 4's path and index.
  assert.equal(checkLineProof(tree7, { line: { ...proof5.line, index: 4 }, path: p4.path }), "mismatch");
  assert.equal(checkLineProof(tree7, { ...proof5, line: { ...proof5.line, index: 7 } }), "out-of-range");
  assert.equal(checkLineProof(tree7, { ...proof5, line: { ...proof5.line, index: -1 } }), "out-of-range");
  assert.equal(checkLineProof(tree7, { ...proof5, line: { ...proof5.line, index: 1.5 } }), "malformed");
});

test("a damaged line, an unknown tree version or no tree is refused before hashing", () => {
  assert.equal(checkLineProof(undefined, proof5), "no-tree");
  assert.equal(checkLineProof({ ...tree7, version: 2 as 1 }, proof5), "unknown-version");
  assert.equal(checkLineProof({ ...tree7, lines: 0 }, proof5), "malformed");
  assert.equal(checkLineProof(tree7, { ...proof5, line: { ...proof5.line, speaker: "Ada" as "you" } }), "malformed");
  assert.equal(checkLineProof(tree7, { line: proof5.line } as LineProof), "malformed");
  assert.equal(checkLineProof(tree7, { ...proof5, line: { ...proof5.line, at: Number.NaN } }), "malformed");
});

test("the tree size comes from the proof: the last line's path under another count fails", () => {
  const last = proveLine(seven, KEY, tree7, 6);
  const leaf = lineLeafHash(last.line);
  assert.equal(rootFromPath(leaf, 6, 7, last.path), tree7.root);
  assert.equal(rootFromPath(leaf, 6, 8, last.path), null, "an 8-line tree needs a longer path");
  assert.equal(rootFromPath(leaf, 6, 6, last.path), null, "index outside the tree");
});

test("a link is never made from a transcript or key that no longer gives the proof's root", () => {
  const changed = seven.map((l, i) => (i === 2 ? { ...l, text: "Edited later" } : l));
  assert.throws(() => proveLine(changed, KEY, tree7, 5), /LINE_TREE_MISMATCH/);
  assert.throws(() => proveLine(seven, "22".repeat(32), tree7, 5), /LINE_TREE_MISMATCH/);
  assert.throws(() => proveLine(seven, KEY, tree7, 7), /LINE_OUT_OF_RANGE/);
  assert.throws(() => merklePath([], 0), /LINE_OUT_OF_RANGE/);
});
