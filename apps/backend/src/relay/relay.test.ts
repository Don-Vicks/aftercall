import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { Pool } from "pg";
import { MemoryDailyCounts } from "../limits";
import { RelayController } from "./relay.controller";
import { ACTION_TTL_MS, MAX_WAITING_ACTIONS, PAIRING_IDLE_MS, PAIRING_WAIT_MS, RELAY_BOX_LIMITS, RELAY_DAILY, RelayService } from "./relay.service";
import { MemoryRelayStore, PgRelayStore, RELAY_ACTION_COLUMNS, RELAY_PAIRING_COLUMNS, relayHash, type RelayPairing, type RelayStore } from "./relay.store";

/** packages/core's relay code, loaded from source (tsx runs it; the backend's build can't import it). */
const crypto = () => import("../../../../packages/core/src/relay/crypto.ts") as Promise<typeof import("../../../../packages/core/src/relay/crypto.ts")>;
const messages = () => import("../../../../packages/core/src/relay/messages.ts") as Promise<typeof import("../../../../packages/core/src/relay/messages.ts")>;

const T0 = 1_762_440_000_000;
const MINUTE = 60_000;
const DAY = 86_400_000;

/** The same tests run against memory and, when DATABASE_URL is set, against Postgres in a schema of their own. */
const stores: [string, () => Promise<{ store: RelayStore; done: () => Promise<void> }>][] = [["memory", async () => ({ store: new MemoryRelayStore(), done: async () => {} })]];
if (process.env.DATABASE_URL) {
  stores.push([
    "postgres",
    async () => {
      const schema = `relaytest_${process.pid}_${randomBytes(4).toString("hex")}`;
      const admin = new Pool({ connectionString: process.env.DATABASE_URL });
      await admin.query(`CREATE SCHEMA ${schema}`);
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
      const store = new PgRelayStore(pool);
      await store.migrate();
      return {
        store,
        done: async () => {
          await pool.end();
          await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
          await admin.end();
        },
      };
    },
  ]);
}

const pairingRow = (idHash: string, now: number): RelayPairing => ({
  idHash,
  macTokenHash: relayHash("mac-token"),
  phoneTokenHash: null,
  hello: null,
  state: "waiting",
  createdAt: now,
  expiresAt: now + PAIRING_WAIT_MS,
  macSeenAt: now,
  snapshot: null,
  snapshotVersion: 0,
  snapshotAt: null,
});

