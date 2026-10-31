import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { MissingKeyError, apiKeyFrom, isAllowedGetPath, nodeNearAiTransport } from "./nearai.ts";
import { formatSampleNotes, runSampleNotes } from "./sampleNotes.ts";
import type { NearAiTransport } from "../notes/pipeline.ts";
import { sha256Hex } from "../notes/verify.ts";
import { encryptTo } from "../tee/e2ee.ts";
import { attestationFor, decodeQuote, fakeNras, teeKey } from "../tee/testkit.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..", "..");
const samples = join(repo, "samples");

test("no key: a clear error before anything is sent", () => {
  assert.throws(() => apiKeyFrom({}), MissingKeyError);
  assert.throws(() => apiKeyFrom({ NEAR_AI_API_KEY: "  " }), /NEAR_AI_API_KEY=.*\.env/);
  assert.equal(apiKeyFrom({ NEAR_AI_API_KEY: ' "Bearer sk-test-123" ' }), "sk-test-123");
  assert.equal(apiKeyFrom({ NEARAI_API_KEY: "sk-dev" }), "sk-dev");
});

test("pnpm sample:notes without a key exits 1 and says how to fix it", () => {
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(here, "..", "..", "scripts", "sample-notes.ts")], {
    // Set but empty, so a developer's own .env can't supply a key and make this test call NEAR AI.
    env: { PATH: process.env.PATH, NEAR_AI_API_KEY: "", NEARAI_API_KEY: "" },
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /No NEAR AI API key\. Put NEAR_AI_API_KEY=/);
  assert.equal(run.stdout, "");
});

test("only the attestation report and signatures can be read, as in the Rust transport", () => {
  assert.ok(isAllowedGetPath("attestation/report?model=x&nonce=ab"));
  assert.ok(isAllowedGetPath("signature/chatcmpl-1?model=x"));
  assert.ok(!isAllowedGetPath("models"));
  assert.ok(!isAllowedGetPath("signature/../workspaces"));
  assert.ok(!isAllowedGetPath("signature/x?u=https://evil"));
});

async function body(req: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of req) parts.push(c as Buffer);
  return Buffer.concat(parts);
}

