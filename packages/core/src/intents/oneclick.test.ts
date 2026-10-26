import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createOneClickClient,
  isNearDepositAddress,
  isValidPayoutAddress,
  ONECLICK_ASSETS,
  payoutQuoteRequest,
  previewOf,
  routeLabel,
  waitForSettlement,
  type Fetch,
  type StatusResponse,
} from "./oneclick.ts";

const SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const DEPOSIT = "69f5eccee1e146961b47ac7cecb0f5caada2b6e1ee124e72e8b47adedd701f74";
const NOW = Date.parse("2026-10-26T12:44:07.000Z");

/** A real non-dry 1Click response (26 Oct 2026, 5 USDC NEAR → Solana), trimmed. Nothing was deposited. */
const quoteFixture = (overrides: Record<string, unknown> = {}) => ({
  quote: {
    amountIn: "5000000",
    amountInFormatted: "5.0",
    amountInUsd: "4.999220000000",
    minAmountIn: "5000000",
    amountOut: "4988994",
    amountOutFormatted: "4.988994",
    amountOutUsd: "4.988215716936",
    minAmountOut: "4939104",
    timeEstimate: 17,
    refundFee: "0",
    withdrawFee: "10002",
    deadline: "2026-10-29T13:14:07.000Z",
    timeWhenInactive: "2026-10-29T13:14:07.000Z",
    depositAddress: DEPOSIT,
    ...overrides,
  },
  quoteRequest: {
    dry: false,
    depositMode: "SIMPLE",
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: ONECLICK_ASSETS.nearUsdc,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: ONECLICK_ASSETS.solana,
    amount: "5000000",
    refundTo: "victor.near",
    refundType: "ORIGIN_CHAIN",
    recipient: SOL,
    recipientType: "DESTINATION_CHAIN",
    deadline: "2026-10-26T13:14:07.000Z",
  },
  signature: "ed25519:5JqURgJUBF5ku3N4ogu3AhsDvsCEFtjkmwLKXmKNX7XfzwrcgUbT6AAhXh6TGuJH2GSioctWi38jXVkDcdxDjP8j",
  timestamp: "2026-10-26T12:44:22.787Z",
  correlationId: "ecb38db7-2b32-450a-8ef2-0efc83ec6ea7",
});

/** The real status of that unfunded address: note the nulls the spec doesn't mention. */
const statusFixture = (status: string, extra: Record<string, unknown> = {}) => ({
  status,
  updatedAt: "2026-10-26T12:44:23.197Z",
  correlationId: "c736b03a-f914-4843-b3e6-55cbe7a3f307",
  swapDetails: {
    depositedAmount: null,
    intentHashes: [],
    nearTxHashes: [],
    amountIn: null,
    amountOut: null,
    amountOutFormatted: null,
    slippage: null,
    refundedAmount: "0",
    refundReason: null,
    withdrawFee: "10002",
    originChainTxHashes: [],
    destinationChainTxHashes: [],
    ...extra,
  },
});

function mockFetch(respond: (url: string, body: unknown) => { status?: number; json: unknown }) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetch: Fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init?.method ?? "GET", headers: init?.headers ?? {}, body });
    const r = respond(url, body);
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.json };
  };
  return { fetch, calls };
}

test("a payout quote asks for EXACT_INPUT USDC from NEAR to the payee's chain, refunds on NEAR", () => {
  const body = payoutQuoteRequest({ amount: 5_000_000n, chain: "solana", recipient: SOL, refundTo: "victor.near", dry: true, now: NOW });
  assert.deepEqual(body, {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: ONECLICK_ASSETS.nearUsdc,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: ONECLICK_ASSETS.solana,
    amount: "5000000",
    refundTo: "victor.near",
    refundType: "ORIGIN_CHAIN",
    recipient: SOL,
    recipientType: "DESTINATION_CHAIN",
    deadline: "2026-10-26T13:14:07.000Z",
  });
  assert.throws(() => payoutQuoteRequest({ amount: 1n, chain: "base", recipient: SOL, refundTo: "v.near", dry: true }), /Not a Base address/);
  assert.throws(() => payoutQuoteRequest({ amount: 0n, chain: "solana", recipient: SOL, refundTo: "v.near", dry: true }), /positive/);
});

test("addresses: Solana base58, Base 0x, deposit addresses are NEAR implicit accounts", () => {
  assert.ok(isValidPayoutAddress("solana", SOL));
  assert.ok(!isValidPayoutAddress("solana", "0OIl" + SOL.slice(4)));
  assert.ok(isValidPayoutAddress("base", "0x2527D02599Ba641c19FEa793cD0F167589a0f10D"));
  assert.ok(!isValidPayoutAddress("base", "0x2527"));
  assert.ok(isNearDepositAddress(DEPOSIT));
  assert.ok(!isNearDepositAddress("attacker.near"));
  assert.equal(routeLabel("solana"), "USDC on NEAR → USDC on Solana via NEAR Intents");
});

