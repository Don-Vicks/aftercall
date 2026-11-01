import { test } from "node:test";
import assert from "node:assert/strict";
import { edwardsToMontgomeryPriv } from "@noble/curves/ed25519";
import { ASK_MAX_CHARS, ASK_MAX_TOKENS, askMeetings, checkAnswer, pickExcerpts, questionTerms, type Excerpt } from "./ask.ts";
import type { Meeting, TranscriptLine } from "./meeting.ts";
import type { E2eeKeys, NearAiTransport } from "./notes/pipeline.ts";
import { sha256Hex } from "./notes/verify.ts";
import { decryptWith, encryptTo } from "./tee/e2ee.ts";
import { attestationFor, decodeQuote, fakeNras, teeKey } from "./tee/testkit.ts";

const NOW = new Date(2026, 10, 4, 18).getTime(); // Wednesday 4 November 2026
const idAt = (mo: number, d: number, h = 10) => String(new Date(2026, mo - 1, d, h).getTime() / 1000);
const line = (at: number, speaker: "you" | "others", text: string): TranscriptLine => ({ at, speaker, text });
const base = { project: "Fundraise", durationSec: 600, verified: true, summary: "", decisions: [], actionItems: [], followUps: [] };

const kickoff: Meeting = {
  ...base,
  id: idAt(11, 3),
  title: "Website kickoff with Ines",
  startedAt: "3 Nov 15:30",
  invited: [{ name: "Ines Rocha", email: "ines@example.com" }],
  transcript: [
    line(12, "you", "Thanks for taking this on. The booking page matters most to us."),
    line(728, "others", "I'll send you three style directions by Friday, and you pick one."),
    line(1121, "others", "We start with the home page and the booking page, then everything else."),
  ],
};

const sync: Meeting = {
  ...base,
  id: idAt(10, 26),
  title: "Sync with Ada",
  startedAt: "26 Oct 14:02",
  invited: [{ name: "Ada", email: "ada@example.com" }],
  followUps: [
    {
      id: "f2",
      kind: "payment",
      status: "paid",
      evidence: { quote: "pay the designer the fifty dollar deposit today", at: 134 },
      payeeName: "Designer",
      payeeAccount: "designer.near",
      amount: 50_000_000n,
      heard: "fifty dollar",
      payeeListed: true,
    },
  ],
  transcript: [
    line(31, "others", "The API fix has to ship before the demo. If it slips, we move the demo, not the fix."),
    line(134, "you", "Send Ada the recap after this call, and pay the designer the fifty dollar deposit today."),
  ],
};

const group: Meeting = {
  ...base,
  id: idAt(11, 2),
  title: "Weekly check-in",
  startedAt: "2 Nov 17:00",
  invited: [
    { name: "Theo Moss", email: "theo@example.com" },
    { name: "Mara Kade", email: "mara@example.com" },
  ],
  transcript: [line(40, "others", "Ines said the designs are late, but that's fine by me.")],
};

const meetings = [kickoff, sync, group];

test("questionTerms keeps the words that matter", () => {
  assert.deepEqual(questionTerms("What did Ines promise this week?"), ["ines", "promise"]);
  assert.deepEqual(questionTerms("Every payment I approved in October"), ["payment", "approved"]);
});

test("excerpts: a named person's own lines come only from calls with just them", () => {
  const { excerpts, meetings: n } = pickExcerpts(meetings, "What did Ines promise this week?", { now: NOW });
  assert.deepEqual(
    excerpts.map((e) => [e.meeting, e.at, e.who]),
    [
      ["Website kickoff with Ines", 728, "Ines Rocha"],
      ["Website kickoff with Ines", 1121, "Ines Rocha"],
      ["Weekly check-in", 40, "Others"],
    ],
    "Ines's lines from the kickoff, plus a group-call line that says 'Ines' (spoken by someone else)",
  );
  assert.equal(n, 2);
  assert.deepEqual(
    excerpts.map((e) => e.n),
    [1, 2, 3],
  );
});

