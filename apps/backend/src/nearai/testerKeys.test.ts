import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { ed25519 } from "@noble/curves/ed25519";
import { base58, base64 } from "@scure/base";
import { cloudApiAdmin, loginNonce, nearKeyPair, type NearAiAdmin } from "./admin";
import { MemoryIssuedKeys, TesterKeys } from "./testerKeys";
import { TesterKeysController } from "./testerKeys.controller";
import { MemoryDailyCounts } from "../limits";
import { nep413Hash } from "../auth/nep413";

const INSTALL = "install-0123456789abcdef";
const OPTIONS = { spendLimitUsd: 0.25, maxKeys: 3, perIpPerDay: 2 };

function fakeAdmin(fail = false) {
  const made: { name: string; spendLimitUsd: number }[] = [];
  const admin: NearAiAdmin = {
    async createKey(name, spendLimitUsd) {
      if (fail) throw new Error("NEARAI_CREATE_KEY 402");
      made.push({ name, spendLimitUsd });
      return { id: `key-${made.length}`, key: `sk-test-${made.length}` };
    },
  };
  return { admin, made };
}

test("an install gets one capped key; asking again is refused", async () => {
  const { admin, made } = fakeAdmin();
  const keys = new TesterKeys(admin, new MemoryIssuedKeys(), new MemoryDailyCounts(), OPTIONS);
  assert.deepEqual(await keys.issue(INSTALL, "1.2.3.4"), { key: "sk-test-1", spendLimitUsd: 0.25 });
  assert.equal(made[0].spendLimitUsd, 0.25);
  assert.match(made[0].name, /^tester-[0-9a-f]{8}$/, "the key's name carries no install id");
  assert.ok(!made[0].name.includes(INSTALL));
  await assert.rejects(keys.issue(INSTALL, "5.6.7.8"), /ALREADY_ISSUED/);
});

test("the total cap, the per-IP daily cap and bad install ids are enforced", async () => {
  const { admin } = fakeAdmin();
  let now = 0;
  const keys = new TesterKeys(admin, new MemoryIssuedKeys(), new MemoryDailyCounts(), OPTIONS, () => now);
  await assert.rejects(keys.issue("short", "1.1.1.1"), /BAD_INSTALL_ID/);
  await assert.rejects(keys.issue(42, "1.1.1.1"), /BAD_INSTALL_ID/);
  await keys.issue("install-aaaaaaaaaaaaaaaa", "1.1.1.1");
  await keys.issue("install-bbbbbbbbbbbbbbbb", "1.1.1.1");
  await assert.rejects(keys.issue("install-cccccccccccccccc", "1.1.1.1"), /IP_DAILY_LIMIT/);
  now += 86_400_000;
  await keys.issue("install-cccccccccccccccc", "1.1.1.1");
  assert.deepEqual(await keys.status(), { available: false, spendLimitUsd: 0.25 });
  await assert.rejects(keys.issue("install-dddddddddddddddd", "9.9.9.9"), /TEST_CREDITS_USED_UP/);
});

test("without Aftercall's NEAR AI account set up, test credits say they're off", async () => {
  const keys = new TesterKeys(null, new MemoryIssuedKeys(), new MemoryDailyCounts(), OPTIONS);
  assert.deepEqual(await keys.status(), { available: false, spendLimitUsd: 0.25 });
  await assert.rejects(keys.issue(INSTALL, "1.2.3.4"), /TEST_CREDITS_OFF/);
});

test("a NEAR AI failure gives a plain code, and nothing is counted or kept", async () => {
  const { admin } = fakeAdmin(true);
  const issued = new MemoryIssuedKeys();
  const keys = new TesterKeys(admin, issued, new MemoryDailyCounts(), OPTIONS);
  await assert.rejects(keys.issue(INSTALL, "1.2.3.4"), /NEAR_AI_FAILED \(NEARAI_CREATE_KEY 402\)/);
  assert.equal(await issued.count(), 0);
});

