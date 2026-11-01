import { test } from "node:test";
import assert from "node:assert/strict";
import { PRICES_AS_OF, chatCost, costLine, estimateCost, formatCost, sumCosts, whisperCost } from "./cost.ts";

const close = (a: number | null | undefined, b: number) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < 1e-12, `${a} ≈ ${b}`);

test("chat cost: input and output tokens at the model's price per million", () => {
  // Qwen3.8-27B: $0.04 in, $1.35 out. 20,000 in + 1,500 out = 0.0008 + 0.002025.
  const c = chatCost("Qwen/Qwen3.8-27B", { prompt_tokens: 20_000, completion_tokens: 1_500 });
  assert.equal(c?.promptTokens, 20_000);
  assert.equal(c?.completionTokens, 1_500);
  close(c?.usd, 0.002825);
  // Qwen3.6-35B-A3B-FP8: $0.17 in, $1.10 out.
  close(chatCost("Qwen/Qwen3.6-35B-A3B-FP8", { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 })?.usd, 1.27);
});

test("reasoning tokens are billed as output once, inside completion_tokens", () => {
  const c = chatCost("Qwen/Qwen3.8-27B", { prompt_tokens: 0, completion_tokens: 10_000, completion_tokens_details: { reasoning_tokens: 8_000 } });
  assert.equal(c?.reasoningTokens, 8_000);
  close(c?.usd, 0.0135);
});

test("the cap's worst case: 65,536 uncapped output tokens is about $0.09", () => {
  close(chatCost("Qwen/Qwen3.8-27B", { prompt_tokens: 0, completion_tokens: 65_536 })?.usd, 0.0884736);
  assert.equal(formatCost(0.0884736), "about $0.09");
});

test("Whisper is billed per started second", () => {
  close(whisperCost(300), 0.000003);
  close(whisperCost(299.2), 0.000003);
  assert.equal(whisperCost(0), 0);
  assert.equal(whisperCost(-5), 0);
});

test("no usage reported means an unknown total, never a made-up one", () => {
  assert.equal(chatCost("Qwen/Qwen3.8-27B", undefined), null);
  assert.equal(chatCost("Qwen/Qwen3.8-27B", {} as never), null);
  assert.equal(chatCost("some/unpriced-model", { prompt_tokens: 1, completion_tokens: 1 }), null);
  const e = estimateCost({ whisperSeconds: 600, chat: { model: "Qwen/Qwen3.8-27B" } });
  assert.equal(e.usd, null);
  assert.equal(e.whisperSeconds, 600, "the Whisper part is still known");
  close(e.whisperUsd, 0.000006);
  assert.equal("chat" in e, false);
  assert.equal(costLine(e), "Estimated cost unknown: NEAR AI didn't report how many tokens the reply used");
});

test("an estimate adds Whisper and the chat call; nothing sent costs nothing", () => {
  const e = estimateCost({ whisperSeconds: 600, chat: { model: "Qwen/Qwen3.8-27B", usage: { prompt_tokens: 20_000, completion_tokens: 1_500 } } });
  close(e.usd, 0.002825 + 0.000006);
  assert.equal(e.pricesAsOf, PRICES_AS_OF);
  assert.deepEqual(estimateCost({}), { usd: 0, whisperSeconds: 0, whisperUsd: 0, pricesAsOf: PRICES_AS_OF });
});

test("sums: totals add up, one unknown makes the total unknown", () => {
  const a = estimateCost({ whisperSeconds: 300, chat: { model: "Qwen/Qwen3.8-27B", usage: { prompt_tokens: 1_000, completion_tokens: 100 } } });
  const b = estimateCost({ whisperSeconds: 100, chat: { model: "Qwen/Qwen3.8-27B", usage: { prompt_tokens: 2_000, completion_tokens: 200, completion_tokens_details: { reasoning_tokens: 50 } } } });
  const s = sumCosts([a, b]);
  close(s.usd, a.usd! + b.usd!);
  assert.equal(s.whisperSeconds, 400);
  assert.deepEqual([s.chat?.promptTokens, s.chat?.completionTokens, s.chat?.reasoningTokens], [3_000, 300, 50]);
  assert.equal(sumCosts([a, estimateCost({ chat: { model: "Qwen/Qwen3.8-27B" } })]).usd, null);
  assert.equal(sumCosts([]).usd, 0);
});

test("formatCost: enough figures to be non-zero, never $0.00 for a real charge", () => {
  assert.equal(formatCost(0.0042), "about $0.0042");
  assert.equal(formatCost(0.004213), "about $0.0042");
  assert.equal(formatCost(0.002831), "about $0.0028");
  assert.equal(formatCost(0.00042), "about $0.00042");
  assert.equal(formatCost(0.000006), "less than $0.0001");
  assert.equal(formatCost(0.0123), "about $0.01");
  assert.equal(formatCost(1.234), "about $1.23");
  assert.equal(formatCost(0), "$0.00");
  assert.equal(costLine(estimateCost({ chat: { model: "Qwen/Qwen3.8-27B", usage: { prompt_tokens: 20_000, completion_tokens: 2_500 } } })), "Estimated cost: about $0.0042 (NEAR AI prices as of 2026-11-01)");
});