test("excerpts: a month narrows the meetings; a payment question finds the payment's quote", () => {
  const { excerpts } = pickExcerpts(meetings, "Every payment I approved in October", { now: NOW });
  assert.deepEqual(
    excerpts.map((e) => [e.meetingId, e.at, e.who]),
    [[sync.id, 134, "You"]],
  );
});

test("excerpts are capped in number and length, cut around the words that matched", () => {
  const long = "word ".repeat(300) + "the invoice is due on the first " + "word ".repeat(300);
  const many: Meeting = {
    ...base,
    id: idAt(11, 1),
    title: "Long call",
    startedAt: "",
    transcript: Array.from({ length: 30 }, (_, i) => line(i * 10, "you", `invoice number ${i}`)).concat([line(999, "others", long)]),
  };
  const { excerpts } = pickExcerpts([many], "the invoice", { now: NOW });
  assert.equal(excerpts.length, 8);
  const cutOne = pickExcerpts([many], "invoice is due", { now: NOW, max: 1 }).excerpts[0];
  assert.ok(cutOne.text.length <= ASK_MAX_CHARS + 4, `${cutOne.text.length} characters`);
  assert.match(cutOne.text, /^… .*invoice is due.* …$/);
});

test("excerpts: nothing that matches means nothing to send", () => {
  assert.deepEqual(pickExcerpts(meetings, "What about the zebra budget?", { now: NOW }).excerpts, []);
  assert.deepEqual(pickExcerpts(meetings, "what did they say?", { now: NOW }).excerpts, []);
});

interface FakeOpts {
  reply: object | ((plaintext: string) => object);
  badGateway?: boolean;
  badModel?: boolean;
  e2eeRefused?: boolean;
  tamper?: boolean;
  usage?: object;
  finishReason?: string;
}

/** NEAR AI with real keys: attests, decrypts the request inside the "TEE", encrypts the reply, signs the exchange. */
async function fakeNearAi(opts: FakeOpts) {
  const nv = await fakeNras();
  const gateway = teeKey("ed25519");
  const node = teeKey("ed25519");
  const calls: string[] = [];
  const seenByGateway: string[] = [];
  const seenInTee: string[] = [];
  let last = { request: "", response: "" };
  let nonce = 0;
  const transport: NearAiTransport = {
    randomHex: () => (++nonce).toString(16).padStart(64, "0"),
    async get(path) {
      calls.push(`get ${path.split("?")[0]}`);
      if (path.startsWith("attestation/report")) {
        const q = new URLSearchParams(path.split("?")[1]);
        const n = q.get("nonce")!;
        return JSON.stringify({
          gateway_attestation: attestationFor(gateway, n, { gpu: false, quote: opts.badGateway ? { status: "Revoked" } : {} }),
          model_attestations: [attestationFor(node, n, { quote: opts.badModel ? { rtMr3: "00".repeat(48) } : {} })],
        });
      }
      const response = opts.tamper ? `${last.response} ` : last.response;
      const text = `Qwen/Qwen3.8-27B:${sha256Hex(last.request)}:${sha256Hex(response)}`;
      return JSON.stringify({ text, signature: node.sign(text), signing_address: node.address, signing_algo: "ed25519", signature_kind: "provider_tee" });
    },
    verifyQuote: async (hex) => decodeQuote(hex),
    nvidiaAttest: async (payload) => JSON.stringify(await nv.answer(JSON.parse(payload).nonce)),
    nvidiaKeys: async () => JSON.stringify(nv.jwks),
    async transcribe() {
      throw new Error("Ask never sends audio");
    },
    async chat(body: string, e2ee?: E2eeKeys) {
      calls.push(e2ee ? "chat e2ee" : "chat");
      seenByGateway.push(body);
      if (!e2ee) throw new Error("plaintext request");
      if (opts.e2eeRefused) throw new Error("NEAR AI 400 Bad Request: encryption not supported for this model");
      assert.equal(e2ee.modelPubKey, node.address, "pinned to the attested node");
      const user = (JSON.parse(body).messages as { content: string }[])[1].content;
      const plaintext = decryptWith(user, edwardsToMontgomeryPriv(node.seed!));
      seenInTee.push(plaintext);
      const reply = typeof opts.reply === "function" ? opts.reply(plaintext) : opts.reply;
      const response = JSON.stringify({
        id: "chatcmpl-ask",
        choices: [{ message: { content: encryptTo(JSON.stringify(reply), e2ee.clientPubKey) }, ...(opts.finishReason ? { finish_reason: opts.finishReason } : {}) }],
        ...(opts.usage ? { usage: opts.usage } : {}),
      });
      last = { request: body, response };
      return response;
    },
  };
  return { transport, calls, seenByGateway, seenInTee, node };
}

