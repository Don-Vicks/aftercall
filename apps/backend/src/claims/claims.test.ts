import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { ClaimsService } from "./claims.service";
import { CLAIM_COLUMNS, MemoryClaimsStore, PgClaimsStore, type ClaimsStore } from "./claims.store";

const claim = { amount: "50000000" };
/** What an older app sent along; none of it may be kept. */
const withDetails = { ...claim, payeeName: "Kemi", memo: "deck deposit", meeting: "Sync with Ada" } as typeof claim;

/** The same tests run against memory and, when DATABASE_URL is set, against Postgres. */
const stores: [string, () => Promise<{ store: ClaimsStore; done: () => Promise<void> }>][] = [["memory", async () => ({ store: new MemoryClaimsStore(), done: async () => {} })]];
if (process.env.DATABASE_URL) {
  stores.push([
    "postgres",
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const store = new PgClaimsStore(pool);
      await store.migrate();
      await pool.query("DELETE FROM claims WHERE owner LIKE '%.claimtest'");
      return { store, done: () => pool.end() };
    },
  ]);
}

for (const [name, make] of stores) {
  test(`[${name}] a payee shares their account once; the owner sees it`, async () => {
    const { store, done } = await make();
    try {
      const claims = new ClaimsService(store);
      const { token, claim: c } = await claims.create("victor.claimtest", claim);
      assert.deepEqual(await claims.view(token), { owner: "victor.claimtest", amount: "50000000", status: "open", expiresAt: c.expiresAt });
      await claims.claim(token, "Kemi-Studio.testnet");
      const mine = await claims.mine("victor.claimtest");
      assert.equal(mine[0].id, c.id);
      assert.equal(mine[0].claimedAccount, "kemi-studio.testnet");
      await assert.rejects(claims.claim(token, "attacker.testnet"), /ALREADY_CLAIMED/);
      assert.equal((await claims.mine("someone-else.claimtest")).length, 0, "owners only see their own claims");
    } finally {
      await done();
    }
  });

  test(`[${name}] a payee's name, memo and meeting title are never stored, even if sent`, async () => {
    const { store, done } = await make();
    try {
      const claims = new ClaimsService(store);
      const { token } = await claims.create("names.claimtest", withDetails);
      const stored = JSON.stringify([await claims.mine("names.claimtest"), await claims.view(token)]);
      for (const secret of ["Kemi", "deck deposit", "Sync with Ada"]) assert.ok(!stored.includes(secret), `"${secret}" was kept`);
    } finally {
      await done();
    }
  });

  test(`[${name}] two people answering the same link at once: only one wins`, async () => {
    const { store, done } = await make();
    try {
      const claims = new ClaimsService(store);
      const { token } = await claims.create("race.claimtest", claim);
      const results = await Promise.allSettled([claims.claim(token, "a.testnet"), claims.claim(token, "b.testnet")]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.match(String((await claims.mine("race.claimtest"))[0].claimedAccount), /^(a|b)\.testnet$/);
    } finally {
      await done();
    }
  });

  test(`[${name}] links expire after 7 days and can be cancelled`, async () => {
    const { store, done } = await make();
    try {
      let now = 1_000;
      const claims = new ClaimsService(store, () => now);
      const a = await claims.create("v.claimtest", claim);
      const b = await claims.create("v.claimtest", claim);
      now += 7 * 86_400_000 + 1;
      await assert.rejects(claims.view(a.token), /CLAIM_EXPIRED/);
      now = 1_000;
      await claims.cancel("v.claimtest", b.claim.id);
      await assert.rejects(claims.view(b.token), /NO_SUCH_CLAIM/);
      await assert.rejects(claims.cancel("other.claimtest", a.claim.id), /NO_SUCH_CLAIM/);
    } finally {
      await done();
    }
  });
}

test("bad input is refused", async () => {
  const claims = new ClaimsService();
  await assert.rejects(claims.create("v", { ...claim, amount: "-5" }), /BAD_CLAIM/);
  await assert.rejects(claims.create("v", { ...claim, amount: "0" }), /BAD_CLAIM/);
  const { token } = await claims.create("v", claim);
  await assert.rejects(claims.claim(token, "not an account!"), /BAD_ACCOUNT/);
  await assert.rejects(claims.view("made-up-token"), /NO_SUCH_CLAIM/);
});

test("the database never holds a usable token", async () => {
  const store = new MemoryClaimsStore();
  const claims = new ClaimsService(store);
  const { token } = await claims.create("v", claim);
  assert.equal(await store.byTokenHash(token), null, "looking up by the raw token finds nothing");
});

if (process.env.DATABASE_URL) {
  test("[postgres] the claims table has only the columns the link needs, also after migrating an old table", async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const schema = `claimtest_${process.pid}`;
    try {
      await pool.query(`CREATE SCHEMA ${schema}`);
      // A table as an earlier version created it, with a row holding a name, memo and title.
      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO ${schema}`);
        await client.query(`CREATE TABLE claims (id text PRIMARY KEY, token_hash text UNIQUE NOT NULL, owner text NOT NULL, payee_name text NOT NULL,
          amount numeric(40, 0) NOT NULL, memo text, meeting text NOT NULL, created_at bigint NOT NULL, expires_at bigint NOT NULL,
          status text NOT NULL, claimed_account text, claimed_at bigint)`);
        await client.query(`INSERT INTO claims VALUES ('c1', 'h1', 'v.claimtest', 'Kemi', 5, 'deck deposit', 'Sync with Ada', 1, 2, 'open', null, null)`);
        await new PgClaimsStore(client as unknown as Pool).migrate();
        const cols = await client.query<{ column_name: string }>(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'claims'",
          [schema],
        );
        assert.deepEqual(cols.rows.map((r) => r.column_name).sort(), [...CLAIM_COLUMNS].sort());
        const row = await client.query("SELECT * FROM claims");
        assert.ok(!JSON.stringify(row.rows).includes("Kemi"), "old names are gone");
        assert.equal(row.rows[0].owner, "v.claimtest", "the claim itself still works");
      } finally {
        client.release();
      }
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await pool.end();
    }
  });
}
