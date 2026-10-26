import type { Pool } from "pg";

/** Named running totals (e.g. "emails_sent"). Never per account. */
export interface Counters {
  increment(name: string): Promise<void>;
  get(name: string): Promise<number>;
}

export class MemoryCounters implements Counters {
  private readonly values = new Map<string, number>();
  async increment(name: string) {
    this.values.set(name, (this.values.get(name) ?? 0) + 1);
  }
  async get(name: string) {
    return this.values.get(name) ?? 0;
  }
}

export class PgCounters implements Counters {
  constructor(private readonly pool: Pool) {}

  /** Creates the table if needed. Safe to run on every start. */
  async migrate(): Promise<void> {
    await this.pool.query("CREATE TABLE IF NOT EXISTS counters (name text PRIMARY KEY, value bigint NOT NULL DEFAULT 0)");
  }
  async increment(name: string) {
    await this.pool.query("INSERT INTO counters (name, value) VALUES ($1, 1) ON CONFLICT (name) DO UPDATE SET value = counters.value + 1", [name]);
  }
  async get(name: string) {
    const r = await this.pool.query<{ value: string }>("SELECT value FROM counters WHERE name = $1", [name]);
    return r.rows[0] ? Number(r.rows[0].value) : 0;
  }
}