test("the Node transport sends what nearai.rs sends and returns the exact bytes", async () => {
  const seen: { method: string; url: string; headers: IncomingMessage["headers"]; body: Buffer }[] = [];
  // Exact bytes matter: odd spacing and a non-ASCII character must come back unchanged.
  const chatReply = '{"id":"chatcmpl-1",  "choices":[{"message":{"content":"café"}}]}';
  const server = createServer(async (req, res) => {
    seen.push({ method: req.method!, url: req.url!, headers: req.headers, body: await body(req) });
    if (req.url === "/v1/chat/completions") return res.end(chatReply);
    if (req.url === "/v1/audio/transcriptions") return res.end('{"text":"hi"}');
    if (req.url?.startsWith("/v1/signature/")) return res.writeHead(404).end("not yet");
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  try {
    const t = nodeNearAiTransport({ apiKey: "sk-test", baseUrl: `http://127.0.0.1:${port}/v1` });

    const request = '{"model":"Qwen/Qwen3.8-27B","messages":[]}';
    assert.equal(await t.chat(request), chatReply);
    const chat = seen.at(-1)!;
    assert.equal(chat.body.toString(), request, "the request body is sent byte for byte");
    assert.equal(chat.headers.authorization, "Bearer sk-test");
    assert.equal(chat.headers["accept-encoding"], "identity");
    assert.equal(chat.headers["x-no-aliasing"], "true");

    const wav = join(samples, "designer-kickoff", "mic-000.wav");
    assert.equal(await t.transcribe(wav, "openai/whisper-large-v3", "Ines, Designer"), '{"text":"hi"}');
    const upload = seen.at(-1)!;
    const form = upload.body.toString("latin1");
    assert.match(String(upload.headers["content-type"]), /^multipart\/form-data/);
    assert.match(form, /name="file"; filename="mic-000.wav"\r\nContent-Type: audio\/wav/);
    assert.match(form, /name="model"\r\n\r\nopenai\/whisper-large-v3/);
    assert.match(form, /name="response_format"\r\n\r\nverbose_json/);
    assert.match(form, /name="prompt"\r\n\r\nInes, Designer/);
    assert.ok(upload.body.length > readFileSync(wav).length, "the whole file is uploaded");

    await assert.rejects(t.get("signature/chatcmpl-1?model=x"), /NEAR AI 404: not yet/);
    await assert.rejects(t.get("models"), /Not an allowed NEAR AI path/);
    assert.equal(seen.filter((s) => s.url === "/v1/models").length, 0, "a refused path is never requested");
    assert.match(t.randomHex(), /^[0-9a-f]{64}$/);
  } finally {
    server.close();
  }
});

/**
 * A fake NEAR AI that "transcribes" each stem from the sample's script and otherwise
 * behaves like the real API: real keys bound in quotes, GPU tokens signed by a fake
 * NRAS, the reply encrypted to our key, the exchange signed (see tee/testkit.ts).
 */
async function fakeNearAi(notes: object): Promise<NearAiTransport> {
  const nv = await fakeNras();
  const gateway = teeKey("ed25519");
  const summary = teeKey("ed25519");
  const whisper = teeKey("ecdsa");
  let last = { request: "", response: "" };
  let n = 0;
  return {
    randomHex: () => (++n).toString(16).padStart(64, "0"),
    async transcribe(path) {
      const script = JSON.parse(readFileSync(join(dirname(path), "script.json"), "utf8")) as { lines: { at: number; speaker: string; text: string }[] };
      const speaker = path.endsWith("mic-000.wav") ? "you" : "others";
      const segments = script.lines.filter((l) => l.speaker === speaker).map((l) => ({ start: l.at, end: l.at + 3, text: ` ${l.text}` }));
      return JSON.stringify({ text: segments.map((s) => s.text).join(""), segments });
    },
    async chat(request, e2ee) {
      const content = e2ee ? encryptTo(JSON.stringify(notes), e2ee.clientPubKey) : JSON.stringify(notes);
      const response = JSON.stringify({ id: "chatcmpl-sample", choices: [{ message: { content } }] });
      last = { request, response };
      return response;
    },
    async get(path) {
      const q = new URLSearchParams(path.split("?")[1]);
      if (path.startsWith("attestation/report")) {
        const nonce = q.get("nonce")!;
        const node = q.get("model")!.startsWith("Qwen") ? summary : whisper;
        return JSON.stringify({ gateway_attestation: attestationFor(gateway, nonce, { gpu: false }), model_attestations: [attestationFor(node, nonce)] });
      }
      const text = `Qwen/Qwen3.8-27B:${sha256Hex(last.request)}:${sha256Hex(last.response)}`;
      return JSON.stringify({ text, signature: summary.sign(text), signing_address: summary.address, signing_algo: "ed25519", signature_kind: "provider_tee" });
    },
    verifyQuote: async (hex) => decodeQuote(hex),
    nvidiaAttest: async (payload) => JSON.stringify(await nv.answer(JSON.parse(payload).nonce)),
    nvidiaKeys: async () => JSON.stringify(nv.jwks),
  };
}

test("the designer sample yields the 40 dollar deposit, the recap and the action items, verified", async () => {
  const notes = {
    title: "Website kickoff with Ines",
    summary: "Home and booking pages first. A 40 dollar deposit today.",
    decisions: [{ text: "Home and booking pages first", evidence: "the home page and the booking page come first" }],
    action_items: [
      { text: "Send three style directions", owner: "Ines", due: "Friday", evidence: "I'll send you three style directions by Friday" },
      { text: "Share logo files and photos", owner: "You", due: "Wednesday", evidence: "I'll share our logo files and the workshop photos by Wednesday" },
    ],
    followups: [
      { type: "email", to_name: "Ines", subject: "Recap: website kickoff", evidence: "I'll email you a short recap after this call" },
      { type: "payment", payee_name: "Designer", amount_words: "40 dollar", memo: "deposit", evidence: "I'll send the 40 dollar deposit to the designer today" },
      { type: "payment", payee_name: "Designer", amount_words: "four hundred", memo: null, evidence: "the full four hundred on sign off" },
    ],
  };
  const stages: string[] = [];
  const { script, result } = await runSampleNotes(await fakeNearAi(notes), join(samples, "designer-kickoff"), (s) => stages.push(s), async () => {});

  assert.deepEqual([...new Set(stages)], ["attest", "transcribe", "summarise", "signature"]);
  assert.equal(result.meeting.verified, true);
  assert.equal(result.meeting.transcript[0].speaker, "others", "Ines speaks first, on the call-audio stem");
  const pay = result.meeting.followUps.find((f) => f.kind === "payment");
  assert.ok(pay && pay.kind === "payment");
  assert.equal(pay.amount, 40_000_000n, "40.00 USDC, read from the spoken words");
  assert.equal(pay.payeeAccount, "designer.near");
  assert.equal(result.meeting.actionItems.length, 2);
  assert.equal(result.dropped.length, 1, "the invented four hundred is dropped");

  const text = formatSampleNotes(script, result);
  assert.match(text, /Pay Designer \(designer\.near\) 40\.00 USDC, heard "40 dollar"/);
  assert.match(text, /Recap email to Ines/);
  assert.match(text, /Transcript end-to-end encrypted to the attested summary model: yes/);
  assert.doesNotMatch(text, /FAIL/, "every check passes");
  assert.match(text, /Dropped .*\n- follow-up: Pay Designer four hundred/);
});

test("every sample has two 16 kHz mono 16-bit stems and a script that covers both speakers", () => {
  for (const id of ["designer-kickoff", "team-checkin"]) {
    for (const stem of ["mic-000.wav", "system-000.wav"]) {
      const wav = readFileSync(join(samples, id, stem));
      assert.equal(wav.toString("ascii", 0, 4), "RIFF");
      assert.deepEqual([wav.readUInt16LE(22), wav.readUInt32LE(24), wav.readUInt16LE(34)], [1, 16_000, 16], `${id}/${stem}`);
      assert.ok(wav.length < 2_500_000, `${id}/${stem} stays small`);
    }
    const script = JSON.parse(readFileSync(join(samples, id, "script.json"), "utf8")) as { seconds: number; lines: { speaker: string }[] };
    assert.ok(script.seconds >= 55 && script.seconds <= 90, `${id} is about a minute`);
    assert.ok(script.lines.some((l) => l.speaker === "you") && script.lines.some((l) => l.speaker === "others"));
  }
});
