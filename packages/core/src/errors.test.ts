import { test } from "node:test";
import assert from "node:assert/strict";
import { NEAR_AI_CREDIT_MESSAGE, NEAR_AI_KEY_MESSAGE, NEAR_AI_RATE_MESSAGE, e2eeStaleKey, isNearAiAccountError, nearAiErrorText, nearAiStatus, plainNearAiError } from "./errors.ts";

// The two transports' formats: Node "NEAR AI 402: body", Rust "NEAR AI 402 Payment Required: body".
const node = (status: number, body: string) => new Error(`NEAR AI ${status}: ${body}`);
const rust = (status: string, body: string) => `NEAR AI ${status}: ${body}`;

test("401 and 403: the key wasn't accepted", () => {
  assert.equal(plainNearAiError(node(401, '{"error":"invalid api key"}')), NEAR_AI_KEY_MESSAGE);
  assert.equal(plainNearAiError(rust("401 Unauthorized", "")), NEAR_AI_KEY_MESSAGE);
  assert.equal(plainNearAiError(rust("403 Forbidden", "insufficient permissions")), NEAR_AI_KEY_MESSAGE, "insufficient permissions is about the key, not credit");
});

test("402, or credit and spend-limit words with a 4xx status: out of credit", () => {
  assert.equal(plainNearAiError(node(402, "")), NEAR_AI_CREDIT_MESSAGE);
  assert.equal(plainNearAiError(rust("402 Payment Required", '{"detail":"payment required"}')), NEAR_AI_CREDIT_MESSAGE);
  assert.equal(plainNearAiError(node(400, '{"error":{"message":"Insufficient credits"}}')), NEAR_AI_CREDIT_MESSAGE);
  assert.equal(plainNearAiError(rust("403 Forbidden", "API key spend limit exceeded")), NEAR_AI_CREDIT_MESSAGE);
  assert.equal(plainNearAiError(node(429, '{"error":{"code":"insufficient_quota"}}')), NEAR_AI_CREDIT_MESSAGE);
  assert.equal(NEAR_AI_CREDIT_MESSAGE, "Your NEAR AI credit has run out, or this key's spend limit was reached. Add credit at cloud.near.ai or use another key.");
});

test("429: rate limited, wait a minute", () => {
  assert.equal(plainNearAiError(rust("429 Too Many Requests", "rate limit exceeded")), NEAR_AI_RATE_MESSAGE);
  assert.match(NEAR_AI_RATE_MESSAGE, /Wait a minute/);
});

test("anything else keeps its own message", () => {
  assert.equal(plainNearAiError(node(500, "upstream error")), "NEAR AI 500: upstream error");
  assert.equal(plainNearAiError(new Error("Secure hardware check failed for Whisper (TDX). Nothing was sent.")), "Secure hardware check failed for Whisper (TDX). Nothing was sent.");
  assert.equal(plainNearAiError("NVIDIA NRAS 429: slow down"), "NVIDIA NRAS 429: slow down", "only NEAR AI's own errors are mapped");
  assert.equal(plainNearAiError(new Error("We used up our credit card limit")), "We used up our credit card limit");
  assert.equal(plainNearAiError(node(500, "Internal error: credit service unavailable")), "NEAR AI 500: Internal error: credit service unavailable", "a 5xx is NEAR AI's failure, not your credit");
  assert.equal(isNearAiAccountError(node(503, "credit service unavailable")), false);
});

test("account errors are told apart from a refused request", () => {
  assert.equal(nearAiStatus(rust("402 Payment Required", "")), 402);
  assert.equal(nearAiStatus("timeout"), null);
  assert.equal(isNearAiAccountError(node(400, "encryption not supported for this model")), false);
  assert.equal(plainNearAiError(node(400, "encryption not supported for this model")), "NEAR AI 400: encryption not supported for this model", "a plain E2EE refusal stays a refusal");
  assert.equal(isNearAiAccountError(node(400, "insufficient credit")), true);
  assert.equal(isNearAiAccountError(node(429, "")), true);
});

test("e2eeStaleKey: only the 421 that asks for a fresh attestation", () => {
  assert.equal(e2eeStaleKey(rust("421 Misdirected Request", '{"error":{"message":"The encryption key is no longer valid. Please refresh your attestation report and retry."}}')), true);
  for (const other of [node(421, "wrong host"), node(400, "The encryption key is no longer valid."), new Error("fetch failed")]) assert.equal(e2eeStaleKey(other), false, String(other));
});

test("nearAiErrorText: the message inside the body, short", () => {
  assert.equal(nearAiErrorText(rust("400 Bad Request", '{"error":{"message":"bad format","type":"x"}}')), "bad format");
  assert.equal(nearAiErrorText(node(422, '{"detail":"no"}')), "no");
  assert.equal(nearAiErrorText(node(413, "too large")), "too large");
  assert.equal(nearAiErrorText(node(400, "x".repeat(300))).length, 200);
});
