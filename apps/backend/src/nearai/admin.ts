import { randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { base58, base64 } from "@scure/base";
import { nep413Hash } from "../auth/nep413";

/*
 * Aftercall's own NEAR AI Cloud account, used for one thing: making a capped API
 * key for each tester, so they can try the app without a NEAR AI account.
 *
 * The account is a dedicated NEAR account whose only use is this. It signs in to
 * NEAR AI Cloud with NEP-413 ("Sign in to NEAR AI Cloud", recipient cloud.near.ai),
 * which NEAR AI accepts only from a full-access key, so the key lives in this
 * server's environment and nowhere else. The session is kept in memory: each
 * server instance signs in when it first needs to and again after an hour.
 * Keys are made in the workspace given, each with its own spend limit, so a
 * tester can't spend more than that and all of them together can't spend more
 * than the workspace's credits.
 */

/** Makes one NEAR AI API key. The real one calls cloud-api; tests use a fake. */
export interface NearAiAdmin {
  createKey(name: string, spendLimitUsd: number): Promise<{ id: string; key: string }>;
}

export interface CloudAdminConfig {
  /** e.g. https://cloud-api.near.ai */
  baseUrl: string;
  /** The dedicated NEAR account, e.g. aftercall-ai.near */
  accountId: string;
  /** Its full-access key, "ed25519:<base58>" as NEAR writes secret keys. */
  secretKey: string;
  /** The NEAR AI workspace the tester keys are made in. */
  workspaceId: string;
}

const LOGIN_MESSAGE = "Sign in to NEAR AI Cloud";
const LOGIN_RECIPIENT = "cloud.near.ai";
/** NEAR AI's access tokens last an hour; sign in again a little before. */
const SESSION_MS = 50 * 60 * 1000;

/** The 32-byte seed and public key from a NEAR secret key string. */
export function nearKeyPair(secretKey: string): { seed: Uint8Array; publicKey: string } {
  const [curve, data] = secretKey.split(":");
  if (curve !== "ed25519" || !data) throw new Error("NEARAI_ADMIN_KEY must be an ed25519 secret key");
  const bytes = base58.decode(data);
  if (bytes.length !== 64 && bytes.length !== 32) throw new Error("NEARAI_ADMIN_KEY has the wrong length");
  const seed = bytes.slice(0, 32);
  return { seed, publicKey: `ed25519:${base58.encode(ed25519.getPublicKey(seed))}` };
}

/** A NEP-413 nonce as NEAR AI wants it: the time in milliseconds (8 bytes, big-endian), then random bytes. */
export function loginNonce(now: number): Uint8Array {
  const nonce = new Uint8Array(32);
  new DataView(nonce.buffer).setBigUint64(0, BigInt(now), false);
  nonce.set(randomBytes(24), 8);
  return nonce;
}

/**
 * Test credits from one shared NEAR AI key instead: every install gets the same key, which
 * Aftercall's owner made in their NEAR AI dashboard. NEAR AI can't cap each tester, so the
 * spend limit set on that key in the dashboard is the only cap; the server's install, total
 * and per-IP limits still apply to who gets it.
 */
export function sharedKeyAdmin(key: string): NearAiAdmin {
  return {
    async createKey() {
      return { id: "shared", key };
    },
  };
}

export function cloudApiAdmin(config: CloudAdminConfig, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): NearAiAdmin {
  const { seed, publicKey } = nearKeyPair(config.secretKey);
  const base = config.baseUrl.replace(/\/+$/, "");
  let session: { token: string; at: number } | null = null;

  async function signIn(): Promise<string> {
    const nonce = loginNonce(now());
    const signature = ed25519.sign(nep413Hash(LOGIN_MESSAGE, nonce, LOGIN_RECIPIENT), seed);
    const res = await fetchImpl(`${base}/v1/auth/near`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        signed_message: { accountId: config.accountId, publicKey, signature: base64.encode(signature) },
        payload: { message: LOGIN_MESSAGE, nonce: [...nonce], recipient: LOGIN_RECIPIENT },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string };
    if (!res.ok || !body.access_token) throw new Error(`NEARAI_SIGN_IN ${res.status}`);
    session = { token: body.access_token, at: now() };
    return body.access_token;
  }

  async function token(): Promise<string> {
    return session && now() - session.at < SESSION_MS ? session.token : signIn();
  }

  async function post(token: string, name: string, spendLimitUsd: number) {
    return fetchImpl(`${base}/v1/workspaces/${encodeURIComponent(config.workspaceId)}/api-keys`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      // NEAR AI counts money in nano-dollars: $1.00 is 1,000,000,000.
      body: JSON.stringify({ name, spendLimit: { amount: Math.round(spendLimitUsd * 1e9), currency: "USD" } }),
    });
  }

  return {
    async createKey(name, spendLimitUsd) {
      let res = await post(await token(), name, spendLimitUsd);
      // A session NEAR AI no longer accepts: sign in once more and try again.
      if (res.status === 401) res = await post(await signIn(), name, spendLimitUsd);
      const body = (await res.json().catch(() => ({}))) as { id?: string; key?: string };
      // Only the status goes further: the body of a successful reply holds the key.
      if (!res.ok || !body.id || !body.key) throw new Error(`NEARAI_CREATE_KEY ${res.status}`);
      return { id: body.id, key: body.key };
    },
  };
}
