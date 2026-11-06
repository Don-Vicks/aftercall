import { invoke } from "@tauri-apps/api/core";

/** The Aftercall backend (apps/backend): recap email and claim links. */
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3001";

/**
 * Whether this build has a backend to talk to: one built with VITE_BACKEND_URL, or the dev
 * server (which runs it locally). A release built without one, like the testnet build for
 * testers, hides Send through Aftercall, claim links and autopilot recaps; Draft in Mail and
 * payments to listed payees need no backend.
 */
export const HAS_BACKEND = Boolean(import.meta.env.VITE_BACKEND_URL) || import.meta.env.DEV;

let session: string | null = null;

async function call<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = `Bearer ${await token()}`;
  const res = await fetch(`${BACKEND_URL}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } }).catch(() => {
    throw new Error(`Can't reach the Aftercall backend at ${BACKEND_URL}.`);
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendly(body.message ?? `Backend ${res.status}`));
  return body as T;
}

function friendly(code: string): string {
  return (
    {
      EMAIL_NOT_CONFIGURED: "Sending through Aftercall isn't set up on this backend yet (it needs a Resend key). Use Draft in Mail instead.",
      KEY_NOT_ON_ACCOUNT: "The backend couldn't confirm this Mac's key on your account. Check Settings → NEAR.",
      DAILY_LIMIT: "You've reached today's limit of 50 emails sent through Aftercall.",
      BAD_ADDRESS: "That email address doesn't look right.",
      ALREADY_ISSUED: "This Mac already got Aftercall's test credits. Paste your own NEAR AI key instead.",
      TEST_CREDITS_USED_UP: "Aftercall's test credits are used up for now. Paste your own NEAR AI key instead.",
      TEST_CREDITS_OFF: "Test credits aren't set up on this backend. Paste your own NEAR AI key instead.",
      IP_DAILY_LIMIT: "Too many test keys from this network today. Try tomorrow, or paste your own NEAR AI key.",
    }[code] ?? (code.startsWith("NEAR_AI_FAILED") ? "NEAR AI didn't make the test key. Try again in a minute, or paste your own key." : code)
  );
}

/** Signs in with this Mac's NEAR key (NEP-413) and keeps the session for this run. */
async function token(): Promise<string> {
  if (session) return session;
  const challenge = await call<{ message: string; nonce: string; recipient: string }>("/auth/challenge", {}, false);
  const signed = await invoke<object>("near_sign_in_message", challenge);
  const { token } = await call<{ token: string }>("/auth/verify", { method: "POST", body: JSON.stringify(signed) }, false);
  session = token;
  return token;
}

/** What the backend keeps about a claim link: no names, memos or meeting titles. */
export interface ClaimInfo {
  id: string;
  amount: string;
  status: "open" | "claimed" | "cancelled";
  claimedAccount?: string;
  expiresAt: number;
}

export const backend = {
  sendRecap: (mail: { to: string; subject: string; text: string; html?: string; replyTo?: string; senderName?: string }) =>
    call<{ id: string }>("/email/recap", { method: "POST", body: JSON.stringify(mail) }),
  createClaim: (c: { amount: string }) =>
    call<{ id: string; token: string; expiresAt: number }>("/claims", { method: "POST", body: JSON.stringify(c) }),
  claims: () => call<ClaimInfo[]>("/claims"),
  cancelClaim: (id: string) => call<{ ok: true }>(`/claims/${id}`, { method: "DELETE" }),
};

/** A random id for this install, made once; the backend gives one test key per install. */
function installId(): string {
  const KEY = "aftercall.installId";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = `mac-${crypto.randomUUID()}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

/**
 * Aftercall's test credits: a NEAR AI key with a small spend limit, from Aftercall's own
 * NEAR AI workspace, for people without a NEAR AI account. No sign-in: the backend limits
 * it to one key per install, a few per network a day and a fixed number in all.
 */
export const testCredits = {
  status: () => call<{ available: boolean; spendLimitUsd: number }>("/nearai/test-credits", {}, false),
  key: () => call<{ key: string; spendLimitUsd: number }>("/nearai/test-key", { method: "POST", body: JSON.stringify({ installId: installId() }) }, false),
};
