import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { Claim } from "./claims.service";

/**
 * Where claims live. Postgres in production; memory for unit tests.
 * Only the sha256 of a claim's token is stored, so a copy of the database
 * can't be used to answer someone's claim link.
 */
export interface ClaimsStore {
  insert(tokenHash: string, claim: Claim): Promise<void>;
  byTokenHash(tokenHash: string): Promise<Claim | null>;
  byOwner(owner: string): Promise<Claim[]>;
  countOpen(owner: string, now: number): Promise<number>;
  /** Marks the claim claimed only if it is still open; false if someone got there first. */
  markClaimed(id: string, account: string, at: number): Promise<boolean>;
  cancel(owner: string, id: string): Promise<boolean>;
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export class MemoryClaimsStore implements ClaimsStore {
  private readonly rows = new Map<string, Claim>();

  async insert(tokenHash: string, claim: Claim) {
    this.rows.set(tokenHash, { ...claim });
  }
  async byTokenHash(tokenHash: string) {
    const c = this.rows.get(tokenHash);
    return c ? { ...c } : null;
  }
  async byOwner(owner: string) {
    return [...this.rows.values()].filter((c) => c.owner === owner).sort((a, b) => b.createdAt - a.createdAt).map((c) => ({ ...c }));
  }
  async countOpen(owner: string, now: number) {
    return [...this.rows.values()].filter((c) => c.owner === owner && c.status === "open" && c.expiresAt > now).length;
  }
  async markClaimed(id: string, account: string, at: number) {
    const c = [...this.rows.values()].find((x) => x.id === id);
    if (!c || c.status !== "open") return false;
    Object.assign(c, { status: "claimed", claimedAccount: account, claimedAt: at });
    return true;
  }
  async cancel(owner: string, id: string) {
    const c = [...this.rows.values()].find((x) => x.id === id && x.owner === owner);
    if (!c) return false;
    c.status = "cancelled";
    return true;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS claims (
  id              text PRIMARY KEY,
  token_hash      text UNIQUE NOT NULL,
  owner           text NOT NULL,
  payee_name      text NOT NULL,
  amount          numeric(40, 0) NOT NULL,
  memo            text,
  meeting         text NOT NULL,
  created_at      bigint NOT NULL,
  expires_at      bigint NOT NULL,
  status          text NOT NULL CHECK (status IN ('open', 'claimed', 'cancelled')),
  claimed_account text,
  claimed_at      bigint
);
CREATE INDEX IF NOT EXISTS claims_owner ON claims (owner, created_at DESC);
`;

interface Row {
  id: string;
  owner: string;
  payee_name: string;
  amount: string;
  memo: string | null;
  meeting: string;
  created_at: string;
  expires_at: string;
  status: Claim["status"];
  claimed_account: string | null;
  claimed_at: string | null;
}

const toClaim = (r: Row): Claim => ({
  id: r.id,
  owner: r.owner,
  payeeName: r.payee_name,
  amount: r.amount,
  memo: r.memo ?? undefined,
  meeting: r.meeting,
  createdAt: Number(r.created_at),
  expiresAt: Number(r.expires_at),
  status: r.status,
  claimedAccount: r.claimed_account ?? undefined,
  claimedAt: r.claimed_at === null ? undefined : Number(r.claimed_at),
});

export class PgClaimsStore implements ClaimsStore {
  constructor(private readonly pool: Pool) {}

  /** Creates the table if needed. Safe to run on every start. */
  async migrate(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async insert(tokenHash: string, c: Claim) {
    await this.pool.query(
      `INSERT INTO claims (id, token_hash, owner, payee_name, amount, memo, meeting, created_at, expires_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [c.id, tokenHash, c.owner, c.payeeName, c.amount, c.memo ?? null, c.meeting, c.createdAt, c.expiresAt, c.status],
    );
  }
  async byTokenHash(tokenHash: string) {
    const r = await this.pool.query<Row>("SELECT * FROM claims WHERE token_hash = $1", [tokenHash]);
    return r.rows[0] ? toClaim(r.rows[0]) : null;
  }
  async byOwner(owner: string) {
    const r = await this.pool.query<Row>("SELECT * FROM claims WHERE owner = $1 ORDER BY created_at DESC LIMIT 200", [owner]);
    return r.rows.map(toClaim);
  }
  async countOpen(owner: string, now: number) {
    const r = await this.pool.query<{ n: string }>("SELECT count(*) AS n FROM claims WHERE owner = $1 AND status = 'open' AND expires_at > $2", [owner, now]);
    return Number(r.rows[0].n);
  }
  async markClaimed(id: string, account: string, at: number) {
    // One statement, so two people opening the same link can't both claim it.
    const r = await this.pool.query("UPDATE claims SET status = 'claimed', claimed_account = $2, claimed_at = $3 WHERE id = $1 AND status = 'open'", [id, account, at]);
    return r.rowCount === 1;
  }
  async cancel(owner: string, id: string) {
    const r = await this.pool.query("UPDATE claims SET status = 'cancelled' WHERE id = $1 AND owner = $2", [id, owner]);
    return r.rowCount === 1;
  }
}
