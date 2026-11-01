/**
 * NEAR AI errors in plain words. Both transports report a failed HTTP call as
 * "NEAR AI <status>…: <body>": Node as "NEAR AI 402: …" (node/nearai.ts), the Mac
 * app's Rust as "NEAR AI 402 Payment Required: …" (src-tauri/src/nearai.rs).
 */

const STATUS = /NEAR AI (\d{3})\b/;
// "insufficient" alone also covers "insufficient_quota" and "insufficient balance".
const CREDIT = /\bcredits?\b|spend(?:ing)?[ _-]?limit|insufficient(?![ _-]?(?:permission|scope|privilege))/i;

export const NEAR_AI_CREDIT_MESSAGE = "Your NEAR AI credit has run out, or this key's spend limit was reached. Add credit at cloud.near.ai or use another key.";
export const NEAR_AI_KEY_MESSAGE = "NEAR AI didn't accept this API key. Copy it again from cloud.near.ai, or use another key.";
export const NEAR_AI_RATE_MESSAGE = "NEAR AI is limiting how fast this key can make requests. Wait a minute, then try again.";

/** The HTTP status in a NEAR AI transport error, or null when it isn't one. */
export function nearAiStatus(e: unknown): number | null {
  const m = STATUS.exec(e instanceof Error ? e.message : String(e));
  return m ? Number(m[1]) : null;
}

/**
 * A 4xx whose body talks about credit or a spend limit. Only 4xx: a 500 that mentions
 * a "credit service" is NEAR AI's own failure, not your credit running out.
 */
function creditRefusal(status: number, message: string): boolean {
  return status >= 400 && status < 500 && CREDIT.test(message);
}

/** A NEAR AI answer about the key, its credit or its rate, rather than about the request. */
export function isNearAiAccountError(e: unknown): boolean {
  const status = nearAiStatus(e);
  if (status === null) return false;
  return [401, 402, 403, 429].includes(status) || creditRefusal(status, e instanceof Error ? e.message : String(e));
}

/** What to tell the person when a NEAR AI call fails. Anything else keeps its own message. */
export function plainNearAiError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const status = nearAiStatus(e);
  if (status === null) return message;
  if (status === 402 || creditRefusal(status, message)) return NEAR_AI_CREDIT_MESSAGE;
  if (status === 401 || status === 403) return NEAR_AI_KEY_MESSAGE;
  if (status === 429) return NEAR_AI_RATE_MESSAGE;
  return message;
}

/*
 * NEAR AI's answer about end-to-end encryption that the app recognises, as its gateway
 * words it (github.com/nearai/cloud-api, read 1 Nov 2026): 421 "The encryption key is no
 * longer valid…" when no node serves the pinned model key. Any other 4xx, a 400 about an
 * encryption header included, is a refusal of the request and stops processing; the
 * transcript is never resent without end-to-end encryption.
 */
const E2EE_STALE_KEY = /\bencryption key\b[^.]*\b(?:no longer valid|not valid|invalid)\b/i;

/**
 * True when NEAR AI answered 421 that the attested model key is no longer one it
 * serves. It asks for a fresh attestation, so the app attests again and retries
 * encrypted.
 */
export function e2eeStaleKey(e: unknown): boolean {
  if (nearAiStatus(e) !== 421) return false;
  return E2EE_STALE_KEY.test(e instanceof Error ? e.message : String(e));
}

/** The message in a NEAR AI error body ({"error":{"message":…}} or plain text), cut to 200 characters. */
export function nearAiErrorText(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const body = message.replace(/^NEAR AI \d{3}[^:]*:\s*/, "");
  let text = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown; detail?: unknown };
    const inner = typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? parsed.message ?? parsed.detail);
    if (typeof inner === "string") text = inner;
  } catch {
    // Not JSON: the body as it came.
  }
  text = text.trim();
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}
