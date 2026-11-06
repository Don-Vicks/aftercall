import { createHash } from "node:crypto";
import type { Pool } from "pg";

/**
 * Per-key counts for one UTC day, behind the daily limits (recaps per account,
 * tester keys per IP). Keys are hashed before they're stored, so the table holds
 * no account names or addresses, and rows older than yesterday are dropped as
 * new ones arrive. In Postgres the limits hold across restarts and instances.
 */
export interface DailyCounts {
  get(key: string, day: number): Promise<number>;
  increment(key: string, day: number): Promise<void>;
}

/** The stored form of a limit key: what it limits and for whom, hashed. */
export const limitKey = (scope: string, id: string) => createHash("sha256").update(`${scope}:${id}`).digest("hex");

/** Days since 1970 (UTC), the unit the limits reset on. */
export const utcDay = (ms: number) => Math.floor(ms / 86_400_000);

export class MemoryDailyCounts implements DailyCounts {
  private readonly values = new Map<string, number>();
  async get(key: string, day: number) {
    return this.values.get(`${key}/${day}`) ?? 0;
  }
  async increment(key: string, day: number) {
    for (const k of this.values.keys()) if (Number(k.split("/")[1]) < day - 1) this.values.delete(k);
    this.values.set(`${key}/${day}`, (this.values.get(`${key}/${day}`) ?? 0) + 1);
  }
}

export class PgDailyCounts implements DailyCounts {
  constructor(private readonly pool: Pool) {}

  /** Creates the table if needed. Safe to run on every start. */
  async migrate(): Promise<void> {
    await this.pool.query("CREATE TABLE IF NOT EXISTS daily_counts (key text NOT NULL, day integer NOT NULL, n integer NOT NULL DEFAULT 0, PRIMARY KEY (key, day))");
  }
  async get(key: string, day: number) {
    const r = await this.pool.query<{ n: number }>("SELECT n FROM daily_counts WHERE key = $1 AND day = $2", [key, day]);
    return r.rows[0] ? Number(r.rows[0].n) : 0;
  }
  async increment(key: string, day: number) {
    await this.pool.query("INSERT INTO daily_counts (key, day, n) VALUES ($1, $2, 1) ON CONFLICT (key, day) DO UPDATE SET n = daily_counts.n + 1", [key, day]);
    await this.pool.query("DELETE FROM daily_counts WHERE day < $1", [day - 1]);
  }
}
