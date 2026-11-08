import { HttpException, HttpStatus } from "@nestjs/common";
import type { Pool } from "pg";
import type { NearAiAdmin } from "./admin";
import { limitKey, utcDay, type DailyCounts } from "../limits";
import type { Counters } from "../stats/counters";

/*
 * Test credits: one capped NEAR AI key per install of the Mac app, paid from
 * Aftercall's own NEAR AI workspace; or, with only NEARAI_TESTER_KEY set, one shared key
 * every install gets, capped only by the spend limit set on it in NEAR AI's dashboard. The key goes back to the app once, which keeps
 * it in the Keychain; this server never stores it. What stays is a hash of the
 * install id, NEAR AI's id for the key and when it was made, so the same install
 * isn't given a second key, plus per-IP daily counts under a hashed key.
 */

export interface TesterKeyOptions {
  /** Each key's spend limit in USD. */
  spendLimitUsd: number;
  /** Keys made in all, ever. When they're gone the app says so and asks for your own key. */
  maxKeys: number;
  /** Keys a single IP address may get in a day. */
  perIpPerDay: number;
  /** Every install gets the same key (`sharedKeyAdmin`): no per-tester cap, only the key's own. */
  shared?: boolean;
}

export interface IssuedKeys {
  has(installHash: string): Promise<boolean>;
  count(): Promise<number>;
  insert(installHash: string, keyId: string, at: number): Promise<void>;
}

export class MemoryIssuedKeys implements IssuedKeys {
  private readonly rows = new Map<string, { keyId: string; at: number }>();
  async has(h: string) {
    return this.rows.has(h);
  }
  async count() {
    return this.rows.size;
  }
  async insert(h: string, keyId: string, at: number) {
    this.rows.set(h, { keyId, at });
  }
}

export class PgIssuedKeys implements IssuedKeys {
  constructor(private readonly pool: Pool) {}
  async migrate(): Promise<void> {
    await this.pool.query("CREATE TABLE IF NOT EXISTS tester_keys (install_hash text PRIMARY KEY, key_id text NOT NULL, created_at bigint NOT NULL)");
  }
  async has(h: string) {
    return ((await this.pool.query("SELECT 1 FROM tester_keys WHERE install_hash = $1", [h])).rowCount ?? 0) > 0;
  }
  async count() {
    const r = await this.pool.query<{ n: string }>("SELECT count(*) AS n FROM tester_keys");
    return Number(r.rows[0]?.n ?? 0);
  }
  async insert(h: string, keyId: string, at: number) {
    await this.pool.query("INSERT INTO tester_keys (install_hash, key_id, created_at) VALUES ($1, $2, $3)", [h, keyId, at]);
  }
}

/** A random id the app makes once per install: letters, digits and dashes. */
const INSTALL_ID = /^[a-z0-9-]{16,64}$/;

export class TesterKeys {
  constructor(
    private readonly admin: NearAiAdmin | null,
    private readonly issued: IssuedKeys,
    private readonly daily: DailyCounts,
    private readonly options: TesterKeyOptions,
    private readonly now: () => number = Date.now,
    private readonly counters?: Counters,
  ) {}

  /** What the app shows before asking: whether test credits are on, and each key's limit. */
  async status(): Promise<{ available: boolean; spendLimitUsd: number; shared?: true }> {
    const available = this.admin !== null && (await this.issued.count()) < this.options.maxKeys;
    return { available, spendLimitUsd: this.options.spendLimitUsd, ...this.sharedFlag() };
  }

  private sharedFlag(): { shared?: true } {
    return this.options.shared ? { shared: true } : {};
  }

  async issue(installId: unknown, ip: string): Promise<{ key: string; spendLimitUsd: number; shared?: true }> {
    if (!this.admin) throw new HttpException("TEST_CREDITS_OFF", HttpStatus.SERVICE_UNAVAILABLE);
    if (typeof installId !== "string" || !INSTALL_ID.test(installId)) throw new HttpException("BAD_INSTALL_ID", HttpStatus.BAD_REQUEST);
    const install = limitKey("install", installId);
    if (await this.issued.has(install)) throw new HttpException("ALREADY_ISSUED", HttpStatus.CONFLICT);
    if ((await this.issued.count()) >= this.options.maxKeys) throw new HttpException("TEST_CREDITS_USED_UP", HttpStatus.SERVICE_UNAVAILABLE);
    const day = utcDay(this.now());
    const ipKey = limitKey("tester-key-ip", ip);
    if ((await this.daily.get(ipKey, day)) >= this.options.perIpPerDay) throw new HttpException("IP_DAILY_LIMIT", HttpStatus.TOO_MANY_REQUESTS);

    let made: { id: string; key: string };
    try {
      made = await this.admin.createKey(`tester-${install.slice(0, 8)}`, this.options.spendLimitUsd);
    } catch (e) {
      // Only the status: nothing NEAR AI sent back is passed on or logged.
      const status = e instanceof Error ? (/NEARAI_\w+ \d+/.exec(e.message)?.[0] ?? "") : "";
      throw new HttpException(status ? `NEAR_AI_FAILED (${status})` : "NEAR_AI_FAILED", HttpStatus.BAD_GATEWAY);
    }
    await this.issued.insert(install, made.id, this.now());
    await this.daily.increment(ipKey, day).catch(() => {});
    await this.counters?.increment("tester_keys").catch(() => {});
    return { key: made.key, spendLimitUsd: this.options.spendLimitUsd, ...this.sharedFlag() };
  }
}
