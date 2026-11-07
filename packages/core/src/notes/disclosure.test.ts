import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { utf8ToBytes } from "@noble/hashes/utils";
import type { ProofBundleV2 } from "./bundle.ts";
import { LINE_LINK_PREFIX, canShareLines, lineSpeakerWords, recordingStartMs, decodeVerifyLink, encodeLineDisclosure, lineCheck, lineOfQuote, makeLineDisclosure, type VerifyLink } from "./disclosure.ts";
import { lineTreeOf } from "./lines.ts";
import { encodePublicProof, proofHash, verifyProof, type OnChainProof } from "./proof.ts";
import { NVIDIA_JWKS_URL, allChecksPassed, runLinkChecks, type ProofFetch } from "./proofLink.ts";
import { NETWORK_CONFIG } from "../network.ts";
import type { TranscriptLine } from "../meeting.ts";

// A real version 2 bundle from the notes pipeline (made with the test kit on 2 Nov 2026, before
// line trees existed): apps/desktop/scripts/make-sample-proof.ts.
const sample = JSON.parse(readFileSync(new URL("../../../../apps/desktop/src/sampleProof.json", import.meta.url), "utf8")) as { bundle: ProofBundleV2 };
const OLD_HASH = "6b450663ddd3a82b84cc012576ab67ac12e0aa8aa3caca6c1cc29981231ec437";

const KEY = "5a".repeat(32);
const transcript: TranscriptLine[] = [
  { at: 3, speaker: "you", text: "Let's ship the export fix on Thursday, and send Sam the recap tonight." },
  { at: 9, speaker: "others", text: "Thursday works. I'll look out for the recap." },
  { at: 14, speaker: "you", text: "The budget is forty thousand, keep it between us." },
];
// The same bundle with a line tree, as a new proof has; NVIDIA's token left out so no NVIDIA keys are needed.
const bundle: ProofBundleV2 = {
  ...sample.bundle,
  meetingId: "1793006441",
  evidence: sample.bundle.evidence.map(({ nvidiaToken: _, ...e }) => e),
  lineTree: lineTreeOf(transcript, KEY),
};
const place = { network: "testnet" as const, contract: "wallet.aftercall.testnet", owner: "ada.testnet" };
const onChain = (hash: string): OnChainProof => ({ proof_hash: hash, model: bundle.summaryModel, recorded_at: "1793006500000000000" });

/** NEAR's RPC and NVIDIA's keys, stood in for; records what was asked. */
function stub(answer: OnChainProof | null | "down"): { fetch: ProofFetch; asked: { url: string; args?: unknown; account?: string }[] } {
  const asked: { url: string; args?: unknown; account?: string }[] = [];
  const fetch: ProofFetch = async (url, init) => {
    if (url === NVIDIA_JWKS_URL) {
      asked.push({ url });
      return { ok: false, json: async () => ({}) };
    }
    const params = JSON.parse(init?.body ?? "{}").params;
    asked.push({ url, args: JSON.parse(atob(params.args_base64)), account: params.account_id });
    if (answer === "down") throw new Error("network down");
    return { ok: true, json: async () => ({ result: { result: [...utf8ToBytes(JSON.stringify(answer))] } }) };
  };
  return { fetch, asked };
}

const lineLink = (index: number) => `https://getaftercall.vercel.app/verify#${encodeLineDisclosure(makeLineDisclosure(place, bundle, transcript, KEY, index))}`;

test("a proof made before line trees hashes and checks exactly as before", () => {
  assert.equal(proofHash(sample.bundle), OLD_HASH);
  assert.equal("lineTree" in sample.bundle, false);
  assert.deepEqual(
    verifyProof(sample.bundle, onChain(OLD_HASH)).map((c) => [c.id, c.ok]),
    [
      ["on-chain", true],
      ["matches", true],
      ["signed", true],
      ["attested", true],
      ["compose", true],
      ["e2ee", true],
      ["confidential", true],
    ],
  );
  assert.equal(canShareLines(sample.bundle, KEY), false);
  assert.throws(() => makeLineDisclosure(place, sample.bundle, transcript, KEY, 0), /NO_LINE_TREE/);
});

test("the line tree is inside the proof hash: changing the root changes what NEAR must hold", () => {
  assert.notEqual(proofHash(bundle), OLD_HASH);
  const other = { ...bundle, lineTree: lineTreeOf(transcript.slice(0, 2), KEY) };
  assert.notEqual(proofHash(other), proofHash(bundle));
  assert.equal(canShareLines(bundle, KEY), true);
  assert.equal(canShareLines(bundle, undefined), false, "no key on this Mac, no link");
});