const noWait = async () => {};
const question = "What did Ines promise this week?";
const { excerpts } = pickExcerpts(meetings, question, { now: NOW });
const good = {
  found: true,
  answer: "Ines said they'd send three style directions by Friday and start with the home and booking pages.",
  quotes: [
    { excerpt: 1, quote: "“I'll send you three style directions by Friday”" },
    { excerpt: 2, quote: "We start with the home page and the booking page" },
    { excerpt: 2, quote: "Ines promised a full brand book by Monday" },
  ],
};

test("asks the attested TEE end-to-end encrypted and keeps only quotes found in the excerpts", async () => {
  const ai = await fakeNearAi({ reply: good });
  const events: string[] = [];
  const r = await askMeetings(ai.transport, { question, excerpts, now: NOW }, { onStage: (s) => events.push(s), onAnswer: () => events.push("answer") }, noWait);

  assert.deepEqual(events, ["attest", "send", "answer", "signature"], "the answer shows before the signature check");
  assert.equal(r.answer, good.answer);
  assert.deepEqual(
    r.quotes.map((q) => [q.n, q.quote, q.who]),
    [
      [1, "I'll send you three style directions by Friday", "Ines Rocha"],
      [2, "We start with the home page and the booking page", "Ines Rocha"],
    ],
  );
  assert.equal(r.dropped, 1, "the invented brand book quote is dropped");
  assert.equal(r.sent, 3);
  assert.equal(r.verified, true);
  assert.equal(r.modelKey, ai.node.address);
  assert.ok(r.checks.some((c) => c.id === "response-e2ee" && c.ok));
  assert.ok(r.checks.some((c) => c.id === "response-signer" && c.ok));

  assert.deepEqual(
    ai.calls.filter((c) => c.startsWith("chat")),
    ["chat e2ee"],
  );
  assert.match(ai.seenInTee[0], /^Today is Wednesday 4 Nov 2026\.\nQuestion: What did Ines promise this week\?/);
  assert.match(ai.seenInTee[0], /\[1\] Website kickoff with Ines · Yesterday 10:00 · 12:08 · Ines Rocha: I'll send you three style directions/, "times come from the recording, not the stored label");
  assert.ok(!ai.seenByGateway.join().includes("style directions"), "the gateway only relays ciphertext");
  assert.ok(!ai.seenByGateway.join().includes("Ines"), "not even the question");
  assert.ok(!ai.seenInTee[0].includes("booking page matters most"), "lines that weren't picked never leave");
});

test("an answer whose quotes are all invented isn't shown", async () => {
  const ai = await fakeNearAi({
    reply: {
      found: true,
      answer: "Ines promised a brand book.",
      quotes: [
        { excerpt: 1, quote: "a full brand book by Monday" },
        { excerpt: 9, quote: "I'll send you three style directions" },
      ],
    },
  });
  const r = await askMeetings(ai.transport, { question, excerpts }, {}, noWait);
  assert.equal(r.answer, null);
  assert.equal(r.found, false);
  assert.equal(r.dropped, 2, "a quote citing an excerpt that wasn't sent counts as invented too");
});

test("'your meetings don't say' needs no quote", async () => {
  const ai = await fakeNearAi({ reply: { found: false, answer: "Your meetings don't say what Ines promised.", quotes: [] } });
  const r = await askMeetings(ai.transport, { question, excerpts }, {}, noWait);
  assert.equal(r.found, false);
  assert.equal(r.answer, "Your meetings don't say what Ines promised.");
  assert.deepEqual(r.quotes, []);
});

test("nothing is sent when the gateway or the model TEE fails its check", async () => {
  for (const bad of [{ badGateway: true }, { badModel: true }]) {
    const ai = await fakeNearAi({ reply: good, ...bad });
    await assert.rejects(askMeetings(ai.transport, { question, excerpts }, {}, noWait), /Nothing was sent/);
    assert.ok(!ai.calls.some((c) => c.startsWith("chat")), JSON.stringify(bad));
  }
});

test("no unencrypted fallback when NEAR AI refuses E2EE", async () => {
  const ai = await fakeNearAi({ reply: good, e2eeRefused: true });
  await assert.rejects(askMeetings(ai.transport, { question, excerpts }, {}, noWait), /refused the encrypted request \(400\), so nothing else was sent/);
  assert.deepEqual(
    ai.calls.filter((c) => c.startsWith("chat")),
    ["chat e2ee"],
  );
});

test("a reply that doesn't match its signature is shown but not verified", async () => {
  const ai = await fakeNearAi({ reply: good, tamper: true });
  const r = await askMeetings(ai.transport, { question, excerpts }, {}, noWait);
  assert.equal(r.answer, good.answer);
  assert.equal(r.verified, false);
  assert.deepEqual(
    r.checks.filter((c) => !c.ok).map((c) => c.id),
    ["response-response"],
  );
});

test("no excerpts: no network at all", async () => {
  const nothing = new Proxy({} as NearAiTransport, {
    get: () => () => {
      throw new Error("no call expected");
    },
  });
  const r = await askMeetings(nothing, { question: "zebra budget", excerpts: [] }, {}, noWait);
  assert.equal(r.sent, 0);
  assert.equal(r.answer, null);
});

test("too many or too long excerpts are refused before anything is sent", async () => {
  const ai = await fakeNearAi({ reply: good });
  const huge: Excerpt = { ...excerpts[0], text: "x".repeat(2000) };
  await assert.rejects(askMeetings(ai.transport, { question, excerpts: [huge] }, {}, noWait), /Nothing was sent/);
  assert.deepEqual(ai.calls, []);
});

test("checkAnswer de-duplicates and keeps the excerpt's own spelling", () => {
  const r = checkAnswer(
    {
      found: true,
      answer: "x",
      quotes: [
        { excerpt: 2, quote: "we START with the home page" },
        { excerpt: 2, quote: "We start with the home page" },
      ],
    },
    excerpts,
  );
  assert.deepEqual(
    r.quotes.map((q) => q.quote),
    ["We start with the home page"],
  );
});

// ---------- the output cap and the cost estimate ----------

test("Ask is capped at ASK_MAX_TOKENS and reports its estimated cost", async () => {
  const ai = await fakeNearAi({ reply: good, usage: { prompt_tokens: 3_000, completion_tokens: 400 } });
  const r = await askMeetings(ai.transport, { question, excerpts, now: NOW }, {}, noWait);
  assert.equal(ASK_MAX_TOKENS, 6_144);
  assert.equal(JSON.parse(ai.seenByGateway[0]).max_tokens, 6_144);
  // 3,000 × $0.04/M + 400 × $1.35/M
  assert.ok(r.cost.usd !== null && Math.abs(r.cost.usd - 0.00066) < 1e-12, String(r.cost.usd));
  assert.equal(r.cost.whisperSeconds, 0);
  assert.equal(r.cost.chat?.promptTokens, 3_000);
});

test("Ask without usage from NEAR AI: cost unknown; with no excerpts: nothing sent, nothing spent", async () => {
  const ai = await fakeNearAi({ reply: good });
  assert.equal((await askMeetings(ai.transport, { question, excerpts, now: NOW }, {}, noWait)).cost.usd, null);
  const none = await askMeetings(ai.transport, { question, excerpts: [], now: NOW }, {}, noWait);
  assert.equal(none.cost.usd, 0);
});

test("an answer cut off at the cap isn't shown", async () => {
  const ai = await fakeNearAi({ reply: good, finishReason: "length" });
  let answered = false;
  await assert.rejects(
    askMeetings(ai.transport, { question, excerpts, now: NOW }, { onAnswer: () => (answered = true) }, noWait),
    { message: "The model's reply hit the 6,144-token limit, so the answer would be incomplete. Nothing is shown." },
  );
  assert.equal(answered, false);
});

test("Ask passes credit and key errors through so they can be said plainly", async () => {
  const ai = await fakeNearAi({ reply: good });
  const broke = { ...ai.transport, chat: async () => { throw new Error("NEAR AI 400: insufficient credits"); } };
  await assert.rejects(askMeetings(broke, { question, excerpts, now: NOW }, {}, noWait), /insufficient credits/, "not mistaken for a refused encrypted request");
});

// ---------- questions and quotes in other languages ----------

const tokyo: Meeting = {
  ...base,
  id: idAt(11, 3, 9),
  title: "デザイン定例",
  startedAt: "3 Nov 09:00",
  transcript: [
    line(20, "others", "ロゴの案は金曜日までに三つ送ります。"),
    line(95, "you", "デザイナーへの支払いは来週の月曜日にします。"),
  ],
};
const moscow: Meeting = {
  ...base,
  id: idAt(11, 2, 9),
  title: "Созвон по дизайну",
  startedAt: "2 Nov 09:00",
  transcript: [line(40, "others", "Мы заплатим дизайнеру 500 долларов в понедельник.")],
};

test("questionTerms finds words in languages written without spaces, and leaves English as it was", () => {
  assert.deepEqual(questionTerms("デザイナーへの支払いはいつ？"), ["デザイナー", "支払い"]);
  assert.deepEqual(questionTerms("设计师的付款是多少"), ["设计", "付款", "多少"]);
  assert.deepEqual(questionTerms("Когда заплатим дизайнеру?"), ["когда", "заплатим", "дизайнеру"]);
  assert.deepEqual(questionTerms("What did Ines promise this week?"), ["ines", "promise"]);
});

test("excerpts: a Japanese or Russian question finds the lines that answer it", () => {
  const ja = pickExcerpts([tokyo, moscow], "デザイナーへの支払いはいつ？", { now: NOW }).excerpts;
  assert.deepEqual(ja.map((e) => e.text), ["デザイナーへの支払いは来週の月曜日にします。"]);
  const ru = pickExcerpts([tokyo, moscow], "Сколько заплатим дизайнеру?", { now: NOW }).excerpts;
  assert.deepEqual(ru.map((e) => e.text), ["Мы заплатим дизайнеру 500 долларов в понедельник."]);
});

test("checkAnswer keeps quotes copied in the excerpt's language and drops translations", () => {
  const ex = pickExcerpts([tokyo, moscow], "デザイナー 支払い ロゴ дизайнеру", { now: NOW }).excerpts;
  const n = (text: string) => ex.find((e) => e.text.startsWith(text))!.n;
  const r = checkAnswer(
    {
      found: true,
      answer: "The designer is paid next Monday.",
      quotes: [
        { excerpt: n("デザイナー"), quote: "「デザイナーへの支払いは来週の月曜日」" },
        { excerpt: n("デザイナー"), quote: "payment to the designer is next Monday" },
        { excerpt: n("Мы"), quote: "ЗАПЛАТИМ ДИЗАЙНЕРУ 500 ДОЛЛАРОВ" },
        { excerpt: n("ロゴ"), quote: "つ送ります" },
      ],
    },
    ex,
  );
  assert.deepEqual(r.quotes.map((q) => q.quote), ["デザイナーへの支払いは来週の月曜日", "заплатим дизайнеру 500 долларов"]);
  assert.equal(r.dropped, 2, "the translation and the five-letter quote");
});
