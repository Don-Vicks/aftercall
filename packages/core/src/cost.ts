/**
 * What a run probably cost in NEAR AI credit. An estimate from NEAR AI's published
 * prices and the token usage it reports, never a bill: the real charge is on
 * cloud.near.ai. Kept out of the proof bundle, which says what was checked, not what it cost.
 */

/** The day the prices below were read. */
export const PRICES_AS_OF = "2026-11-01";
export const PRICES_SOURCE = "https://cloud-api.near.ai/v1/model/list";

/** US dollars per million tokens. Reasoning tokens are billed as output. */
export const CHAT_PRICES: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  "Qwen/Qwen3.8-27B": { inputPerMillion: 0.04, outputPerMillion: 1.35 },
  "Qwen/Qwen3.6-35B-A3B-FP8": { inputPerMillion: 0.17, outputPerMillion: 1.1 },
};

/** openai/whisper-large-v3 is billed per started second of audio. */
export const WHISPER_USD_PER_SECOND = 0.000_000_01;

/** The `usage` object of an OpenAI-style chat completion, as NEAR AI returns it. */
export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

export interface ChatCost {
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** Already counted inside completionTokens; shown on its own because it can dominate. */
  reasoningTokens?: number;
  usd: number;
}

export interface CostEstimate {
  /** Total in US dollars; null when NEAR AI didn't report token usage for a chat call. */
  usd: number | null;
  /** Seconds of audio sent to Whisper in this run (cached chunks were paid for earlier). */
  whisperSeconds: number;
  whisperUsd: number;
  chat?: ChatCost;
  pricesAsOf: string;
}

const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/**
 * One chat call's cost from its reported usage. Null without usage or for a model
 * with no price here. OpenAI-style usage counts reasoning tokens inside
 * completion_tokens, so they are billed as output once, not added again.
 */
export function chatCost(model: string, usage: Usage | null | undefined): ChatCost | null {
  const price = CHAT_PRICES[model];
  if (!price || !usage || typeof usage.prompt_tokens !== "number" || typeof usage.completion_tokens !== "number") return null;
  const promptTokens = count(usage.prompt_tokens);
  const completionTokens = count(usage.completion_tokens);
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  return {
    model,
    promptTokens,
    completionTokens,
    ...(typeof reasoning === "number" ? { reasoningTokens: count(reasoning) } : {}),
    usd: (promptTokens * price.inputPerMillion + completionTokens * price.outputPerMillion) / 1_000_000,
  };
}

/** Whisper's price for this many seconds of audio, rounded up to whole seconds. */
export function whisperCost(seconds: number): number {
  return Math.ceil(Math.max(0, seconds)) * WHISPER_USD_PER_SECOND;
}

/**
 * The estimate for one run: Whisper seconds sent this time, plus at most one chat
 * call. `chat.usage` undefined means the call happened but NEAR AI reported no usage.
 */
export function estimateCost(parts: { whisperSeconds?: number; chat?: { model: string; usage?: Usage | null } }): CostEstimate {
  const whisperSeconds = Math.ceil(Math.max(0, parts.whisperSeconds ?? 0));
  const whisperUsd = whisperCost(whisperSeconds);
  const chat = parts.chat ? chatCost(parts.chat.model, parts.chat.usage) : null;
  return {
    usd: parts.chat && !chat ? null : whisperUsd + (chat?.usd ?? 0),
    whisperSeconds,
    whisperUsd,
    ...(chat ? { chat } : {}),
    pricesAsOf: PRICES_AS_OF,
  };
}

/**
 * Several estimates as one, e.g. every meeting this week. Unknown if any part is.
 * Token counts are summed only when every chat call used the same model.
 */
export function sumCosts(list: CostEstimate[]): CostEstimate {
  const whisperSeconds = list.reduce((s, c) => s + c.whisperSeconds, 0);
  const whisperUsd = list.reduce((s, c) => s + c.whisperUsd, 0);
  const usd = list.some((c) => c.usd === null) ? null : list.reduce((s, c) => s + (c.usd ?? 0), 0);
  const chats = list.flatMap((c) => (c.chat ? [c.chat] : []));
  const oneModel = chats.length > 0 && chats.every((c) => c.model === chats[0].model);
  const reasoned = chats.filter((c) => c.reasoningTokens !== undefined);
  const chat: ChatCost | undefined = oneModel
    ? {
        model: chats[0].model,
        promptTokens: chats.reduce((s, c) => s + c.promptTokens, 0),
        completionTokens: chats.reduce((s, c) => s + c.completionTokens, 0),
        ...(reasoned.length ? { reasoningTokens: reasoned.reduce((s, c) => s + (c.reasoningTokens ?? 0), 0) } : {}),
        usd: chats.reduce((s, c) => s + c.usd, 0),
      }
    : undefined;
  const asOf = list.map((c) => c.pricesAsOf).sort()[0] ?? PRICES_AS_OF;
  return { usd, whisperSeconds, whisperUsd, ...(chat ? { chat } : {}), pricesAsOf: asOf };
}

/**
 * A tiny dollar figure people can read: "about $0.0042", "about $0.09",
 * "less than $0.0001". Two significant figures below a cent, so it's never "$0.00".
 */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.0001) return "less than $0.0001";
  if (usd >= 0.01) return `about $${usd.toFixed(2)}`;
  return `about $${Number(usd.toPrecision(2)).toFixed(Math.max(4, 1 - Math.floor(Math.log10(usd))))}`;
}

/** One line for a meeting or an answer: "Estimated cost: about $0.0042 (NEAR AI prices as of 2026-11-01)". */
export function costLine(cost: CostEstimate): string {
  if (cost.usd === null) return "Estimated cost unknown: NEAR AI didn't report how many tokens the reply used";
  return `Estimated cost: ${formatCost(cost.usd)} (NEAR AI prices as of ${cost.pricesAsOf})`;
}