test("a line link carries the proof, one line, its salt and its path, in the fragment only", () => {
  const link = lineLink(1);
  const fragment = link.slice(link.indexOf("#") + 1);
  assert.ok(fragment.startsWith(LINE_LINK_PREFIX));
  assert.match(fragment.slice(LINE_LINK_PREFIX.length), /^[A-Za-z0-9_-]+$/, "base64url, no query string");
  assert.equal(new URL(link).search, "");
  const json = Buffer.from(fragment.slice(LINE_LINK_PREFIX.length), "base64url").toString();
  assert.ok(json.includes("Thursday works"), "the shared line");
  assert.ok(!json.includes("export fix") && !json.includes("forty thousand"), "no other line");
  assert.ok(!json.includes(KEY), "never the key the salts come from");

  for (const form of [link, `#${fragment}`, fragment]) {
    const read = decodeVerifyLink(form);
    assert.equal(read.kind, "line");
    if (read.kind !== "line") continue;
    assert.equal(proofHash(read.proof.bundle), proofHash(bundle));
    assert.deepEqual({ ...read.proof, bundle: undefined }, { ...place, bundle: undefined });
    assert.deepEqual({ ...read.line.line, salt: undefined }, { index: 1, ...transcript[1], salt: undefined });
    assert.equal(lineCheck(read.proof.bundle, read.line).ok, true);
  }
});

test("a proof link still reads as a proof link", () => {
  const read = decodeVerifyLink(`#${encodePublicProof({ ...place, bundle: sample.bundle })}`);
  assert.equal(read.kind, "proof");
  assert.equal(proofHash(read.proof.bundle), OLD_HASH);
});

test("a damaged link is refused, a line that can't be shown included", () => {
  const good = lineLink(0);
  const read = decodeVerifyLink(good) as Extract<VerifyLink, { kind: "line" }>;
  const withLine = (line: unknown) => `#${LINE_LINK_PREFIX}${Buffer.from(JSON.stringify({ ...read.proof, line, path: read.line.path })).toString("base64url")}`;
  assert.equal(decodeVerifyLink(withLine(read.line.line)).kind, "line");
  for (const line of [{ ...read.line.line, text: { html: "<b>" } }, { ...read.line.line, speaker: "Ada" }, { ...read.line.line, at: "3" }, null]) {
    assert.throws(() => decodeVerifyLink(withLine(line)), /BAD_LINK/);
  }
  for (const bad of ["", "#", "#line=", "#line=@@@", `#line=${Buffer.from("{}").toString("base64url")}`, good.slice(0, good.length - 40), "#bm90IGpzb24"]) {
    assert.throws(() => decodeVerifyLink(bad), /BAD_LINK/, bad.slice(0, 20));
  }
});

