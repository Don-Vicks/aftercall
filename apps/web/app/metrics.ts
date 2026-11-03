import { Redis } from "@upstash/redis";

/**
 * Launch metrics and the waitlist live in Upstash Redis (added from the Vercel Marketplace,
 * which sets the KV_REST_API_* variables). Without them, counting is skipped and the
 * waitlist says it isn't open yet, so the site works the same either way.
 */
const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
export const redis = url && token ? new Redis({ url, token }) : null;

/** What gets counted: a visit to the site, a DMG download, a fetch of the install script. */
export type Kind = "visit" | "download" | "install";
export const KINDS: Kind[] = ["visit", "download", "install"];

/** Where it came from, from ?ref= on a link (x, telegram, …). Anything else is "other". */
export function cleanRef(raw: string | null | undefined): string {
  const r = (raw ?? "").trim().toLowerCase();
  if (!r) return "direct";
  return /^[a-z0-9-]{1,32}$/.test(r) ? r : "other";
}

const day = () => new Date().toISOString().slice(0, 10);
/** Days of per-day counts kept. */
const KEEP_DAYS = 120;

/** Adds one to the running total and to today's count for this channel. */
export async function count(kind: Kind, ref: string): Promise<void> {
  if (!redis) return;
  const today = `m:${kind}:${day()}`;
  await redis.pipeline().hincrby(`m:${kind}`, ref, 1).hincrby(today, ref, 1).expire(today, KEEP_DAYS * 86400).exec();
}

/** Totals and the last `days` days, per kind and channel. */
export async function readMetrics(days = 14) {
  if (!redis) return null;
  const dates = Array.from({ length: days }, (_, i) => new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  const out: Record<Kind, { total: Record<string, number>; byDay: { date: string; counts: Record<string, number> }[] }> = {
    visit: { total: {}, byDay: [] },
    download: { total: {}, byDay: [] },
    install: { total: {}, byDay: [] },
  };
  for (const kind of KINDS) {
    out[kind].total = ((await redis.hgetall<Record<string, number>>(`m:${kind}`)) ?? {}) as Record<string, number>;
    for (const date of dates) {
      out[kind].byDay.push({ date, counts: ((await redis.hgetall<Record<string, number>>(`m:${kind}:${date}`)) ?? {}) as Record<string, number> });
    }
  }
  return out;
}