/** The relay's routes on an app of their own, with a clock the test moves. */
async function relayApp(store: RelayStore = new MemoryRelayStore()) {
  const clock = { now: T0 };
  const service = new RelayService(store, new MemoryDailyCounts(), () => clock.now);
  const moduleRef = await Test.createTestingModule({ controllers: [RelayController], providers: [{ provide: RelayService, useValue: service }] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  const http = () => request(app.getHttpServer());
  return { http, clock, service, store, close: () => app.close() };
}

type Http = Awaited<ReturnType<typeof relayApp>>["http"];
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** The Mac and the phone as packages/core makes them, paired through the relay up to the codes matching. */
async function pairThrough(http: Http, { confirm = true } = {}) {
  const c = await crypto();
  const { pairing, mac, macToken } = c.newPairing("https://api.example.com");
  const id = c.pairingIdText(pairing);
  const created = await http().post("/relay/pairings").send({ id, macTokenHash: c.relayTokenHash(macToken) });
  assert.equal(created.status, 201);
  const phoneKeys = c.newRelayKeys();
  const hello = c.sealHello(pairing, phoneKeys.publicKey, "iPhone · Safari");
  assert.equal((await http().post(`/relay/pairings/${id}/hello`).send({ box: hello })).status, 200);
  const got = await http().get(`/relay/pairings/${id}/hello`).set(bearer(macToken));
  assert.equal(got.body.box, hello);
  const opened = c.openHello(pairing.pairingId, mac.secretKey, got.body.box);
  const both = { pairingId: pairing.pairingId, macPublicKey: pairing.macPublicKey, phonePublicKey: opened.phonePublicKey };
  const macSession = c.deriveSession({ ...both, ourSecretKey: mac.secretKey, theirPublicKey: opened.phonePublicKey });
  const phoneSession = c.deriveSession({ ...both, ourSecretKey: phoneKeys.secretKey, theirPublicKey: pairing.macPublicKey });
  assert.equal(macSession.code, phoneSession.code);
  if (confirm) {
    const confirmed = await http().post(`/relay/pairings/${id}/confirm`).set(bearer(macToken)).send({ phoneTokenHash: c.relayTokenHash(macSession.phoneToken) });
    assert.equal(confirmed.status, 200);
  }
  return { id, macToken, phoneToken: phoneSession.phoneToken, key: macSession.key, hello, created: created.body };
}

/** A snapshot holding a payment and a recap, with text the relay must never see. */
async function snapshotWithSecrets() {
  const m = await messages();
  const whatLeaves = { summary: "Public on NEAR, nothing from the meeting.", details: [] };
  const base = { meetingId: "1762000000", meetingTitle: "Sync with Ada about the icon deck", meetingAt: "2026-11-06T14:02:00Z", status: "proposed" as const, whatLeaves };
  const snapshot: import("../../../../packages/core/src/relay/messages.ts").Snapshot = {
    t: "snapshot",
    at: T0,
    network: "testnet",
    items: [
      {
        ...base,
        kind: "payment",
        followUpId: "f2",
        quote: "send Kemi the twenty dollars for the icons",
        payeeName: "Kemi Adeyemi",
        payeeAccount: "kemi-studio.testnet",
        payeeListed: true,
        amount: "20000000",
        heard: "the twenty dollars",
        route: null,
      },
      { ...base, kind: "email", followUpId: "f1", quote: "send Ada the recap", to: "ada.lovelace@example.com", toName: "Ada", subject: "Recap: Sync with Ada about the icon deck" },
    ],
    more: 0,
    done: [],
    results: [],
  };
  const secrets = ["Sync with Ada about the icon deck", "send Kemi the twenty dollars", "kemi-studio.testnet", "ada.lovelace@example.com", "Kemi Adeyemi", "iPhone · Safari"];
  return { m, snapshot, secrets };
}

for (const [name, make] of stores) {
  test(`[${name}] pairing: hello, matching codes, confirm, then snapshots and actions through sealed boxes`, async () => {
    const { store, done } = await make();
    const { http, clock, close } = await relayApp(store);
    try {
      const c = await crypto();
      const { m, snapshot } = await snapshotWithSecrets();
      const p = await pairThrough(http, { confirm: false });
      assert.equal(p.created.expiresAt, T0 + PAIRING_WAIT_MS, "an unconfirmed pairing lasts as long as the QR");

      // Until the codes match, the phone gets nothing and can send nothing.
      const early = await http().get(`/relay/pairings/${p.id}/snapshot`).set(bearer(p.phoneToken));
      assert.deepEqual([early.status, early.body.message], [409, "NOT_CONFIRMED"]);
      assert.equal((await http().post(`/relay/pairings/${p.id}/actions`).set(bearer(p.phoneToken)).send({ box: "AAAA" })).status, 409);
      assert.equal((await http().post(`/relay/pairings/${p.id}/snapshot`).set(bearer(p.macToken)).send({ box: "AAAA" })).body.message, "NOT_CONFIRMED");

      await pairThrough(http, { confirm: false }); // a second pairing doesn't get in the way
      const phoneTokenHash = c.relayTokenHash(p.phoneToken);
      assert.equal((await http().post(`/relay/pairings/${p.id}/confirm`).set(bearer(p.macToken)).send({ phoneTokenHash })).status, 200);
      assert.equal((await http().get(`/relay/pairings/${p.id}/hello`).set(bearer(p.macToken))).body.box, null, "the hello is dropped on confirm");
      const again = await http().post(`/relay/pairings/${p.id}/confirm`).set(bearer(p.macToken)).send({ phoneTokenHash });
      assert.deepEqual([again.status, again.body.message], [409, "NO_HELLO"]);

      // Confirmed, nothing posted yet.
      const empty = await http().get(`/relay/pairings/${p.id}/snapshot`).set(bearer(p.phoneToken));
      assert.deepEqual(empty.body, { now: T0, version: 0, postedAt: null, macSeenAt: T0 });

      // The Mac's snapshot; the phone opens it with its own key.
      clock.now += 1_000;
      const box1 = m.sealSnapshot(p.key, 1, snapshot);
      assert.deepEqual((await http().post(`/relay/pairings/${p.id}/snapshot`).set(bearer(p.macToken)).send({ box: box1 })).body, { version: 1 });
      const read = await http().get(`/relay/pairings/${p.id}/snapshot?after=0`).set(bearer(p.phoneToken));
      assert.deepEqual(read.body, { now: T0 + 1_000, version: 1, postedAt: T0 + 1_000, macSeenAt: T0 + 1_000, box: box1 });
      assert.equal(m.openSnapshot(p.key, 0, read.body.box).snapshot.items[0].kind, "payment");
      const unchanged = await http().get(`/relay/pairings/${p.id}/snapshot?after=1`).set(bearer(p.phoneToken));
      assert.equal(unchanged.body.box, undefined, "no box when the phone already has this version");

      // A new snapshot replaces the old one.
      const box2 = m.sealSnapshot(p.key, 2, { ...snapshot, items: [] });
      assert.deepEqual((await http().post(`/relay/pairings/${p.id}/snapshot`).set(bearer(p.macToken)).send({ box: box2 })).body, { version: 2 });
      const replaced = await http().get(`/relay/pairings/${p.id}/snapshot?after=1`).set(bearer(p.phoneToken));
      assert.equal(replaced.body.box, box2);
      assert.equal(m.openSnapshot(p.key, 1, replaced.body.box).snapshot.items.length, 0);

      // The phone's taps queue for the Mac, oldest first, until it acknowledges them.
      const digest = m.itemDigest(snapshot.items[0]);
      const taps = [1, 2, 3].map((n) => m.sealAction(p.key, n, { t: "action", kind: n === 2 ? "dismiss" : "approve", meetingId: "1762000000", followUpId: "f2", digest, at: T0 }));
      const seqs: number[] = [];
      for (const box of taps) seqs.push((await http().post(`/relay/pairings/${p.id}/actions`).set(bearer(p.phoneToken)).send({ box })).body.seq);
      assert.ok(seqs[0] < seqs[1] && seqs[1] < seqs[2]);
      const waiting = await http().get(`/relay/pairings/${p.id}/actions`).set(bearer(p.macToken));
      assert.deepEqual(
        waiting.body.actions.map((a: { box: string }) => a.box),
        taps,
      );
      assert.equal(m.openAction(p.key, 0, waiting.body.actions[0].box).action.kind, "approve");
      assert.equal((await http().post(`/relay/pairings/${p.id}/ack`).set(bearer(p.macToken)).send({ seq: seqs[1] })).status, 200);
      const left = await http().get(`/relay/pairings/${p.id}/actions`).set(bearer(p.macToken));
      assert.deepEqual(
        left.body.actions.map((a: { seq: number }) => a.seq),
        [seqs[2]],
      );
      await http().post(`/relay/pairings/${p.id}/ack`).set(bearer(p.macToken)).send({ seq: seqs[2] });
      assert.deepEqual((await http().get(`/relay/pairings/${p.id}/actions`).set(bearer(p.macToken))).body, { actions: [] });
    } finally {
      await close();
      await done();
    }
  });

  test(`[${name}] only the first hello is kept, and none once the pairing is active`, async () => {
    const { store, done } = await make();
    const { http, close } = await relayApp(store);
    try {
      const p = await pairThrough(http, { confirm: false });
      const second = await http().post(`/relay/pairings/${p.id}/hello`).send({ box: "BBBB" });
      assert.deepEqual([second.status, second.body.message], [409, "HELLO_TAKEN"]);
      assert.equal((await http().get(`/relay/pairings/${p.id}/hello`).set(bearer(p.macToken))).body.box, p.hello, "the first one stays");
      const q = await pairThrough(http);
      assert.equal((await http().post(`/relay/pairings/${q.id}/hello`).send({ box: "BBBB" })).body.message, "HELLO_TAKEN");

      // Two phones posting at once: one wins.
      const c = await crypto();
      const r = c.newPairing("https://api.example.com");
      const rid = c.pairingIdText(r.pairing);
      await http().post("/relay/pairings").send({ id: rid, macTokenHash: c.relayTokenHash(r.macToken) });
      const results = await Promise.all(["CCCC", "DDDD"].map((box) => http().post(`/relay/pairings/${rid}/hello`).send({ box })));
      assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
    } finally {
      await close();
      await done();
    }
  });

  test(`[${name}] an unconfirmed pairing is gone after 10 minutes; a confirmed one 30 days after the Mac last called`, async () => {
    const { store, done } = await make();
    const { http, clock, close } = await relayApp(store);
    try {
      const waiting = await pairThrough(http, { confirm: false });
      const active = await pairThrough(http);
      clock.now = T0 + PAIRING_WAIT_MS - 1;
      assert.equal((await http().get(`/relay/pairings/${waiting.id}/hello`).set(bearer(waiting.macToken))).status, 200, "the Mac waiting for a hello doesn't keep it longer");
      clock.now = T0 + PAIRING_WAIT_MS;
      const gone = await http().get(`/relay/pairings/${waiting.id}/hello`).set(bearer(waiting.macToken));
      assert.deepEqual([gone.status, gone.body.message], [404, "NO_PAIRING"]);
      assert.equal((await http().post(`/relay/pairings/${waiting.id}/hello`).send({ box: "AAAA" })).body.message, "NO_PAIRING");

      // Every call the Mac makes keeps a confirmed pairing alive, and the phone sees when it was.
      clock.now = T0 + 20 * DAY;
      assert.equal((await http().get(`/relay/pairings/${active.id}/actions`).set(bearer(active.macToken))).status, 200);
      clock.now = T0 + 45 * DAY;
      const seen = await http().get(`/relay/pairings/${active.id}/snapshot`).set(bearer(active.phoneToken));
      assert.equal(seen.body.macSeenAt, T0 + 20 * DAY, "the phone's polls don't count as the Mac");
      clock.now = T0 + 20 * DAY + PAIRING_IDLE_MS;
      assert.equal((await http().get(`/relay/pairings/${active.id}/snapshot`).set(bearer(active.phoneToken))).status, 404);

      // Expired rows are deleted on the next write.
      await pairThrough(http, { confirm: false });
      assert.equal(await store.get(relayHash(waiting.id), 0), null);
      assert.equal(await store.get(relayHash(active.id), 0), null);
    } finally {
      await close();
      await done();
    }
  });

  test(`[${name}] actions wait 24 hours at most, and 50 at a time`, async () => {
    const { store, done } = await make();
    const { http, clock, close } = await relayApp(store);
    try {
      const p = await pairThrough(http);
      const post = () => http().post(`/relay/pairings/${p.id}/actions`).set(bearer(p.phoneToken)).send({ box: "AAAA" });
      for (let i = 0; i < MAX_WAITING_ACTIONS; i++) assert.equal((await post()).status, 200);
      const full = await post();
      assert.deepEqual([full.status, full.body.message], [429, "TOO_MANY_ACTIONS"]);
      assert.equal((await http().get(`/relay/pairings/${p.id}/actions`).set(bearer(p.macToken))).body.actions.length, MAX_WAITING_ACTIONS);
      clock.now += ACTION_TTL_MS;
      assert.deepEqual((await http().get(`/relay/pairings/${p.id}/actions`).set(bearer(p.macToken))).body, { actions: [] }, "a day-old action is gone");
      assert.equal((await post()).status, 200, "and no longer counts as waiting");
      assert.equal((await store.actions(relayHash(p.id), 0, 100)).length, 1, "the old ones were deleted on that write");
    } finally {
      await close();
      await done();
    }
  });

  test(`[${name}] unpairing, by either side, deletes the pairing, its snapshot and its actions`, async () => {
    const { store, done } = await make();
    const { http, close } = await relayApp(store);
    try {
      for (const who of ["phone", "mac"] as const) {
        const p = await pairThrough(http);
        await http().post(`/relay/pairings/${p.id}/snapshot`).set(bearer(p.macToken)).send({ box: "AAAA" });
        await http().post(`/relay/pairings/${p.id}/actions`).set(bearer(p.phoneToken)).send({ box: "BBBB" });
        const stranger = await http().delete(`/relay/pairings/${p.id}`).set(bearer(randomBytes(32).toString("base64url")));
        assert.deepEqual([stranger.status, stranger.body.message], [401, "BAD_TOKEN"]);
        const res = await http()
          .delete(`/relay/pairings/${p.id}`)
          .set(bearer(who === "phone" ? p.phoneToken : p.macToken));
        assert.equal(res.status, 200);
        assert.equal(await store.get(relayHash(p.id), 0), null);
        assert.deepEqual(await store.actions(relayHash(p.id), 0, 100), []);
        assert.equal((await http().get(`/relay/pairings/${p.id}/snapshot`).set(bearer(p.phoneToken))).status, 404);
      }
    } finally {
      await close();
      await done();
    }
  });

  test(`[${name}] one pairing's tokens never reach another's boxes, and an ack clears only its own actions`, async () => {
    const { store, done } = await make();
    const { http, close } = await relayApp(store);
    try {
      const a = await pairThrough(http);
      const b = await pairThrough(http);
      await http().post(`/relay/pairings/${b.id}/snapshot`).set(bearer(b.macToken)).send({ box: "BBBB" });
      const tapA = (await http().post(`/relay/pairings/${a.id}/actions`).set(bearer(a.phoneToken)).send({ box: "AAAA" })).body.seq;
      const tapB = (await http().post(`/relay/pairings/${b.id}/actions`).set(bearer(b.phoneToken)).send({ box: "BBBB" })).body.seq;

      // A's tokens on B's id are a stranger's tokens.
      const cases = [
        () => http().get(`/relay/pairings/${b.id}/actions`).set(bearer(a.macToken)),
        () => http().get(`/relay/pairings/${b.id}/snapshot`).set(bearer(a.phoneToken)),
        () => http().post(`/relay/pairings/${b.id}/snapshot`).set(bearer(a.macToken)).send({ box: "AAAA" }),
        () => http().post(`/relay/pairings/${b.id}/actions`).set(bearer(a.phoneToken)).send({ box: "AAAA" }),
        () => http().post(`/relay/pairings/${b.id}/ack`).set(bearer(a.macToken)).send({ seq: Number.MAX_SAFE_INTEGER }),
        () => http().delete(`/relay/pairings/${b.id}`).set(bearer(a.phoneToken)),
      ];
      for (const req of cases) assert.equal((await req()).status, 401);

      // A's Mac acknowledging past B's tap clears A's and leaves B's.
      await http().post(`/relay/pairings/${a.id}/ack`).set(bearer(a.macToken)).send({ seq: Math.max(tapA, tapB) });
      assert.deepEqual((await http().get(`/relay/pairings/${a.id}/actions`).set(bearer(a.macToken))).body, { actions: [] });
      const left = await http().get(`/relay/pairings/${b.id}/actions`).set(bearer(b.macToken));
      assert.deepEqual(
        left.body.actions.map((x: { seq: number; box: string }) => [x.seq, x.box]),
        [[tapB, "BBBB"]],
      );
      assert.equal((await http().get(`/relay/pairings/${b.id}/snapshot`).set(bearer(b.phoneToken))).body.box, "BBBB", "B's snapshot is untouched");
      assert.equal((await http().get(`/relay/pairings/${a.id}/snapshot`).set(bearer(a.phoneToken))).body.version, 0, "and never became A's");
    } finally {
      await close();
      await done();
    }
  });
}

test("each side has its own token, and a wrong one is refused", async () => {
  const { http, close } = await relayApp();
  try {
    const p = await pairThrough(http);
    const cases = [
      () => http().get(`/relay/pairings/${p.id}/hello`).set(bearer(p.phoneToken)),
      () => http().get(`/relay/pairings/${p.id}/actions`).set(bearer(p.phoneToken)),
      () => http().post(`/relay/pairings/${p.id}/snapshot`).set(bearer(p.phoneToken)).send({ box: "AAAA" }),
      () => http().post(`/relay/pairings/${p.id}/ack`).set(bearer(p.phoneToken)).send({ seq: 1 }),
      () => http().post(`/relay/pairings/${p.id}/confirm`).set(bearer(p.phoneToken)).send({ phoneTokenHash: relayHash("x") }),
      () => http().get(`/relay/pairings/${p.id}/snapshot`).set(bearer(p.macToken)),
      () => http().post(`/relay/pairings/${p.id}/actions`).set(bearer(p.macToken)).send({ box: "AAAA" }),
      () => http().get(`/relay/pairings/${p.id}/snapshot`),
      () => http().get(`/relay/pairings/${p.id}/actions`).set({ authorization: p.macToken }),
      () => http().delete(`/relay/pairings/${p.id}`),
    ];
    for (const req of cases) {
      const res = await req();
      assert.deepEqual([res.status, res.body.message], [401, "BAD_TOKEN"], `${res.req.method} ${res.req.path}`);
    }
  } finally {
    await close();
  }
});

test("bad ids, hashes, boxes and sizes are refused before anything is stored", async () => {
  const { http, close } = await relayApp();
  try {
    const p = await pairThrough(http);
    const c = await crypto();
    const fresh = c.pairingIdText(c.newPairing("https://api.example.com").pairing);
    const hash = relayHash("mac");
    const expect = async (res: request.Test, status: number, message: string) => {
      const r = await res;
      assert.deepEqual([r.status, r.body.message], [status, message], `${r.req.method} ${r.req.path}`);
    };
    await expect(http().post("/relay/pairings").send({ id: p.id, macTokenHash: hash }), 409, "PAIRING_EXISTS");
    await expect(http().post("/relay/pairings").send({ id: "short", macTokenHash: hash }), 400, "BAD_PAIRING");
    await expect(http().post("/relay/pairings").send({ id: fresh, macTokenHash: "ABC" }), 400, "BAD_HASH");
    await expect(http().post("/relay/pairings").send({ id: fresh, macTokenHash: hash.toUpperCase() }), 400, "BAD_HASH");
    await expect(http().get(`/relay/pairings/${p.id}x/hello`).set(bearer(p.macToken)), 400, "BAD_PAIRING");
    await expect(http().get(`/relay/pairings/${fresh}/hello`).set(bearer(p.macToken)), 404, "NO_PAIRING");
    await expect(http().post(`/relay/pairings/${fresh}/hello`).send({ box: "AAAA" }), 404, "NO_PAIRING");

    const sizes = [
      [RELAY_BOX_LIMITS.hello, () => http().post(`/relay/pairings/${fresh}/hello`)],
      [RELAY_BOX_LIMITS.snapshot, () => http().post(`/relay/pairings/${p.id}/snapshot`).set(bearer(p.macToken))],
      [RELAY_BOX_LIMITS.action, () => http().post(`/relay/pairings/${p.id}/actions`).set(bearer(p.phoneToken))],
    ] as const;
    for (const [limit, req] of sizes) await expect(req().send({ box: "A".repeat(limit + 1) }), 413, "TOO_LARGE");
    for (const box of ["", "AA+A", "AAA=", "A", "AAAAA", 5, null]) {
      await expect(http().post(`/relay/pairings/${p.id}/actions`).set(bearer(p.phoneToken)).send({ box }), 400, "BAD_BOX");
    }
    await expect(http().post(`/relay/pairings/${p.id}/ack`).set(bearer(p.macToken)).send({ seq: "1" }), 400, "BAD_SEQ");
    await expect(http().get(`/relay/pairings/${p.id}/snapshot?after=-1`).set(bearer(p.phoneToken)), 400, "BAD_AFTER");
    assert.deepEqual((await http().get(`/relay/pairings/${p.id}/actions`).set(bearer(p.macToken))).body, { actions: [] });

    // The largest snapshot fits the default JSON body limit.
    const largest = "A".repeat(RELAY_BOX_LIMITS.snapshot);
    assert.deepEqual((await http().post(`/relay/pairings/${p.id}/snapshot`).set(bearer(p.macToken)).send({ box: largest })).body, { version: 1 });
    assert.equal((await http().get(`/relay/pairings/${p.id}/snapshot`).set(bearer(p.phoneToken))).body.box, largest);
  } finally {
    await close();
  }
});

test("the daily limits: pairings and hellos per IP, snapshots and actions per pairing", async () => {
  const { http, clock, service, close } = await relayApp();
  try {
    const c = await crypto();
    const newId = () => c.pairingIdText(c.newPairing("https://api.example.com").pairing);
    const create = (ip: string) => http().post("/relay/pairings").set("x-forwarded-for", ip).send({ id: newId(), macTokenHash: relayHash("t") });
    for (let i = 0; i < RELAY_DAILY.pairingsPerIp; i++) assert.equal((await create("7.7.7.7")).status, 201);
    const over = await create("7.7.7.7");
    assert.deepEqual([over.status, over.body.message], [429, "IP_DAILY_LIMIT"]);
    assert.equal((await create("8.8.8.8")).status, 201, "another IP isn't held back");
    const spoofed = await http().post("/relay/pairings").set("x-vercel-forwarded-for", "7.7.7.7").set("x-forwarded-for", "1.2.3.4").send({ id: newId(), macTokenHash: relayHash("t") });
    assert.deepEqual([spoofed.status, spoofed.body.message], [429, "IP_DAILY_LIMIT"], "on Vercel, a made-up x-forwarded-for doesn't get round it");

    const hello = (ip: string) => http().post(`/relay/pairings/${newId()}/hello`).set("x-forwarded-for", ip).send({ box: "AAAA" });
    for (let i = 0; i < RELAY_DAILY.hellosPerIp; i++) assert.equal((await hello("9.9.9.9")).body.message, "NO_PAIRING", "guessing ids counts too");
    assert.deepEqual([(await hello("9.9.9.9")).status, (await hello("9.9.9.9")).body.message], [429, "IP_DAILY_LIMIT"]);

    const p = await pairThrough(http);
    for (let i = 0; i < RELAY_DAILY.snapshotsPerPairing; i++) await service.postSnapshot(p.id, `Bearer ${p.macToken}`, { box: "AAAA" });
    await assert.rejects(service.postSnapshot(p.id, `Bearer ${p.macToken}`, { box: "AAAA" }), /DAILY_LIMIT/);
    for (let i = 0; i < RELAY_DAILY.actionsPerPairing; i++) {
      await service.postAction(p.id, `Bearer ${p.phoneToken}`, { box: "AAAA" });
      if (i % 40 === 39) await service.ack(p.id, `Bearer ${p.macToken}`, Number.MAX_SAFE_INTEGER);
    }
    await assert.rejects(service.postAction(p.id, `Bearer ${p.phoneToken}`, { box: "AAAA" }), /DAILY_LIMIT/);
    clock.now += DAY;
    await service.postSnapshot(p.id, `Bearer ${p.macToken}`, { box: "AAAA" });
    assert.equal((await create("7.7.7.7")).status, 201, "the limits reset the next UTC day");
  } finally {
    await close();
  }
});

test("nothing readable is stored: only hashes of the id and tokens, and the sealed boxes as posted", async () => {
  const inner = new MemoryRelayStore();
  const seen: unknown[] = [];
  const spy = new Proxy(inner, {
    get(target, key) {
      const v = Reflect.get(target, key);
      return typeof v === "function" ? (...args: unknown[]) => (seen.push(args), v.apply(target, args)) : v;
    },
  });
  const { http, close } = await relayApp(spy);
  try {
    const { m, snapshot, secrets } = await snapshotWithSecrets();
    const p = await pairThrough(http);
    const snap = m.sealSnapshot(p.key, 1, snapshot);
    await http().post(`/relay/pairings/${p.id}/snapshot`).set(bearer(p.macToken)).send({ box: snap });
    const tap = m.sealAction(p.key, 1, { t: "action", kind: "approve", meetingId: "1762000000", followUpId: "f2", digest: m.itemDigest(snapshot.items[0]), at: T0 });
    await http().post(`/relay/pairings/${p.id}/actions`).set(bearer(p.phoneToken)).send({ box: tap });
    await http().get(`/relay/pairings/${p.id}/actions`).set(bearer(p.macToken));

    const boxes = new Set([p.hello, snap, tap]);
    const strings: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(seen);
    assert.ok(strings.length > 10);
    for (const s of strings) assert.ok(/^[0-9a-f]{64}$/.test(s) || boxes.has(s) || s === "waiting" || s === "active", `the store was handed "${s.slice(0, 40)}"`);
    const all = strings.join("\n");
    for (const secret of [p.id, p.macToken, p.phoneToken, ...secrets]) assert.ok(!all.includes(secret), `"${secret}" reached the store`);
    assert.ok(seen.some((args) => (args as unknown[]).includes(relayHash(p.id))), "the pairing is stored under its id's hash");
  } finally {
    await close();
  }
});

test("the backend's copies of core's limits and hash match core", async () => {
  const c = await crypto();
  const m = await messages();
  assert.deepEqual(RELAY_BOX_LIMITS, c.RELAY_BOX_LIMITS);
  assert.equal(ACTION_TTL_MS, m.ACTION_TTL_MS);
  const token = c.newPairing("https://api.example.com").macToken;
  assert.equal(relayHash(token), c.relayTokenHash(token));
});

test("a stored pairing has the same fields in memory as a Postgres row", async () => {
  const store = new MemoryRelayStore();
  assert.ok(await store.insert(pairingRow(relayHash("a"), T0)));
  assert.equal(await store.insert(pairingRow(relayHash("a"), T0)), false);
  const row = await store.get(relayHash("a"), T0);
  assert.deepEqual(
    Object.keys(row ?? {}).map((k) => k.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`)),
    RELAY_PAIRING_COLUMNS,
  );
});

if (process.env.DATABASE_URL) {
  test("[postgres] the relay's tables have exactly the columns in the protocol", async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const schema = `relaycols_${process.pid}`;
    try {
      await pool.query(`CREATE SCHEMA ${schema}`);
      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO ${schema}`);
        await new PgRelayStore(client as unknown as Pool).migrate();
        await new PgRelayStore(client as unknown as Pool).migrate();
        const cols = async (table: string) =>
          (
            await client.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2", [schema, table])
          ).rows
            .map((r) => r.column_name)
            .sort();
        assert.deepEqual(await cols("relay_pairings"), [...RELAY_PAIRING_COLUMNS].sort());
        assert.deepEqual(await cols("relay_actions"), [...RELAY_ACTION_COLUMNS].sort());
      } finally {
        client.release();
      }
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await pool.end();
    }
  });
}
