# NEAR Intents 1Click: paying a payee on Solana or Base

Research notes for README M6, "Pay a payee on Solana or Base through NEAR Intents 1Click under the same caps". Checked on 26 Oct 2026 against the docs and the live API. Only free, credential-less calls were made: `GET /v0/tokens`, two dry quotes, one non-dry quote (it creates a deposit address but moves nothing; nothing was ever deposited) and one status read. No transaction was signed and nothing touched NEAR mainnet.

## Sources

- OpenAPI spec, version 0.1.10: https://1click.chaindefuser.com/docs/v0/openapi.yaml. Every field the client uses comes from this spec.
- Making a request (quote, deposit, status): https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request.md
- API keys: https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication.md
- Fee configuration: https://docs.near-intents.org/integration/distribution-channels/1click-api/fee-config.md
- Fees: https://docs.near-intents.org/resources/fees.md
- Verify quote signatures: https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature.md
- Docs index: https://docs.near-intents.org/llms.txt

## The flow

Base URL: `https://1click.chaindefuser.com`.

1. **Tokens.** `GET /v0/tokens` returns `[{ assetId, decimals, blockchain, symbol, price, priceUpdatedAt, contractAddress? }]`. It needs no key. The assets used here (live list, 26 Oct 2026):

   | Asset | `assetId` | Decimals |
   | --- | --- | --- |
   | USDC on NEAR (Circle) | `nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | 6 |
   | USDC on Solana | `nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near` | 6 |
   | USDC on Base | `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near` | 6 |

   These are mainnet assets. There is no 1Click on NEAR testnet, so the feature only runs against a mainnet agent wallet.

2. **Quote.** `POST /v0/quote`. Required fields: `dry`, `swapType`, `slippageTolerance` (basis points), `originAsset`, `depositType`, `destinationAsset`, `amount` (base units as an integer string), `refundTo`, `refundType`, `recipient`, `recipientType`, `deadline` (ISO time). Aftercall sends:

   ```json
   {
     "dry": false, "swapType": "EXACT_INPUT", "slippageTolerance": 100,
     "originAsset": "nep141:17208628…33a1", "depositType": "ORIGIN_CHAIN",
     "destinationAsset": "nep141:sol-5ce3…0186.omft.near", "amount": "5000000",
     "refundTo": "<owner>.near", "refundType": "ORIGIN_CHAIN",
     "recipient": "<payee's Solana address>", "recipientType": "DESTINATION_CHAIN",
     "deadline": "<now + 30 min>"
   }
   ```

   - `dry: true` simulates the quote: per the spec the response then has no `depositAddress`, `timeWhenInactive` or `deadline`. Aftercall uses it for the preview shown before approval.
   - The response is `{ correlationId, timestamp, signature, quoteRequest, quote }`. `quote` holds `amountIn`, `minAmountIn`, `amountOut`, `minAmountOut`, the `*Formatted` and `*Usd` variants, `timeEstimate` (seconds), `refundFee`, `withdrawFee` and, for non-dry quotes, `depositAddress`, `deadline` and `timeWhenInactive`. The live API answered HTTP 201.
   - The API has no field called "quote id". Aftercall records `correlationId` as the quote's id. The deposit address is what identifies the swap for status and support.
   - With `depositType: ORIGIN_CHAIN` and NEAR USDC as origin, the deposit address was a 64-character hex NEAR implicit account (`69f5ecce…1f74` in the live test). The contract relies on that shape.
   - `swapType` also offers `EXACT_OUTPUT`, `FLEX_INPUT` and `ANY_INPUT` (partners only). Aftercall uses `EXACT_INPUT`, so the amount the caps count is exactly what leaves the agent wallet and the payee gets that amount minus fees.

3. **Deposit.** For `ORIGIN_CHAIN` quotes, transfer the tokens to `depositAddress`; "the swap begins automatically upon receipt" (quickstart). Optionally `POST /v0/deposit/submit` with `{ txHash, depositAddress, nearSenderAccount? , memo? }` to speed things up (`nearSenderAccount` is "used only for NEAR blockchain"). Some chains need `depositMemo`; NEAR does not (the quote had none).

4. **Status.** `GET /v0/status?depositAddress=…` (plus `depositMemo` if the quote had one) returns `{ correlationId, quoteResponse, status, updatedAt, swapDetails }`. `status` is one of `KNOWN_DEPOSIT_TX`, `PENDING_DEPOSIT`, `INCOMPLETE_DEPOSIT`, `PROCESSING`, `SUCCESS`, `REFUNDED`, `FAILED`. `swapDetails` has `amountOut`, `refundedAmount`, `refundReason`, `originChainTxHashes` and `destinationChainTxHashes` (`{ hash, explorerUrl }`). The live response for an unfunded address returned `PENDING_DEPOSIT` with many `swapDetails` fields set to `null`, although the spec types them as strings. The client's zod schemas accept `null` there.

## Is a key or JWT needed?

No. Quote, status, tokens and deposit/submit all worked without credentials. The spec lists `X-API-Key` (recommended) or a bearer JWT as optional security schemes, and the docs say: "Unauthenticated requests incur an additional **0.25% (25 basis points)** platform fee on every non-`ANY_INPUT` quote." With a partner JWT from https://partners.near-intents.org, stablecoin routes cost 1 bp. The client sends `X-API-Key` only when one is configured. The desktop app sends none: a key would be a secret, and getting one means signing up as a partner.

What we saw differs from the docs. The unauthenticated quotes echoed `appFees: [{ recipient: "5880ad2b…47dd", fee: 1 }]`. A 5 USDC payout quoted 4.988994 USDC on Solana (`withdrawFee` 0.010002) and 4.996595 USDC on Base (`withdrawFee` 0.0024), which is about 1 to 2 bps plus the withdrawal fee, not 25 bps. The app reads the fee from each quote as `amountIn − amountOut` and shows it. It refuses quotes over 3%. It doesn't assume any fee schedule.

CORS: the API answers `access-control-allow-origin: *` (tested with a preflight), so the desktop webview calls it directly.

## How Aftercall uses it

- **Contract** (`contracts/agent-wallet`). The owner opts a listed payee in with `set_payee_destination(payee, { chain: "solana" | "base", address })`. That takes 1 yoctoNEAR, so only the owner's wallet can do it, and it's undone by `None` or by removing the payee. The app's limited key calls the same `pay` method with an extra `cross_chain: { deposit_address, quote_id }`. The contract then:
  - runs the usual checks: listed payee, not paused, enough balance, follow-up not already paid;
  - requires the payee to have a destination (`NO_DESTINATION`) and the deposit address to be a 64-hex implicit account (`BAD_DEPOSIT_ADDRESS`);
  - applies the same daily cap and per-payment cap, and a separate cross-chain cap (`set_cross_chain_cap`, 1 yoctoNEAR, a UTC-day limit that starts at 0, so cross-chain is off until the owner sets it); over any cap it returns `blocked` (`OVER_PAYMENT_CAP`, `OVER_CAP` or `OVER_CROSS_CHAIN_CAP`) but does not park the payment, because the quote would expire before the owner could approve it;
  - registers the deposit address with USDC (`storage_deposit`, 0.00125 NEAR taken from the owner's storage credit); a callback (`on_deposit_address_registered`) then `ft_transfer`s the USDC there;
  - records `{ payee, amount, chain, address, deposit_address, quote_id, sent_at }` (view: `get_cross_chain_payment`; `sent_at` is nanoseconds as a string);
  - if the registration fails, undoes the payment and puts the fee back on the storage credit; if the transfer bounces, refunds the balance and both caps (for the day the payment was counted in) and deletes the record, and the fee stays spent because it registered the address.
- **Core** (`packages/core/src/intents/oneclick.ts`). The 1Click client with injected `fetch`, zod-validated responses, a check that a quote is for the payment that was asked for, and status polling.
- **Desktop.** If the payee has a destination, a payment follow-up shows the route ("USDC on NEAR → USDC on Solana via NEAR Intents") and a dry quote with the amount out and fee. Approving fetches a real quote, calls `pay` with the route (`near_pay_cross_chain`), submits the deposit transaction to 1Click and polls status until `SUCCESS`, `REFUNDED` or `FAILED`. Cross-chain payments never run on autopilot.

## The trust gap

The contract can't verify that a deposit address really pays the payee's Solana or Base address. That promise sits in 1Click's off-chain quote, which the contract never sees. So the guarantees are weaker than for a NEAR payee:

- A NEAR payment can only reach an account the owner listed. A cross-chain payment can reach any implicit account the app's key names. Someone holding a stolen app key could get a quote to their own address, or pass an implicit account they control as the "deposit address", and take up to the cross-chain cap each day (never more than the daily cap, in payments no bigger than the per-payment cap if one is set), as long as the owner has opted at least one payee in.
- What limits that: opting in is per payee and owner-signed, and it's off unless set. The cross-chain cap is 0 (cross-chain off) until the owner sets it, and only the owner's wallet can raise it. The other caps and pause apply unchanged. Only 64-hex implicit accounts are accepted, never named accounts. Every payment is recorded on chain with its deposit address and quote id, so it can be checked against 1Click's explorer and status API afterwards.
- The app checks that the quote's `quoteRequest.recipient`, `destinationAsset` and `amount` match what was asked for, and that the deposit address has the implicit-account shape. It doesn't yet verify 1Click's quote `signature` (`verifyQuoteSignature` in `@defuse-protocol/one-click-sdk-typescript`). That would guard against a tampered response in transit, not against a stolen key.
- Refunds go to `refundTo`, the owner's own NEAR account, not back into the agent wallet: a plain `ft_transfer` from 1Click can't credit the contract's per-user balance. The contract doesn't see refunds, so a refunded payment stays counted against that day's cap and marked paid.
- The 0.00125 NEAR used to register a deposit address comes back to the owner's storage credit only when the registration failed. If the token reports the address was already registered, it refunds the fee to the contract, not the owner.

The cross-chain cap is the lever for a lower ceiling on these payments; it doesn't touch NEAR payments. Binding the recipient on chain would close the gap: send through the Intents verifier (`intents.near`) with a message the contract builds from the stored destination, so the app's key supplies only the amount. That is a later step, not small: a withdrawal to Solana or Base from `intents.near` needs a swap intent signed for the contract's account, which a contract can't sign on its own.

## Storage layout

`Payee` and the contract's root state are unchanged. Destinations and cross-chain records live in two `LookupMap`s with their own storage prefixes (`StorageKey::Destinations`, `StorageKey::CrossChainPayments`, appended to the enum), outside the state struct. The cross-chain cap and its day's spending are two fields on each `Wallet` record (added 3 Nov 2026), so a contract holding wallets from before that can't be upgraded in place; testnet is redeployed fresh instead ([contracts/README.md](../contracts/README.md)).
