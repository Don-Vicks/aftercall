import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { StatsController } from "./stats.controller";
import { StatsService, rpcChainStats, type StatsSources } from "./stats.service";
import { MemoryCounters } from "./counters";
import { ClaimsService } from "../claims/claims.service";
import { MemoryClaimsStore } from "../claims/claims.store";
import { EmailService } from "../email/email.service";
import { DEFAULT_RPC, nearEnv } from "../network";

const consent = "Hi.\n--\nThis call was recorded with notice to everyone on it.";

function sources(over: Partial<StatsSources> = {}) {
  const calls = { chain: 0 };
  const s: StatsSources = {
    network: "mainnet",
    chain: async () => {
      calls.chain++;
      return { wallets: 3, proofs: 7, payments: 4, parked: 1 };
    },
    claims: async () => ({ created: 2, claimed: 1 }),
    emailsSent: async () => 5,
    ...over,
  };
  return { s, calls };
}

test("stats are counts only", async () => {
  const stats = await new StatsService(sources().s, () => Date.UTC(2026, 10, 10)).get();
  assert.deepEqual(stats, {
    network: "mainnet",
    meetingsVerified: 7,
    walletsRegistered: 3,
    paymentsSent: 4,
    paymentsParked: 1,
    claimLinksCreated: 2,
    claimLinksClaimed: 1,
    emailsSent: 5,
    updatedAt: "2026-11-10T00:00:00.000Z",
  });
  for (const [k, v] of Object.entries(stats)) {
    if (k !== "network" && k !== "updatedAt") assert.equal(typeof v, "number", `${k} is a count`);
  }
});

test("stats are read at most once a minute", async () => {
  let now = 1_000_000;
  const { s, calls } = sources();
  const svc = new StatsService(s, () => now);
  await Promise.all([svc.get(), svc.get()]);
  now += 59_999;
  await svc.get();
  assert.equal(calls.chain, 1, "cached for 60 s, including concurrent first requests");
  now += 1;
  await svc.get();
  assert.equal(calls.chain, 2);
});

test("a source that fails or isn't configured gives null, not an error", async () => {
  const { s } = sources({ chain: undefined, claims: async () => { throw new Error("db down"); } });
  const stats = await new StatsService(s).get();
  assert.equal(stats.meetingsVerified, null);
  assert.equal(stats.paymentsSent, null);
  assert.equal(stats.claimLinksCreated, null);
  assert.equal(stats.emailsSent, 5);
});

test("claim totals and the email counter feed the stats", async () => {
  const claims = new ClaimsService(new MemoryClaimsStore());
  const { token } = await claims.create("victor.near", { payeeName: "Kemi", amount: "1000000", meeting: "Sync" });
  await claims.create("ada.near", { payeeName: "Ola", amount: "2000000", meeting: "Review" });
  await claims.claim(token, "kemi.near");
  assert.deepEqual(await claims.totals(), { created: 2, claimed: 1 });

  const counters = new MemoryCounters();
  const email = new EmailService(async () => ({ id: "e1" }), "notes@aftercall.app", Date.now, counters);
  await email.send("victor.near", { to: "ada@example.com", subject: "Recap", text: consent });
  await assert.rejects(email.send("victor.near", { to: "not-an-address", subject: "Recap", text: consent }));
  assert.equal(await counters.get("emails_sent"), 1, "only emails that went out count");
});

test("the contract's get_stats is read over RPC", async () => {
  let seen: { params?: { method_name?: string; account_id?: string } } = {};
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen = JSON.parse(body);
      const result = [...Buffer.from(JSON.stringify({ wallets: 2, proofs: 9, payments: 1, parked: 0 }))];
      res.end(JSON.stringify({ jsonrpc: "2.0", id: "x", result: { result, logs: [] } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assert.deepEqual(await rpcChainStats(url, "wallet.aftercall.near")(), { wallets: 2, proofs: 9, payments: 1, parked: 0 });
    assert.equal(seen.params?.method_name, "get_stats");
    assert.equal(seen.params?.account_id, "wallet.aftercall.near");
  } finally {
    server.close();
  }
});

test("HTTP: GET /stats is public and cacheable", async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [StatsController],
    providers: [{ provide: StatsService, useValue: new StatsService(sources().s) }],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  try {
    const r = await request(app.getHttpServer()).get("/stats").expect(200);
    assert.equal(r.headers["cache-control"], "public, max-age=60");
    assert.equal(r.body.meetingsVerified, 7);
  } finally {
    await app.close();
  }
});

test("the network comes from AFTERCALL_NETWORK and must match the contract", () => {
  assert.deepEqual(nearEnv({}), { network: "testnet", rpcUrl: DEFAULT_RPC.testnet, contract: undefined });
  assert.deepEqual(nearEnv({ AFTERCALL_NETWORK: "mainnet", AFTERCALL_CONTRACT: "wallet.aftercall.near" }), {
    network: "mainnet",
    rpcUrl: DEFAULT_RPC.mainnet,
    contract: "wallet.aftercall.near",
  });
  assert.equal(nearEnv({ AFTERCALL_NETWORK: "mainnet", NEAR_RPC_URL: "https://rpc.example" }).rpcUrl, "https://rpc.example");
  assert.throws(() => nearEnv({ AFTERCALL_NETWORK: "devnet" }), /testnet or mainnet/);
  assert.throws(() => nearEnv({ AFTERCALL_NETWORK: "mainnet", AFTERCALL_CONTRACT: "wallet.aftercall.testnet" }), /testnet account/);
  assert.throws(() => nearEnv({ AFTERCALL_CONTRACT: "wallet.aftercall.near" }), /mainnet account/);
});
