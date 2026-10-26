import { Injectable } from "@nestjs/common";
import type { Network } from "../network";

/** What the agent-wallet contract's `get_stats` returns. */
export interface ChainStats {
  wallets: number;
  proofs: number;
  payments: number;
  parked: number;
}

/**
 * Aftercall's public numbers. Counts only: no accounts, names, amounts or meeting
 * content. A count is null when its source isn't configured or didn't answer.
 */
export interface Stats {
  network: Network;
  /** Meeting proofs recorded on the contract. */
  meetingsVerified: number | null;
  walletsRegistered: number | null;
  /** USDC payments sent to payees and not refunded. */
  paymentsSent: number | null;
  /** Payments parked over a cap for the owner's approval. */
  paymentsParked: number | null;
  claimLinksCreated: number | null;
  claimLinksClaimed: number | null;
  emailsSent: number | null;
  /** When these were read (ISO 8601). */
  updatedAt: string;
}

export interface StatsSources {
  network: Network;
  chain?: () => Promise<ChainStats>;
  claims: () => Promise<{ created: number; claimed: number }>;
  emailsSent: () => Promise<number>;
}

export const STATS_TTL_MS = 60_000;

/** Reads the agent-wallet contract's public counters over JSON-RPC. */
export function rpcChainStats(rpcUrl: string, contract: string): () => Promise<ChainStats> {
  return async () => {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "aftercall-stats",
        method: "query",
        params: { request_type: "call_function", finality: "final", account_id: contract, method_name: "get_stats", args_base64: "e30=" },
      }),
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await res.json()) as { result?: { result?: number[]; error?: string }; error?: unknown };
    if (!body.result?.result) throw new Error("get_stats failed");
    const s = JSON.parse(Buffer.from(body.result.result).toString("utf8")) as Partial<ChainStats>;
    const n = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);
    return { wallets: n(s.wallets), proofs: n(s.proofs), payments: n(s.payments), parked: n(s.parked) };
  };
}

const orNull = async <T>(read?: () => Promise<T>): Promise<T | null> => {
  if (!read) return null;
  try {
    return await read();
  } catch {
    return null;
  }
};

@Injectable()
export class StatsService {
  private cached: { at: number; stats: Promise<Stats> } | null = null;

  constructor(
    private readonly sources: StatsSources,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = STATS_TTL_MS,
  ) {}

  /** The stats, read at most once per minute however many people ask. */
  get(): Promise<Stats> {
    const now = this.now();
    if (!this.cached || now - this.cached.at >= this.ttlMs) {
      this.cached = { at: now, stats: this.read(now) };
    }
    return this.cached.stats;
  }

  private async read(now: number): Promise<Stats> {
    const [chain, claims, emails] = await Promise.all([orNull(this.sources.chain), orNull(this.sources.claims), orNull(this.sources.emailsSent)]);
    return {
      network: this.sources.network,
      meetingsVerified: chain?.proofs ?? null,
      walletsRegistered: chain?.wallets ?? null,
      paymentsSent: chain?.payments ?? null,
      paymentsParked: chain?.parked ?? null,
      claimLinksCreated: claims?.created ?? null,
      claimLinksClaimed: claims?.claimed ?? null,
      emailsSent: emails,
      updatedAt: new Date(now).toISOString(),
    };
  }
}
