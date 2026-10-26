import { Injectable, UnauthorizedException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { base64 } from "@scure/base";
import { verifySignature, type SignedMessage } from "./nep413";

export const AUTH_RECIPIENT = "aftercall";
export const AUTH_MESSAGE = "Sign in to Aftercall";
const CHALLENGE_TTL_MS = 5 * 60_000;
const SESSION_TTL = "7d";

export interface Challenge {
  message: string;
  recipient: string;
  /** 32 random bytes, base64 */
  nonce: string;
}

/** Answers "is this public key a full-access key of this account?" against NEAR RPC. */
export type KeyChecker = (accountId: string, publicKey: string) => Promise<boolean>;

/**
 * Accepts the account's full-access keys, and Aftercall app keys: function-call
 * keys limited to the agent-wallet contract (`appContract`). Such a key can only
 * have been added by the account owner, for Aftercall.
 */
export function isAccepted(permission: unknown, appContract?: string): boolean {
  if (permission === "FullAccess") return true;
  if (!appContract || typeof permission !== "object" || permission === null) return false;
  const fc = (permission as { FunctionCall?: { receiver_id?: string } }).FunctionCall;
  return fc?.receiver_id === appContract;
}

export function rpcKeyChecker(rpcUrl: string, appContract?: string): KeyChecker {
  return async (accountId, publicKey) => {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "aftercall",
        method: "query",
        params: { request_type: "view_access_key", finality: "optimistic", account_id: accountId, public_key: publicKey },
      }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { result?: { permission?: unknown }; error?: unknown };
    return isAccepted(body.result?.permission, appContract);
  };
}

@Injectable()
export class AuthService {
  /** nonce -> expiry. Single use: a nonce is deleted the moment it is checked. */
  private readonly challenges = new Map<string, number>();
  private readonly secret: Uint8Array;

  constructor(
    private readonly isFullAccessKey: KeyChecker,
    jwtSecret: string,
    private readonly now: () => number = Date.now,
  ) {
    if (jwtSecret.length < 32) throw new Error("AUTH_JWT_SECRET must be at least 32 characters");
    this.secret = new TextEncoder().encode(jwtSecret);
  }

  challenge(): Challenge {
    this.sweep();
    const nonce = base64.encode(randomBytes(32));
    this.challenges.set(nonce, this.now() + CHALLENGE_TTL_MS);
    return { message: AUTH_MESSAGE, recipient: AUTH_RECIPIENT, nonce };
  }

  /** Verifies a signed challenge and returns a session token for the account. */
  async verify(signed: SignedMessage): Promise<{ token: string; accountId: string }> {
    const expires = this.challenges.get(signed.nonce);
    this.challenges.delete(signed.nonce);
    if (expires === undefined || expires < this.now()) throw new UnauthorizedException("UNKNOWN_OR_EXPIRED_CHALLENGE");
    if (signed.message !== AUTH_MESSAGE || signed.recipient !== AUTH_RECIPIENT) throw new UnauthorizedException("WRONG_MESSAGE");
    if (!verifySignature(signed)) throw new UnauthorizedException("BAD_SIGNATURE");
    if (!(await this.isFullAccessKey(signed.accountId, signed.publicKey))) throw new UnauthorizedException("KEY_NOT_ON_ACCOUNT");

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(signed.accountId)
      .setIssuedAt()
      .setExpirationTime(SESSION_TTL)
      .sign(this.secret);
    return { token, accountId: signed.accountId };
  }

  /** Returns the NEAR account a session token belongs to. */
  async accountFor(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { algorithms: ["HS256"] });
      if (!payload.sub) throw new Error("no subject");
      return payload.sub;
    } catch {
      throw new UnauthorizedException("BAD_SESSION");
    }
  }

  private sweep() {
    const now = this.now();
    for (const [nonce, expires] of this.challenges) if (expires < now) this.challenges.delete(nonce);
  }
}
