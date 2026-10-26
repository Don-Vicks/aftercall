import { test } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { processRecording, type NearAiTransport, type ProcessInput } from "./pipeline.ts";
import { sha256Hex } from "./verify.ts";

/** A fake NEAR AI that behaves like the real API: attests, transcribes, answers and signs. */
function fakeNearAi(opts: { notes: object; tamper?: boolean; unattested?: boolean }) {
  const priv = secp256k1.utils.randomPrivateKey();
  const address = `0x${bytesToHex(keccak_256(secp256k1.getPublicKey(priv, false).slice(1)).slice(-20))}`;
  const sign = (m: string) => {
    const b = utf8ToBytes(m);
    const s = secp256k1.sign(keccak_256(new Uint8Array([...utf8ToBytes(`\x19Ethereum Signed Message:\n${b.length}`), ...b])), priv);
    return `0x${bytesToHex(s.toCompactRawBytes())}${(27 + s.recovery).toString(16)}`;
  };
  const calls: string[] = [];
  let lastChat = { request: "", response: "" };
  let nonceCounter = 0;
  const transport: NearAiTransport = {
    randomHex: () => `nonce${++nonceCounter}`,
    async transcribe(path, _model, prompt) {
      calls.push(`transcribe ${path} [${prompt}]`);
      const text = path.includes("mic")
        ? "Send Ada the recap after this call, and pay the designer the fifty dollar deposit today."
        : "Great, I'll look out for the recap.";
      return JSON.stringify({ text, segments: [{ start: path.includes("mic") ? 4 : 9, end: 8, text }] });
    },
    async chat(body) {
      calls.push("chat");
      const response = JSON.stringify({ id: "chatcmpl-42", choices: [{ message: { content: JSON.stringify(opts.notes) } }] });
      lastChat = { request: body, response };
      return response;
    },
    async get(path) {
      calls.push(`get ${path.split("?")[0]}`);
      if (path.startsWith("attestation/report")) {
        const nonce = new URLSearchParams(path.split("?")[1]).get("nonce");
        return JSON.stringify({
          model_attestations: [{ request_nonce: nonce, signing_address: opts.unattested ? "0x0" : address, intel_quote: "q", nvidia_payload: "p" }],
        });
      }
      const response = opts.tamper ? `${lastChat.response} ` : lastChat.response;
      const text = `Qwen/Qwen3.8-27B:${sha256Hex(utf8ToBytes(lastChat.request))}:${sha256Hex(utf8ToBytes(response))}`;
      return JSON.stringify({ text, signature: sign(text), signing_address: address });
    },
  };
  return { transport, calls, address };
}

const notes = {
  title: "Sync with Ada",
  summary: "Recap to Ada and a 50 USDC deposit for the designer.",
  decisions: [],
  action_items: [{ text: "Send Ada the recap", owner: "Victor", due: "today", evidence: "Send Ada the recap after this call" }],
  followups: [
    { type: "email", to_name: "Ada", subject: "Recap", evidence: "Send Ada the recap after this call" },
    { type: "payment", payee_name: "Designer", amount_words: "fifty dollar", memo: "deposit", evidence: "pay the designer the fifty dollar deposit today" },
    { type: "payment", payee_name: "Designer", amount_words: "five thousand", memo: null, evidence: "the full five thousand when the deck is done" },
  ],
};

const input: ProcessInput = {
  id: "1793006441",
  project: "Fundraise",
  startedAt: "Today 10:20",
  durationSec: 10,
  chunkSeconds: 300,
  chunks: [
    { path: "/r/mic-000.wav", speaker: "you", index: 0 },
    { path: "/r/system-000.wav", speaker: "others", index: 0 },
  ],
  payees: [{ name: "Designer", account: "designer.near" }],
  vocabulary: ["Ada", "Designer", "Fundraise"],
};

const noWait = async () => {};

test("a recording becomes verified notes with only quote-backed follow-ups", async () => {
  const ai = fakeNearAi({ notes });
  const stages: string[] = [];
  const result = await processRecording(ai.transport, input, (s) => stages.push(s), noWait);

  assert.deepEqual([...new Set(stages)], ["attest", "transcribe", "summarise", "signature"]);
  assert.equal(result.signature.ok, true);
  assert.equal(result.meeting.verified, true);
  assert.equal(result.meeting.transcript.length, 2);
  assert.deepEqual(result.meeting.transcript.map((l) => l.speaker), ["you", "others"]);
  assert.equal(result.meeting.followUps.length, 2, "the invented 5,000 payment is dropped");
  assert.equal(result.dropped[0].text, "Pay Designer five thousand");
  assert.ok(ai.calls.includes("transcribe /r/mic-000.wav [Ada, Designer, Fundraise]"), "names go to Whisper as the prompt");
  assert.equal(result.proof.attestedSigners[0], ai.address);
  assert.equal(result.proof.signature.signing_address, ai.address);
});

test("a response that doesn't match the signature is not verified", async () => {
  const result = await processRecording(fakeNearAi({ notes, tamper: true }).transport, input, undefined, noWait);
  assert.equal(result.meeting.verified, false);
  assert.deepEqual(result.signature.reasons, ["RESPONSE_HASH_MISMATCH"]);
});

test("a signer that wasn't attested is not verified", async () => {
  const result = await processRecording(fakeNearAi({ notes, unattested: true }).transport, input, undefined, noWait);
  assert.equal(result.meeting.verified, false);
  assert.ok(result.signature.reasons.includes("SIGNER_NOT_ATTESTED"));
});

test("a model reply outside the schema stops processing", async () => {
  const bad = fakeNearAi({ notes: { title: "x" } });
  await assert.rejects(processRecording(bad.transport, input, undefined, noWait));
});