test("quote posts the request, validates the answer and shows amount out and fee", async () => {
  const { fetch, calls } = mockFetch(() => ({ status: 201, json: quoteFixture() }));
  const client = createOneClickClient({ fetch });
  const q = await client.quote({ amount: 5_000_000n, chain: "solana", recipient: SOL, refundTo: "victor.near", dry: false, now: NOW });
  assert.equal(calls[0].url, "https://1click.chaindefuser.com/v0/quote");
  assert.equal(calls[0].method, "POST");
  assert.equal((calls[0].body as { recipient: string }).recipient, SOL);
  assert.equal(calls[0].headers["X-API-Key"], undefined, "no key unless one is configured");
  assert.equal(q.quote.depositAddress, DEPOSIT);
  assert.deepEqual(previewOf(q), { amountIn: 5_000_000n, amountOut: 4_988_994n, minAmountOut: 4_939_104n, fee: 11_006n, seconds: 17 });
});

test("a quote for another recipient, or a non-implicit deposit address, is refused", async () => {
  const other = mockFetch(() => ({ json: { ...quoteFixture(), quoteRequest: { ...quoteFixture().quoteRequest, recipient: "Attacker1111111111111111111111111111111111" } } }));
  await assert.rejects(createOneClickClient(other).quote({ amount: 5_000_000n, chain: "solana", recipient: SOL, refundTo: "v.near", dry: false }), /different payment/);
  const named = mockFetch(() => ({ json: quoteFixture({ depositAddress: "attacker.near" }) }));
  await assert.rejects(createOneClickClient(named).quote({ amount: 5_000_000n, chain: "solana", recipient: SOL, refundTo: "v.near", dry: false }), /implicit account/);
});

test("a dry quote needs no deposit address; an API key goes in X-API-Key", async () => {
  const { fetch, calls } = mockFetch(() => ({ json: { ...quoteFixture({ depositAddress: undefined, deadline: undefined }), quoteRequest: { ...quoteFixture().quoteRequest, dry: true } } }));
  const q = await createOneClickClient({ fetch, apiKey: "jwt" }).quote({ amount: 5_000_000n, chain: "solana", recipient: SOL, refundTo: "v.near", dry: true });
  assert.equal(q.quote.depositAddress, undefined);
  assert.equal(calls[0].headers["X-API-Key"], "jwt");
});

test("errors carry 1Click's message; malformed answers are refused", async () => {
  const bad = mockFetch(() => ({ status: 400, json: { message: "recipient should not be empty" } }));
  await assert.rejects(createOneClickClient(bad).status(DEPOSIT), /recipient should not be empty/);
  const odd = mockFetch(() => ({ json: { status: "MAYBE" } }));
  await assert.rejects(createOneClickClient(odd).status(DEPOSIT), /unexpected response/);
});

test("status polls until the swap is final", async () => {
  const seq = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"];
  const { fetch, calls } = mockFetch(() => ({
    json: statusFixture(seq.shift()!, seq.length === 0 ? { amountOut: "4988994", destinationChainTxHashes: [{ hash: "5sol", explorerUrl: "https://solscan.io/tx/5sol" }] } : {}),
  }));
  const seen: StatusResponse["status"][] = [];
  const final = await waitForSettlement(createOneClickClient({ fetch }), DEPOSIT, { sleep: async () => {}, onStatus: (s) => seen.push(s.status) });
  assert.equal(final.status, "SUCCESS");
  assert.deepEqual(seen, ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"]);
  assert.equal(final.swapDetails.destinationChainTxHashes[0].hash, "5sol");
  assert.equal(calls[0].url, `https://1click.chaindefuser.com/v0/status?depositAddress=${DEPOSIT}`);
});

test("status polling gives up after the timeout and returns the last status", async () => {
  const { fetch } = mockFetch(() => ({ json: statusFixture("PENDING_DEPOSIT") }));
  const s = await waitForSettlement(createOneClickClient({ fetch }), DEPOSIT, { sleep: async () => {}, intervalMs: 1000, timeoutMs: 3000 });
  assert.equal(s.status, "PENDING_DEPOSIT");
});

test("submitting the deposit transaction names the NEAR sender", async () => {
  const { fetch, calls } = mockFetch(() => ({ json: statusFixture("KNOWN_DEPOSIT_TX") }));
  const s = await createOneClickClient({ fetch }).submitDeposit("9xTx", DEPOSIT, "victor.near");
  assert.equal(s.status, "KNOWN_DEPOSIT_TX");
  assert.deepEqual(calls[0].body, { txHash: "9xTx", depositAddress: DEPOSIT, nearSenderAccount: "victor.near" });
});
