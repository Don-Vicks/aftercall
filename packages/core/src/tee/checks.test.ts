import { test } from "node:test";
import assert from "node:assert/strict";
import { sha384 } from "@noble/hashes/sha512";
import { bytesToHex } from "@noble/hashes/utils";
import { sha256Hex } from "../notes/verify.ts";
import { cpuChecks, expectedMrConfig, expectedReportData, replayRtmr3, responseChecks, signerOf, verifyEd25519, type TeeCheck } from "./checks.ts";
import { attestationFor, COMPOSE, quoteFor, randomNonce, teeKey } from "./testkit.ts";

const failed = (checks: TeeCheck[]) => checks.filter((c) => !c.ok).map((c) => c.id);
const where = { scope: "model" as const, model: "Qwen/Qwen3.8-27B" };

test("report data binds an ECDSA address right-padded, then the nonce", () => {
  const nonce = "ab".repeat(32);
  const rd = expectedReportData("0x" + "11".repeat(20), nonce);
  assert.equal(rd, "11".repeat(20) + "00".repeat(12) + nonce);
});

test("report data binds a whole Ed25519 key, then the nonce", () => {
  const nonce = "cd".repeat(32);
  assert.equal(expectedReportData("22".repeat(32), nonce), "22".repeat(32) + nonce);
});

test("with a TLS fingerprint, report data binds sha256(identity || fingerprint)", () => {
  const rd = expectedReportData("11".repeat(20), "00".repeat(32), "33".repeat(32));
  assert.equal(rd.slice(0, 64), sha256Hex(Uint8Array.from([...Array(20).fill(0x11), ...Array(32).fill(0x33)])));
});

test("mr_config is 0x01, sha256 of the compose, then 15 zero bytes", () => {
  const m = expectedMrConfig(sha256Hex(COMPOSE));
  assert.equal(m.length, 96);
  assert.ok(m.startsWith(`01${sha256Hex(COMPOSE)}`));
  assert.ok(m.endsWith("00".repeat(15)));
});

test("RTMR3 replay follows the docs' formula and only IMR 3", () => {
  const type = Uint8Array.from([1, 0, 0, 8]); // 134217729 little-endian
  const d = sha384(Uint8Array.from([...type, 58, ...new TextEncoder().encode("app-id"), 58, 0xab, 0xcd]));
  const expected = sha384(Uint8Array.from([...new Uint8Array(48), ...d]));
  const r = replayRtmr3([
    { imr: 1, event_type: 7, event: "ignored", event_payload: "" },
    { imr: 3, event_type: 134217729, event: "app-id", event_payload: "abcd", digest: bytesToHex(d) },
  ]);
  assert.deepEqual(r, { rtmr3: bytesToHex(expected), events: 1, badDigest: null });
  assert.equal(replayRtmr3([{ imr: 3, event_type: 1, event: "x", event_payload: "", digest: "00" }]).badDigest, 0);
});

test("a genuine TEE passes every CPU check", () => {
  const key = teeKey("ed25519");
  const nonce = randomNonce();
  const att = attestationFor(key, nonce);
  const checks = cpuChecks(att, nonce, quoteFor(key, nonce), null, where);
  assert.deepEqual(failed(checks), []);
  assert.deepEqual(checks.map((c) => c.id.replace("model-Qwen/Qwen3.8-27B-", "")), ["tdx", "debug", "binds-key", "binds-nonce", "rtmr3", "compose"]);
});

test("OutOfDate TCB passes as NEAR's verifier allows; Revoked or a failed quote doesn't", () => {
  const key = teeKey("ecdsa");
  const nonce = randomNonce();
  const att = attestationFor(key, nonce);
  assert.deepEqual(failed(cpuChecks(att, nonce, quoteFor(key, nonce, { status: "OutOfDate" }), null, where)), []);
  assert.ok(failed(cpuChecks(att, nonce, quoteFor(key, nonce, { status: "Revoked" }), null, where)).some((id) => id.endsWith("-tdx")));
  const none = cpuChecks(att, nonce, null, "Intel PCS: timeout", where);
  assert.ok(none.every((c) => !c.ok), "nothing passes without a verified quote");
  assert.match(none[0].detail, /Intel PCS: timeout/);
});

