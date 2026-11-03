# Agent wallet contract

One shared NEAR contract that holds each user's USDC under rules only the user's own wallet can change.

| Who | Can call |
| --- | --- |
| The desktop app (function-call key) | `pay`, `record_proof` |
| The user's wallet (full-access key, 1 yoctoNEAR) | `set_cap`, `set_payment_cap`, `set_cross_chain_cap`, `set_paused`, `add_payee`, `remove_payee`, `set_payee_destination`, `withdraw`, `withdraw_storage_credit`, `approve_pending`, `cancel_pending` |
| The user's wallet (full-access key, NEAR attached) | `register` (at least 0.05 NEAR), `add_storage_credit` |
| Only the USDC contract | `ft_on_transfer` (deposits) |
| Only this contract | `new` (in the deploy transaction), `on_pay_complete`, `on_deposit_address_registered`, `on_withdraw_complete` (refund a failed transfer) |
| Anyone (view) | `get_wallet`, `get_payees`, `get_payee_label`, `get_payee_destinations`, `is_paid`, `get_pending`, `get_cross_chain_payment`, `get_proof`, `get_usdc`, `get_stats` |

`get_stats` returns counts across all users and nothing else: `{ "wallets", "proofs", "payments", "parked" }`. `payments` counts payments to payees that were sent and not refunded (withdrawals don't count); `parked` counts payments held over a cap. The counters live under their own storage key (`stats`), outside the contract's state struct, and the contract pays for their few bytes.

`pay` sends a payment only to a listed payee, within the daily cap and the per-payment cap. Anything over a cap is parked; only the owner's wallet can approve or decline it. Approving pays it once and still counts towards that day's spending. A payment is parked even when the balance can't cover it yet; the balance is checked when it is paid, so approving needs it. A per-payment cap of 0 means no per-payment limit. A memo is at most 256 bytes. A function-call key can't attach the 1 yoctoNEAR the owner methods require, so a stolen app key can't change the rules. There is no admin method that moves user funds.

**Storage.** Each user pays for every record they cause from their own storage credit: the wallet record (charged at `register`, out of the deposit; the rest becomes the credit), payees and destinations, parked payments, proofs, the paid mark of every payment and every cross-chain record. Freeing a record (declining a parked payment, removing a payee, a refunded payment) puts its cost back on the credit. When the credit runs out, anything that adds storage is refused with `STORAGE_CREDIT_LOW` until the owner tops it up with `add_storage_credit` (any amount attached). `withdraw_storage_credit(amount)` (1 yoctoNEAR; no amount takes it all) sends unused credit back to the owner's account; records already stored stay paid for. Both act only on the caller's own wallet. The contract's own NEAR pays only for the counters above and the 1 yoctoNEAR each `ft_transfer` needs.

**Refunds.** A payment whose `ft_transfer` fails is undone in `on_pay_complete`: the balance comes back, the follow-up can be paid again, its storage goes back on the credit, and the day's spending is lowered only if it's still the UTC day the payment was counted in, so a refund that lands after midnight can't lift the next day's cap. A withdrawal has its own callback (`on_withdraw_complete`) and no follow-up id, so a failed one only puts the USDC back on the balance and can't touch a payment's paid mark. `pay`, `approve_pending` and `withdraw` refuse less than 50 TGas up front; a cross-chain `pay` needs 70 TGas.

**Cross-chain payouts.** The owner can opt a payee in to being paid on Solana or Base (`set_payee_destination`). The app then calls the same `pay` with a `cross_chain` route, and the USDC goes to a NEAR Intents 1Click deposit address (a 64-hex implicit account) under the same caps and pause and under a separate cross-chain cap (`set_cross_chain_cap`, a UTC-day limit that every cross-chain payment must fit as well as the daily cap; `get_wallet` shows `cross_chain_daily_cap` and `cross_chain_spent_today`). The cross-chain cap starts at 0, which turns cross-chain payments off. Over any cap a cross-chain payment is refused (`OVER_PAYMENT_CAP`, `OVER_CAP` or `OVER_CROSS_CHAIN_CAP`), not parked, because the quote would expire before the owner could approve it. Each payment is recorded (`get_cross_chain_payment`). The contract registers the deposit address with USDC (0.00125 NEAR from the owner's storage credit) and then sends: if the registration fails, `on_deposit_address_registered` undoes the payment and puts the fee back on the credit; if the address registered but the transfer fails, the payment is undone and the fee stays spent (it registered the address). The contract can't verify that a deposit address pays the payee's address: whoever holds the app's key chooses the deposit address, so the cross-chain cap is what bounds a stolen key on this route. Keep it small. See [docs/near-intents-1click.md](../docs/near-intents-1click.md).

Views give block timestamps (`Proof.recorded_at`, `CrossChainPayment.sent_at`) as decimal strings of nanoseconds, because they are above 2^53.

### Known limits (from the 3 Nov 2026 audit, not changed)

- `pay` returns `"sending"` before the token transfer has run; the transaction succeeds even if the transfer later bounces. Read `is_paid` (or the `PAYMENT_FAILED` log) for the outcome, as the app does.
- A declined payment's follow-up id isn't consumed: the app could park it again, or pay it under the caps with the same id.
- A stolen app key can still spend the owner's storage credit by recording proofs (each up to about 0.003 NEAR of credit, with gas paid from the key's 0.25 NEAR allowance). Nothing else is lost; the owner removes the key and tops the credit up.
- Pausing also blocks `approve_pending` (it runs the same checks as `pay`). `cancel_pending` and `withdraw` still work.
- Payee labels, memos of parked payments, Solana and Base addresses, amounts and follow-up ids are public contract state, like everything on NEAR.
- Destinations are checked for format only (base58 characters and length for Solana, `0x` and 40 hex for Base), not decoded or checksummed.
- If a deposit address was already registered with USDC, the token returns the 0.00125 NEAR fee to the contract, not to the owner.
- After the mainnet lock: `usdc` can never change (a Circle token migration or a blocklisted contract would strand funds), USDC sent with a plain `ft_transfer` instead of `ft_transfer_call` is never credited, and the state has no version field.
- A later step, not built: send cross-chain payments through the Intents verifier (`intents.near`) with a message the contract builds from the stored destination, so the app's key never supplies an address. It isn't small: a withdrawal to Solana or Base from `intents.near` needs a swap intent signed for the contract's account, which a contract can't sign on its own.

## Test

```bash
cargo test -p agent-wallet --lib                                  # unit tests
cargo test -p agent-wallet --test sandbox -- --test-threads=1     # local NEAR node; needs cargo-near and the wasm32 target
```

50 tests: 31 unit, 19 sandbox. The sandbox tests deploy the contract with `mock-ft`, a USDC-like token with two test switches (a Circle-style blocklist, and a raised minimum storage deposit), and cover deposits, the caps, parking and approving or declining payments, the limited key's limits, refunds on a failed transfer and a failed withdrawal, the private callbacks and `new`, proof storage, storage credit running out and being topped up, the public counts, a locked contract (below), and cross-chain payouts (off until the cross-chain cap is set, sent to the deposit address within the caps, refunded when the registration or the transfer fails at exactly 70 TGas, refused for unlisted or not-opted-in payees, while paused, or for another caller). The unit tests add the audit's findings as regressions (a stolen key's cross-chain payment, storage charged for paid marks and the wallet record, a refund after midnight, a failed withdrawal next to a `withdraw-…` follow-up id, the registration fee, string timestamps, the memo cap, the gas floors). A refund landing after midnight is unit-tested only: a sandbox can't put a UTC day between a transfer and its callback.

One sandbox test drives the contract through `crates/near-tx`, the desktop app's own signer, over the node's JSON-RPC: the app's limited key records a proof, is refused a duplicate, pays a listed payee, and can't change a rule.

## Redeploy testnet fresh (after the 3 Nov 2026 audit fixes)

`wallet.aftercall.testnet` runs the code from 2 Nov 2026. The audit fixes change the stored layout (the `Wallet` record has two new fields, and the proof and cross-chain timestamps changed type in the views), so redeploy it from scratch before anyone registers. On 3 Nov 2026 it held nothing (`get_stats` returned all zeros over read-only RPC), so nothing is lost. Victor signs each step; nothing here has been run.

```bash
# 1. Read-only: check it's still empty. Expect {"wallets":0,"proofs":0,"payments":0,"parked":0}.
near contract call-function as-read-only wallet.aftercall.testnet get_stats json-args '{}' network-config testnet now

# 2. Delete the old contract account; its remaining NEAR goes back to aftercall.testnet.
near account delete-account wallet.aftercall.testnet beneficiary aftercall.testnet network-config testnet sign-with-keychain send

# 3. Recreate it, build, deploy and initialise the new code, and register it with testnet USDC
#    (the token kept the old registration, so that last step just refunds its 0.00125 NEAR).
./contracts/scripts/deploy-testnet.sh aftercall.testnet

# 4. Read-only checks: the USDC id (3e2210e1…b8af), and all-zero counts.
near contract call-function as-read-only wallet.aftercall.testnet get_usdc json-args '{}' network-config testnet now
near contract call-function as-read-only wallet.aftercall.testnet get_stats json-args '{}' network-config testnet now
```

If step 2 is refused, the in-place alternative is safe only while the counts are all zero (the contract's root state is unchanged, and there are no old records to misread):

```bash
cd contracts/agent-wallet && cargo near build non-reproducible-wasm
near contract deploy wallet.aftercall.testnet use-file ../target/near/agent_wallet/agent_wallet.wasm without-init-call network-config testnet sign-with-keychain send
```

The app needs no change: it still uses `wallet.aftercall.testnet`. Cross-chain payments stay off on every wallet until its owner sets a cross-chain cap.

## Deploy to testnet

```bash
./scripts/deploy-testnet.sh yourname.testnet
```

Creates `wallet.yourname.testnet`, deploys and initialises it with Circle's testnet USDC, and registers it with the token. Needs [near-cli-rs](https://github.com/near/near-cli-rs) with your key in the keychain, and about 3 testnet NEAR. Run on 2 Nov 2026 for `wallet.aftercall.testnet`, before the audit fixes; redeploy it fresh (above).

## Deploy to mainnet

```bash
DRY_RUN=1 ./scripts/deploy-mainnet.sh yourname.near   # prints every command; signs nothing
./scripts/deploy-mainnet.sh yourname.near             # deploys to wallet.yourname.near
./scripts/deploy-mainnet.sh --lock wallet.yourname.near  # only the lock step, e.g. after trying it
```

Same steps as testnet with Circle's mainnet USDC (`17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`), then it registers your own agent wallet with tiny caps: 5 USDC a day and 2 USDC a payment (`DAILY_CAP_USDC`, `PAYMENT_CAP_USDC` to change them). It won't start until you type the contract's account id, and it refuses to run without a terminal or with a `.testnet` account. Costs about 3.1 NEAR. Not run yet: it waits on Victor's mainnet account and their OK.

The script leaves the cross-chain cap at 0, so payments on Solana or Base stay off. To try one with a tiny cap (1 USDC a day), sign this from your own wallet:

```bash
near contract call-function as-transaction wallet.yourname.near set_cross_chain_cap json-args '{"cross_chain_daily_cap":"1000000"}' \
  prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as yourname.near network-config mainnet sign-with-keychain send
```

### Locking the contract

The last step, which asks again (type `LOCK wallet.yourname.near`), deletes every full-access key on the contract account.

- **What it means.** Nothing can be signed as the contract account any more. Nobody, us included, can redeploy or upgrade the code, call `new` again, delete the account or move the NEAR it holds. The code on chain is the code users checked.
- **What still works.** Everything users do, because none of it is signed by the contract account: owners change rules from their own wallets with 1 yoctoNEAR, the app's limited key calls `pay` and `record_proof`, USDC transfers and their refund callback run, and owners can always `withdraw`. The sandbox test `locked_contract_still_serves_owners_and_the_app_key` proves each of these after deleting the keys.
- **It is irreversible.** There is no way to add a key back. A bug can't be fixed in place: the fix is a new contract, and users withdraw and re-register there. Keep the caps small.
- **How to check.** The account should list no `FullAccess` keys:

  ```bash
  near account list-keys wallet.yourname.near network-config mainnet now
  # or over JSON-RPC:
  curl -s https://free.rpc.fastnear.com -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"wallet.yourname.near"}}'
  ```

  `"keys": []` means locked. Anyone can run this; it needs no key.
