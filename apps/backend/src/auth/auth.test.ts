import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { ed25519 } from "@noble/curves/ed25519";
import { base58, base64 } from "@scure/base";
import { nep413Hash, verifySignature, type SignedMessage } from "./nep413";
import { AuthService, type Challenge, type KeyChecker } from "./auth.service";
import { AuthController } from "./auth.controller";

const SECRET = "x".repeat(32);

function wallet() {
  const secretKey = ed25519.utils.randomPrivateKey();
  const publicKey = `ed25519:${base58.encode(ed25519.getPublicKey(secretKey))}`;
  const sign = (c: Challenge, accountId = "victor.testnet"): SignedMessage => ({
    accountId,
    publicKey,
    message: c.message,
    nonce: c.nonce,
    recipient: c.recipient,
    signature: base64.encode(ed25519.sign(nep413Hash(c.message, base64.decode(c.nonce), c.recipient), secretKey)),
  });
  return { publicKey, sign };
}

const onlyKey = (publicKey: string): KeyChecker => async (_account, key) => key === publicKey;

test("NEP-413 signatures verify and any change breaks them", () => {
  const w = wallet();
  const c: Challenge = { message: "Sign in to Aftercall", recipient: "aftercall", nonce: base64.encode(new Uint8Array(32).fill(7)) };
  const signed = w.sign(c);
  assert.equal(verifySignature(signed), true);
  assert.equal(verifySignature({ ...signed, message: "Sign in to something else" }), false);
  assert.equal(verifySignature({ ...signed, recipient: "evil" }), false);
  assert.equal(verifySignature({ ...signed, publicKey: wallet().publicKey }), false);
  assert.equal(verifySignature({ ...signed, callbackUrl: "https://x" }), false);
});

test("a signed challenge gives a session for the account", async () => {
  const w = wallet();
  const auth = new AuthService(onlyKey(w.publicKey), SECRET);
  const { token, accountId } = await auth.verify(w.sign(auth.challenge()));
  assert.equal(accountId, "victor.testnet");
  assert.equal(await auth.accountFor(token), "victor.testnet");
});

test("a challenge works once", async () => {
  const w = wallet();
  const auth = new AuthService(onlyKey(w.publicKey), SECRET);
  const signed = w.sign(auth.challenge());
  await auth.verify(signed);
  await assert.rejects(auth.verify(signed), /UNKNOWN_OR_EXPIRED_CHALLENGE/);
});

test("expired challenges are refused", async () => {
  const w = wallet();
  let now = 1_000_000;
  const auth = new AuthService(onlyKey(w.publicKey), SECRET, () => now);
  const signed = w.sign(auth.challenge());
  now += 6 * 60_000;
  await assert.rejects(auth.verify(signed), /UNKNOWN_OR_EXPIRED_CHALLENGE/);
});

test("a valid signature from a key that isn't a full-access key of the account is refused", async () => {
  const w = wallet();
  const auth = new AuthService(async () => false, SECRET);
  await assert.rejects(auth.verify(w.sign(auth.challenge())), /KEY_NOT_ON_ACCOUNT/);
});

test("forged session tokens are refused", async () => {
  const auth = new AuthService(async () => true, SECRET);
  const other = new AuthService(async () => true, "y".repeat(32));
  const w = wallet();
  const { token } = await other.verify(w.sign(other.challenge()));
  await assert.rejects(auth.accountFor(token), /BAD_SESSION/);
});

test("HTTP: challenge, verify, then /me", async () => {
  const w = wallet();
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [{ provide: AuthService, useValue: new AuthService(onlyKey(w.publicKey), SECRET) }],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();
  try {
    const challenge = (await request(app.getHttpServer()).get("/auth/challenge").expect(200)).body as Challenge;
    const verified = await request(app.getHttpServer()).post("/auth/verify").send(w.sign(challenge)).expect(200);
    const me = await request(app.getHttpServer()).get("/me").set("authorization", `Bearer ${verified.body.token}`).expect(200);
    assert.equal(me.body.accountId, "victor.testnet");
    await request(app.getHttpServer()).get("/me").expect(401);
  } finally {
    await app.close();
  }
});
