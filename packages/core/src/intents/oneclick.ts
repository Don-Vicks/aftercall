import { z } from "zod";

/**
 * NEAR Intents 1Click client: quote → deposit → status, for paying a payee's
 * Solana or Base address with USDC from the agent wallet on NEAR.
 *
 * Every field here comes from the 1Click OpenAPI spec
 * (https://1click.chaindefuser.com/docs/v0/openapi.yaml, v0.1.10) and was checked
 * against live dry quotes; see docs/near-intents-1click.md. `fetch` is injected so
 * tests never touch the network.
 */

export const ONECLICK_URL = "https://1click.chaindefuser.com";

/** Chains a payee may be paid on outside NEAR. Matches the contract's `Destination.chain`. */
export type PayoutChain = "solana" | "base";
export const PAYOUT_CHAINS: PayoutChain[] = ["solana", "base"];

/**
 * 1Click asset ids (GET /v0/tokens, 26 Oct 2026). 1Click runs on NEAR mainnet only.
 * Origin: Circle USDC on NEAR. Destinations: native USDC on Solana and Base, bridged by omft.near.
 */
export const ONECLICK_ASSETS = {
  nearUsdc: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  solana: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
  base: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
} as const;

export const CHAIN_NAME: Record<PayoutChain, string> = { solana: "Solana", base: "Base" };

/** "USDC on NEAR → USDC on Solana via NEAR Intents" */
export const routeLabel = (chain: PayoutChain) => `USDC on NEAR → USDC on ${CHAIN_NAME[chain]} via NEAR Intents`;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM = /^0x[0-9a-fA-F]{40}$/;

/** Same rule as the contract's `valid_destination`. */
export function isValidPayoutAddress(chain: PayoutChain, address: string): boolean {
  return chain === "solana" ? BASE58.test(address) : chain === "base" ? EVM.test(address) : false;
}

/** 1Click deposit addresses on NEAR are implicit accounts; the contract refuses anything else. */
export const isNearDepositAddress = (address: string) => /^[0-9a-f]{64}$/.test(address);

// ---------- responses ----------

const amount = z.string().regex(/^\d+$/);
/** The status endpoint returns null for fields the spec types as strings, so optional fields accept null. */
const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish();

export const tokenSchema = z.object({
  assetId: z.string(),
  decimals: z.number(),
  blockchain: z.string(),
  symbol: z.string(),
  price: z.number(),
  priceUpdatedAt: z.string(),
  contractAddress: opt(z.string()),
});
export type OneClickToken = z.infer<typeof tokenSchema>;

export const quoteSchema = z.object({
  depositAddress: opt(z.string()),
  depositMemo: opt(z.string()),
  amountIn: amount,
  amountInFormatted: z.string(),
  amountInUsd: z.string(),
  minAmountIn: amount,
  amountOut: amount,
  amountOutFormatted: z.string(),
  amountOutUsd: z.string(),
  minAmountOut: amount,
  deadline: opt(z.string()),
  timeWhenInactive: opt(z.string()),
  timeEstimate: z.number(),
  refundFee: opt(amount),
  withdrawFee: opt(amount),
});

export const quoteResponseSchema = z.object({
  correlationId: z.string(),
  timestamp: z.string(),
  signature: z.string(),
  quoteRequest: z.object({ dry: z.boolean(), recipient: z.string(), destinationAsset: z.string(), originAsset: z.string(), amount }).passthrough(),
  quote: quoteSchema,
});
export type QuoteResponse = z.infer<typeof quoteResponseSchema>;

