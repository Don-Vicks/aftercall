import { test } from "node:test";
import assert from "node:assert/strict";
import { decryptPieces, parseChatStream } from "./stream.ts";
import { encryptTo, newClientKeys } from "../tee/e2ee.ts";
import { sseStream } from "../tee/testkit.ts";

test("a streamed reply is read back from its events: id, every piece in order, finish reason, last usage", () => {
  const usage = { prompt_tokens: 900, completion_tokens: 3 };
  const r = parseChatStream(sseStream(["{\"ti", "tle\":", "\"Sync\"}"], { id: "chatcmpl-7", usage }));
  assert.equal(r.id, "chatcmpl-7");
  assert.deepEqual(r.pieces, ['{"ti', 'tle":', '"Sync"}'], "the empty role-only first piece is skipped");
  assert.equal(r.finishReason, "stop");
  assert.deepEqual(r.usage, usage);
});

test("each piece is decrypted on its own, as NEAR AI's proxy encrypts each chunk on its own", () => {
  const client = newClientKeys();
  const body = sseStream(["naïve ", "café ", "日本語"], { encrypt: (p) => encryptTo(p, client.publicKey) });
  const r = parseChatStream(body);
  assert.ok(r.pieces.every((p) => /^[0-9a-f]+$/.test(p)), "only ciphertext on the wire");
  assert.equal(decryptPieces(r.pieces, client.x25519Secret), "naïve café 日本語");
  const tampered = r.pieces.map((p, i) => (i === 1 ? `${p.slice(0, -1)}${p.endsWith("0") ? "1" : "0"}` : p));
  assert.throws(() => decryptPieces(tampered, client.x25519Secret));
  assert.throws(() => decryptPieces(r.pieces, newClientKeys().x25519Secret), "a reply for another key doesn't open");
});

test("CRLF and CR line endings, comments and multi-line data are read as the SSE format says", () => {
  assert.deepEqual(parseChatStream(sseStream(["a", "b"], { lineEnd: "\r\n" })).pieces, ["a", "b"]);
  assert.deepEqual(parseChatStream(sseStream(["a", "b"], { lineEnd: "\r" })).pieces, ["a", "b"]);
  const withComment = `: keep-alive\n\n${sseStream(["x"])}`;
  assert.deepEqual(parseChatStream(withComment).pieces, ["x"], "a comment carries no data (the signature check is what rejects it)");
  const split = `data: {"id":"c1","choices":[{"index":0,\ndata: "delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n`;
  assert.deepEqual(parseChatStream(split).pieces, ["hi"], "data lines of one event join with a newline");
});

test("a stream that isn't a finished, consistent reply is refused", () => {
  assert.throws(() => parseChatStream(sseStream(["a"], { done: false })), /stopped before it was finished, so it wasn't signed/);
  assert.throws(() => parseChatStream(""), /didn't stream the reply/);
  assert.throws(() => parseChatStream('{"id":"x","choices":[]}'), /didn't stream the reply/, "a plain JSON body isn't a stream");
  assert.throws(() => parseChatStream(`${sseStream(["a"])}data: {"id":"chatcmpl-42","choices":[]}\n\n`), /more after the end/);
  assert.throws(() => parseChatStream(`${sseStream(["a"], { id: "one", done: false })}${sseStream(["b"], { id: "two" })}`), /different chat ids/);
  assert.throws(() => parseChatStream(`data: {"error":{"message":"Upstream request failed","type":"upstream_error"}}\n\ndata: [DONE]\n\n`), /stopped the reply partway: Upstream request failed/);
  assert.throws(() => parseChatStream(`data: not json\n\n`), /isn't JSON/);
  assert.throws(() => parseChatStream(`data: {"choices":[]}\n\ndata: [DONE]\n\n`), /no chat id/);
});

test("only the first choice is read, and a cut-off reply says so", () => {
  const body = `data: {"id":"c","choices":[{"index":1,"delta":{"content":"other"}},{"index":0,"delta":{"content":"mine"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n`;
  const r = parseChatStream(body);
  assert.deepEqual(r.pieces, ["mine"]);
  assert.equal(r.finishReason, "length");
});