test("over HTTP: the key comes back in the reply, and the first forwarded address is the one limited", async () => {
  const { admin } = fakeAdmin();
  const keys = new TesterKeys(admin, new MemoryIssuedKeys(), new MemoryDailyCounts(), { ...OPTIONS, perIpPerDay: 1 });
  const moduleRef = await Test.createTestingModule({ controllers: [TesterKeysController], providers: [{ provide: TesterKeys, useValue: keys }] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  const http = () => request(app.getHttpServer());
  assert.deepEqual((await http().get("/nearai/test-credits")).body, { available: true, spendLimitUsd: 0.25 });
  const first = await http().post("/nearai/test-key").set("x-forwarded-for", "7.7.7.7, 10.0.0.1").send({ installId: INSTALL });
  assert.equal(first.status, 200);
  assert.equal(first.body.key, "sk-test-1");
  const second = await http().post("/nearai/test-key").set("x-forwarded-for", "7.7.7.7, 10.0.0.2").send({ installId: "install-eeeeeeeeeeeeeeee" });
  assert.equal(second.status, 429);
  await app.close();
});

/*
 * The real client against a stand-in for NEAR AI's cloud-api: how it signs in,
 * what it asks for, and that it signs in again when the session is refused.
 */
test("the NEAR AI client signs in with NEP-413 and makes a key with a nano-dollar spend limit", async () => {
  const seed = new Uint8Array(32).fill(7);
  const secretKey = `ed25519:${base58.encode(new Uint8Array([...seed, ...ed25519.getPublicKey(seed)]))}`;
  const calls: { url: string; body: any; auth?: string }[] = [];
  let refuse = 1;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const auth = (init.headers as Record<string, string>).authorization;
    calls.push({ url, body, auth });
    if (url.endsWith("/v1/auth/near")) return Response.json({ access_token: `access-${calls.length}` });
    // The first key request finds the session expired.
    if (refuse-- > 0) return Response.json({}, { status: 401 });
    return Response.json({ id: "k1", key: "sk-real" }, { status: 201 });
  }) as typeof fetch;

  const admin = cloudApiAdmin({ baseUrl: "https://cloud.test/", accountId: "aftercall-ai.near", secretKey, workspaceId: "ws-1" }, fetchImpl, () => 1_700_000_000_000);
  assert.deepEqual(await admin.createKey("tester-abc", 0.25), { id: "k1", key: "sk-real" });

  assert.deepEqual(calls.map((c) => c.url), ["https://cloud.test/v1/auth/near", "https://cloud.test/v1/workspaces/ws-1/api-keys", "https://cloud.test/v1/auth/near", "https://cloud.test/v1/workspaces/ws-1/api-keys"]);
  const login = calls[0].body;
  assert.equal(login.payload.message, "Sign in to NEAR AI Cloud");
  assert.equal(login.payload.recipient, "cloud.near.ai");
  const nonce = Uint8Array.from(login.payload.nonce);
  assert.equal(new DataView(nonce.buffer).getBigUint64(0, false), 1_700_000_000_000n, "the nonce starts with the time in ms");
  assert.equal(login.signed_message.publicKey, nearKeyPair(secretKey).publicKey);
  const signature = base64.decode(login.signed_message.signature);
  assert.ok(ed25519.verify(signature, nep413Hash("Sign in to NEAR AI Cloud", nonce, "cloud.near.ai"), ed25519.getPublicKey(seed)));
  assert.deepEqual(calls[3].body, { name: "tester-abc", spendLimit: { amount: 250_000_000, currency: "USD" } });
  assert.equal(calls[3].auth, "Bearer access-3", "the retry uses the new session");
});

test("login nonces are 32 bytes and never repeat", () => {
  const a = loginNonce(1), b = loginNonce(1);
  assert.equal(a.length, 32);
  assert.notDeepEqual(a, b);
});