export const SWAP_STATUSES = ["KNOWN_DEPOSIT_TX", "PENDING_DEPOSIT", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"] as const;
export type SwapStatus = (typeof SWAP_STATUSES)[number];
/** No further change is expected once a swap reaches one of these. */
export const FINAL_STATUSES: SwapStatus[] = ["SUCCESS", "REFUNDED", "FAILED"];

const txDetails = z.object({ hash: z.string(), explorerUrl: z.string() });

export const statusResponseSchema = z.object({
  correlationId: z.string(),
  status: z.enum(SWAP_STATUSES),
  updatedAt: z.string(),
  swapDetails: z.object({
    amountOut: opt(z.string()),
    amountOutFormatted: opt(z.string()),
    refundedAmount: opt(z.string()),
    refundReason: opt(z.string()),
    originChainTxHashes: z.array(txDetails).default([]),
    destinationChainTxHashes: z.array(txDetails).default([]),
  }),
});
export type StatusResponse = z.infer<typeof statusResponseSchema>;

// ---------- requests ----------

export interface PayoutQuoteInput {
  /** USDC base units leaving the agent wallet (6 decimals on both sides). */
  amount: bigint;
  chain: PayoutChain;
  /** The payee's address on `chain`. */
  recipient: string;
  /** NEAR account refunds go to: the owner, since the agent wallet can't credit a plain ft_transfer. */
  refundTo: string;
  /** `true` previews without creating a deposit address. */
  dry: boolean;
  /** Slippage in basis points. Default 100 (1%). */
  slippageBps?: number;
  /** How long until 1Click refunds an unfunded or unfinished swap. Default 30 minutes. */
  deadlineMs?: number;
  now?: number;
}

/** The QuoteRequest body for a USDC payout: EXACT_INPUT, deposit and refund on NEAR, paid out on the destination chain. */
export function payoutQuoteRequest(i: PayoutQuoteInput) {
  if (i.amount <= 0n) throw new Error("Amount must be positive");
  if (!isValidPayoutAddress(i.chain, i.recipient)) throw new Error(`Not a ${CHAIN_NAME[i.chain]} address`);
  return {
    dry: i.dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: i.slippageBps ?? 100,
    originAsset: ONECLICK_ASSETS.nearUsdc,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: ONECLICK_ASSETS[i.chain],
    amount: i.amount.toString(),
    refundTo: i.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: i.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date((i.now ?? Date.now()) + (i.deadlineMs ?? 30 * 60_000)).toISOString(),
  } as const;
}

// ---------- client ----------

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface OneClickOptions {
  fetch: Fetch;
  baseUrl?: string;
  /** Partner JWT, sent as X-API-Key. Optional: without it 1Click adds its unauthenticated fee. */
  apiKey?: string;
}

export class OneClickError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "OneClickError";
    this.status = status;
  }
}

export function createOneClickClient(o: OneClickOptions) {
  const base = o.baseUrl ?? ONECLICK_URL;
  const headers: Record<string, string> = { "content-type": "application/json", ...(o.apiKey ? { "X-API-Key": o.apiKey } : {}) };

  async function request<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, path: string, body?: unknown): Promise<T> {
    const res = await o.fetch(`${base}${path}`, body === undefined ? { headers } : { method: "POST", headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const message = data && typeof data === "object" && "message" in data ? String((data as { message: unknown }).message) : `HTTP ${res.status}`;
      throw new OneClickError(res.status, `1Click: ${message}`);
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new OneClickError(res.status, `1Click sent an unexpected response: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
    return parsed.data;
  }

  return {
    /** GET /v0/tokens */
    tokens: () => request(z.array(tokenSchema), "/v0/tokens"),

    /** POST /v0/quote. A non-dry quote must come back with a NEAR implicit deposit address for this exact request. */
    async quote(input: PayoutQuoteInput): Promise<QuoteResponse> {
      const body = payoutQuoteRequest(input);
      const q = await request(quoteResponseSchema, "/v0/quote", body);
      if (q.quoteRequest.recipient !== body.recipient || q.quoteRequest.destinationAsset !== body.destinationAsset || q.quoteRequest.amount !== body.amount) {
        throw new OneClickError(200, "1Click quoted a different payment than the one asked for");
      }
      if (!input.dry && !isNearDepositAddress(q.quote.depositAddress ?? "")) throw new OneClickError(200, "1Click's deposit address isn't a NEAR implicit account");
      return q;
    },

    /** POST /v0/deposit/submit: optional, speeds up processing once the deposit transaction landed. */
    submitDeposit: (txHash: string, depositAddress: string, nearSenderAccount: string) =>
      request(statusResponseSchema, "/v0/deposit/submit", { txHash, depositAddress, nearSenderAccount }),

    /** GET /v0/status */
    status: (depositAddress: string) => request(statusResponseSchema, `/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`),
  };
}

export type OneClickClient = ReturnType<typeof createOneClickClient>;

/** What the person sees before approving: amounts in USDC base units. */
export interface PayoutPreview {
  amountIn: bigint;
  amountOut: bigint;
  minAmountOut: bigint;
  /** amountIn − amountOut: every fee and spread, since both sides are 6-decimal USDC. */
  fee: bigint;
  seconds: number;
}

export function previewOf(q: QuoteResponse): PayoutPreview {
  const amountIn = BigInt(q.quote.amountIn);
  const amountOut = BigInt(q.quote.amountOut);
  return { amountIn, amountOut, minAmountOut: BigInt(q.quote.minAmountOut), fee: amountIn > amountOut ? amountIn - amountOut : 0n, seconds: q.quote.timeEstimate };
}

/** Polls status until the swap is final or `timeoutMs` passes; returns the last status seen. */
export async function waitForSettlement(
  client: Pick<OneClickClient, "status">,
  depositAddress: string,
  opts: { intervalMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void>; onStatus?: (s: StatusResponse) => void } = {},
): Promise<StatusResponse> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const interval = opts.intervalMs ?? 5000;
  let waited = 0;
  for (;;) {
    const s = await client.status(depositAddress);
    opts.onStatus?.(s);
    if (FINAL_STATUSES.includes(s.status) || waited >= (opts.timeoutMs ?? 10 * 60_000)) return s;
    await sleep(interval);
    waited += interval;
  }
}