test("the line check says why a line doesn't belong", () => {
  const read = decodeVerifyLink(lineLink(2)) as Extract<VerifyLink, { kind: "line" }>;
  const changed = { ...read.line, line: { ...read.line.line, text: "The budget is fifty thousand, keep it between us." } };
  assert.match(lineCheck(bundle, changed).detail, /something in the link was changed/);
  assert.match(lineCheck(sample.bundle, read.line).detail, /made before Aftercall could share lines/);
  assert.match(lineCheck(bundle, { ...read.line, line: { ...read.line.line, index: 9 } }).detail, /outside the transcript's 3 lines/);
  assert.match(lineCheck(bundle, read.line).detail, /^Its salted hash and 1 sibling hash lead to the proof's transcript root [0-9a-f]{12}… \(3 lines\)$/);
  const first = decodeVerifyLink(lineLink(0)) as Extract<VerifyLink, { kind: "line" }>;
  assert.match(lineCheck(bundle, first.line).detail, /^Its salted hash and 2 sibling hashes lead to the proof's transcript root [0-9a-f]{12}… \(3 lines\)$/);
});

test("an honest line link passes every check /verify runs, against NEAR", async () => {
  const s = stub(onChain(proofHash(bundle)));
  const r = await runLinkChecks(decodeVerifyLink(lineLink(1)), s.fetch);
  assert.deepEqual(r.checks.map((c) => [c.id, c.ok]), [
    ["line", true],
    ["on-chain", true],
    ["matches", true],
    ["signed", true],
    ["attested", true],
    ["compose", true],
    ["e2ee", true],
    ["confidential", true],
  ]);
  assert.equal(allChecksPassed(bundle, r.checks), true);
  const rpc = s.asked.find((a) => a.url === NETWORK_CONFIG.testnet.rpcUrl);
  assert.deepEqual(rpc?.args, { owner: "ada.testnet", meeting_id: "1793006441" }, "the owner and meeting from the link");
  assert.equal(rpc?.account, "wallet.aftercall.testnet");
});

test("a line link fails when NEAR holds another hash, has no proof, can't be read, or the line was changed", async () => {
  const link = decodeVerifyLink(lineLink(1));
  const fails = async (answer: OnChainProof | null | "down", l: VerifyLink = link) => {
    const r = await runLinkChecks(l, stub(answer).fetch);
    assert.equal(allChecksPassed(bundle, r.checks), false);
    return { failed: r.checks.filter((c) => !c.ok).map((c) => c.id), rpcError: r.rpcError };
  };
  assert.deepEqual((await fails(onChain("00".repeat(32)))).failed, ["matches"]);
  assert.deepEqual((await fails(null)).failed, ["on-chain", "matches"]);
  assert.deepEqual(await fails("down"), { failed: ["on-chain", "matches"], rpcError: "network down" });
  const read = link as Extract<VerifyLink, { kind: "line" }>;
  const changed: VerifyLink = { ...read, line: { ...read.line, line: { ...read.line.line, speaker: "you" } } };
  assert.deepEqual((await fails(onChain(proofHash(bundle)), changed)).failed, ["line"]);
  // A forged root: the line checks against it, but the bundle no longer matches NEAR.
  const forgedTree = lineTreeOf([{ at: 9, speaker: "others", text: "I agree to pay double." }], KEY);
  const forged = makeLineDisclosure(place, { ...bundle, lineTree: forgedTree }, [{ at: 9, speaker: "others", text: "I agree to pay double." }], KEY, 0);
  assert.deepEqual((await fails(onChain(proofHash(bundle)), decodeVerifyLink(encodeLineDisclosure(forged)))).failed, ["matches"]);
});

test("a link naming another contract doesn't check out: that contract, not NEAR, would say who recorded it", async () => {
  // Someone's own contract can answer get_proof with any hash for any owner, so a line can be put in anyone's name.
  const elsewhere = { ...place, contract: "proofs.mallory.testnet", owner: "victor.testnet" };
  const link = decodeVerifyLink(encodeLineDisclosure(makeLineDisclosure(elsewhere, bundle, transcript, KEY, 2)));
  const r = await runLinkChecks(link, stub(onChain(proofHash(bundle))).fetch);
  assert.deepEqual(r.checks.filter((c) => !c.ok).map((c) => c.id), ["contract"]);
  assert.equal(allChecksPassed(bundle, r.checks), false);
  assert.match(r.checks.find((c) => c.id === "contract")!.detail, /^proofs\.mallory\.testnet isn't Aftercall's contract on testnet \(wallet\.aftercall\.testnet\)/);
  // Aftercall has no mainnet contract yet, so no mainnet link checks out.
  const mainnet = decodeVerifyLink(encodePublicProof({ network: "mainnet", contract: "wallet.aftercall.near", owner: "victor.near", bundle }));
  const m = await runLinkChecks(mainnet, stub(onChain(proofHash(bundle))).fetch);
  assert.match(m.checks.find((c) => c.id === "contract")!.detail, /^Aftercall has no contract on mainnet yet/);
  assert.equal(allChecksPassed(bundle, m.checks), false);
});

test("a proof whose NVIDIA token can't be checked says so, as /verify does", async () => {
  const r = await runLinkChecks(decodeVerifyLink(encodePublicProof({ ...place, bundle: sample.bundle })), stub(onChain(OLD_HASH)).fetch);
  const gpu = r.checks.find((c) => c.id === "gpu");
  assert.deepEqual([gpu?.ok, gpu?.detail], [false, "Couldn't get NVIDIA's signing keys"]);
});

test("an action item's quote leads to the line it was said in", () => {
  assert.equal(lineOfQuote(transcript, { quote: "look out for the recap", at: 9 }), 1);
  assert.equal(lineOfQuote(transcript, { quote: "send Sam the  recap tonight", at: 3 }), 0, "spacing doesn't matter");
  assert.equal(lineOfQuote(transcript, { quote: "look out for the recap", at: 3 }), null, "said at another time");
});

test("a link is never made from a transcript that no longer gives the proof's root", () => {
  assert.throws(() => makeLineDisclosure(place, bundle, transcript.slice(0, 2), KEY, 0), /LINE_TREE_MISMATCH/);
  assert.throws(() => makeLineDisclosure(place, bundle, transcript, undefined, 0), /NO_LINE_TREE/);
});

test("a shared line names the side and the time, never a person", () => {
  assert.equal(lineSpeakerWords("you"), "The person who recorded, on their microphone");
  assert.equal(lineSpeakerWords("others"), "The call's audio: someone on the other side");
  assert.equal(recordingStartMs("1793006441"), 1793006441000, "a real recording's id is its start second");
  assert.equal(recordingStartMs("sample-test-proof"), null);
});