test("each binding failure is caught by its own check", () => {
  const key = teeKey("ecdsa");
  const nonce = randomNonce();
  const att = attestationFor(key, nonce);
  const ids = (q: ReturnType<typeof quoteFor>, a = att, n = nonce) => failed(cpuChecks(a, n, q, null, { scope: "gateway" }));
  assert.deepEqual(ids(quoteFor(key, nonce, { tdAttributes: "0100000000000000" })), ["gateway-debug"]);
  assert.deepEqual(ids(quoteFor(teeKey("ecdsa"), nonce)), ["gateway-binds-key"], "someone else's key");
  assert.deepEqual(ids(quoteFor(key, randomNonce())), ["gateway-binds-nonce"], "a replayed quote");
  assert.deepEqual(ids(quoteFor(key, nonce), { ...att, request_nonce: randomNonce() }), ["gateway-binds-nonce"]);
  assert.deepEqual(ids(quoteFor(key, nonce, { rtMr3: "00".repeat(48) })), ["gateway-rtmr3"]);
  assert.deepEqual(ids(quoteFor(key, nonce, { mrConfigId: expectedMrConfig(sha256Hex("other")) })), ["gateway-compose"]);
  assert.deepEqual(ids(quoteFor(key, nonce), { ...att, event_log: undefined }), ["gateway-rtmr3"]);
  assert.deepEqual(ids(quoteFor(key, nonce), { ...att, info: {} }), ["gateway-compose"]);
});

const req = '{"model":"Qwen/Qwen3.8-27B","messages":[]}';
const res = '{"id":"chatcmpl-1","choices":[]}';
const MODEL = "Qwen/Qwen3.8-27B";

for (const algo of ["ecdsa", "ed25519"] as const) {
  test(`${algo}: a model TEE signature over our exact bytes, by an attested key, passes`, () => {
    const k = teeKey(algo);
    const text = `${MODEL}:${sha256Hex(req)}:${sha256Hex(res)}`;
    const sig = { text, signature: k.sign(text), signing_address: k.address, signing_algo: algo, signature_kind: "provider_tee" };
    const r = responseChecks({ sig, algo, requestBody: req, responseBody: res, model: MODEL, modelSigners: [k.address], gatewaySigners: [] });
    assert.deepEqual(failed(r.checks), []);
    assert.equal(r.signer, k.address);
  });

  test(`${algo}: changed bytes, another model, or an unattested key fail`, () => {
    const k = teeKey(algo);
    const text = `${MODEL}:${sha256Hex(req)}:${sha256Hex(res)}`;
    const sig = { text, signature: k.sign(text), signing_address: k.address, signature_kind: "provider_tee" };
    const run = (over: Partial<Parameters<typeof responseChecks>[0]>) =>
      failed(responseChecks({ sig, algo, requestBody: req, responseBody: res, model: MODEL, modelSigners: [k.address], gatewaySigners: [], ...over }).checks);
    assert.deepEqual(run({ responseBody: `${res} ` }), ["response-response"]);
    assert.deepEqual(run({ requestBody: `${req} ` }), ["response-request"]);
    assert.deepEqual(run({ model: "Qwen/Other" }), ["response-model"]);
    assert.deepEqual(run({ modelSigners: [teeKey(algo).address] }), ["response-signer"]);
    assert.deepEqual(run({ modelSigners: [], gatewaySigners: [k.address] }), ["response-signer"], "a model signature can't be vouched for by the gateway");
  });
}

test("a gateway signature must come from the attested gateway key", () => {
  const gw = teeKey("ed25519");
  const text = `${sha256Hex(req)}:${sha256Hex(res)}`;
  const sig = { text, signature: gw.sign(text), signing_address: gw.address, signature_kind: "gateway" };
  const ok = responseChecks({ sig, algo: "ed25519", requestBody: req, responseBody: res, model: MODEL, modelSigners: [], gatewaySigners: [gw.address] });
  assert.deepEqual(failed(ok.checks), []);
  assert.ok(!ok.checks.some((c) => c.id === "response-model"), "gateway text names no model");
  const bad = responseChecks({ sig, algo: "ed25519", requestBody: req, responseBody: res, model: MODEL, modelSigners: [gw.address], gatewaySigners: [] });
  assert.deepEqual(failed(bad.checks), ["response-signer"]);
});

test("Ed25519 signatures verify against the claimed key only", () => {
  const k = teeKey("ed25519");
  const other = teeKey("ed25519");
  const s = k.sign("hello");
  assert.ok(verifyEd25519("hello", s, k.address));
  assert.ok(verifyEd25519("hello", `0x${s}`, k.address));
  assert.ok(verifyEd25519("hello", Buffer.from(s, "hex").toString("base64"), k.address));
  assert.ok(!verifyEd25519("hello!", s, k.address));
  assert.equal(signerOf({ text: "hello", signature: s, signing_address: other.address }, "ed25519"), null);
  assert.equal(signerOf({ text: "hello", signature: s, signing_address: k.address }, "ed25519"), k.address);
});
