// node --experimental-strip-types --no-warnings=ExperimentalWarning apps/desktop/scripts/make-sample-proof.ts
//
// Writes apps/desktop/src/sampleProof.json: the proof the sample meeting's Verify sheet
// re-checks. It is made by the real notes pipeline (packages/core processRecording) run
// against a stand-in for NEAR AI built from the core test kit: test TEE keys, test
// Intel quotes and a local stand-in for NVIDIA's attestation service. Nothing is sent
// anywhere and nothing here came from NEAR AI. The call is two made-up lines.
//
// The Verify sheet says exactly that. When a proof from a real NEAR AI run can be
// published (one with no meeting content in it), replace the JSON and its `source`.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { edwardsToMontgomeryPriv } from "../../../packages/core/node_modules/@noble/curves/ed25519.js";
import { processRecording, type E2eeKeys, type NearAiTransport } from "../../../packages/core/src/notes/pipeline.ts";
import { verifyProof } from "../../../packages/core/src/notes/proof.ts";
import { sha256Hex } from "../../../packages/core/src/notes/verify.ts";
import { decryptWith, encryptTo } from "../../../packages/core/src/tee/e2ee.ts";
import { attestationFor, decodeQuote, fakeNras, teeKey } from "../../../packages/core/src/tee/testkit.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "sampleProof.json");

const LINES = {
  mic: "Let's ship the export fix on Thursday, and send Sam the recap tonight.",
  system: "Thursday works. I'll look out for the recap.",
};
const NOTES = {
  title: "Export fix check-in",
  summary: "The export fix ships on Thursday; you send Sam a recap tonight.",
  decisions: [{ text: "Ship the export fix on Thursday", evidence: "ship the export fix on Thursday" }],
  action_items: [{ text: "Send Sam the recap", owner: "You", due: "tonight", evidence: "send Sam the recap tonight" }],
  followups: [{ type: "email", to_name: "Sam", subject: "Recap: export fix on Thursday", evidence: "send Sam the recap tonight" }],
};
const YOUR_NOTES = "Thursday, not Friday.";

const nv = await fakeNras();
const gateway = teeKey("ed25519");
const summaryNode = teeKey("ed25519");
const whisperNode = teeKey("ecdsa");
let last = { request: "", response: "" };

const transport: NearAiTransport = {
  randomHex: () => sha256Hex(crypto.getRandomValues(new Uint8Array(32))),
  async get(path) {
    const q = new URLSearchParams(path.split("?")[1]);
    if (path.startsWith("attestation/report")) {
      const nonce = q.get("nonce")!;
      const node = q.get("model")!.startsWith("Qwen") ? summaryNode : whisperNode;
      return JSON.stringify({ gateway_attestation: attestationFor(gateway, nonce, { gpu: false }), model_attestations: [attestationFor(node, nonce)] });
    }
    const text = `Qwen/Qwen3.8-27B:${sha256Hex(last.request)}:${sha256Hex(last.response)}`;
    return JSON.stringify({ text, signature: summaryNode.sign(text), signing_address: summaryNode.address, signing_algo: "ed25519", signature_kind: "provider_tee" });
  },
  // Stands in for the Rust side's dcap-qvl verification: the test quote is its own report.
  verifyQuote: async (hex) => decodeQuote(hex),
  nvidiaAttest: async (payload) => JSON.stringify(await nv.answer(JSON.parse(payload).nonce)),
  nvidiaKeys: async () => JSON.stringify(nv.jwks),
  async transcribe(path) {
    const text = path.includes("mic") ? LINES.mic : LINES.system;
    return JSON.stringify({ text, segments: [{ start: path.includes("mic") ? 3 : 9, end: 8, text }] });
  },
  async chat(body: string, e2ee?: E2eeKeys) {
    if (!e2ee) throw new Error("the pipeline only sends encrypted");
    const user = (JSON.parse(body).messages as { content: string }[])[1].content;
    decryptWith(user, edwardsToMontgomeryPriv(summaryNode.seed!));
    const response = JSON.stringify({ id: "chatcmpl-sample", choices: [{ message: { content: encryptTo(JSON.stringify(NOTES), e2ee.clientPubKey) } }] });
    last = { request: body, response };
    return response;
  },
};

const result = await processRecording(
  transport,
  {
    id: "sample-test-proof",
    project: "Sample",
    startedAt: new Date().toISOString(),
    durationSec: 12,
    chunkSeconds: 300,
    chunks: [
      { path: "mic-000.wav", speaker: "you", index: 0 },
      { path: "system-000.wav", speaker: "others", index: 0 },
    ],
    payees: [],
    vocabulary: ["Sam"],
    yourNotes: YOUR_NOTES,
  },
  undefined,
  async () => {},
);

const failing = verifyProof(result.proof, null, result.notes, { text: result.meeting.yourNotes ?? "", salt: result.yourNotesSalt })
  .filter((c) => !c.ok && c.id !== "on-chain" && c.id !== "matches")
  .map((c) => c.id);
if (failing.length) throw new Error(`the sample proof doesn't re-check: ${failing.join(", ")}`);

const fixture = {
  source: "test-kit",
  madeAt: result.proof.checkedAt,
  bundle: result.proof,
  notes: result.notes,
  yourNotes: result.meeting.yourNotes ?? "",
  yourNotesSalt: result.yourNotesSalt,
};
writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${out} (${result.proof.checks.length} recorded checks)`);
