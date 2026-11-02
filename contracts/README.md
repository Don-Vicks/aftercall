# Agent wallet contract

One shared NEAR contract that holds each user's USDC under rules only the user's own wallet can change.

| Who | Can call |
| --- | --- |
| The desktop app (function-call key) | `pay`, `record_proof` |
| The user's wallet (full-access key, 1 yoctoNEAR) | `set_cap`, `set_payment_cap`, `set_paused`, `add_payee`, `remove_payee`, `set_payee_destination`, `withdraw`, `approve_pending`, `cancel_pending` |
| Only the USDC contract | `ft_on_transfer` (deposits) |
| Only this contract | `on_pay_complete` (refunds a failed transfer) |
| Anyone (view) | `get_wallet`, `get_payees`, `get_payee_label`, `get_payee_destinations`, `is_paid`, `get_pending`, `get_cross_chain_payment`, `get_proof`, `get_usdc`, `get_stats` |

`get_stats` returns counts across all users and nothing else: `{ "wallets", "proofs", "payments", "parked" }`. `payments` counts payments to payees that were sent and not refunded (withdrawals don't count); `parked` counts payments held over a cap. The counters live under their own storage key (`stats`), outside the contract's state struct, and the contract pays for their few bytes.

`pay` sends a payment only to a listed payee, within the daily cap and the per-payment cap. Anything over a cap is parked; only the owner's wallet can approve or decline it. Approving pays it once and still counts towards that day's spending. A per-payment cap of 0 means no per-payment limit. A function-call key can't attach the 1 yoctoNEAR the owner methods require, so a stolen app key can't change the rules. There is no admin method that moves user funds, and each user's storage is paid from their own registration deposit.

Cross-chain payouts: the owner can opt a payee in to being paid on Solana or Base (`set_payee_destination`). The app then calls the same `pay` with a `cross_chain` route, and the USDC goes to a NEAR Intents 1Click deposit address (a 64-hex implicit account) under the same caps and pause. Over a cap it is refused, not parked, because the quote would expire before the owner could approve it. Each payment is recorded (`get_cross_chain_payment`). The contract can't verify that a deposit address pays the payee's address; see [docs/near-intents-1click.md](../docs/near-intents-1click.md) for that trust gap.

## Test

```bash
cargo test -p agent-wallet --lib                                  # unit tests
cargo test -p agent-wallet --test sandbox -- --test-threads=1     # local NEAR node; needs cargo-near and the wasm32 target
```

30 tests: 14 unit, 16 sandbox. The sandbox tests deploy the contract with `mock-ft`, a USDC-like token, and cover deposits, the caps, parking and approving or declining payments, the limited key's limits, refunds on a failed transfer, the private callback, proof storage, the public counts, a locked contract (below), and cross-chain payouts (sent to the deposit address within the caps, refused for unlisted or not-opted-in payees, while paused, or for another caller).

One sandbox test drives the contract through `crates/near-tx`, the desktop app's own signer, over the node's JSON-RPC: the app's limited key records a proof, is refused a duplicate, pays a listed payee, and can't change a rule.

## Deploy to testnet

```bash
./scripts/deploy-testnet.sh yourname.testnet
```

Creates `wallet.yourname.testnet`, deploys and initialises it with Circle's testnet USDC, and registers it with the token. Needs [near-cli-rs](https://github.com/near/near-cli-rs) with your key in the keychain, and about 3 testnet NEAR. Not run yet: it waits on a testnet account.

## Deploy to mainnet

```bash
DRY_RUN=1 ./scripts/deploy-mainnet.sh yourname.near   # prints every command; signs nothing
./scripts/deploy-mainnet.sh yourname.near             # deploys to wallet.yourname.near
./scripts/deploy-mainnet.sh --lock wallet.yourname.near  # only the lock step, e.g. after trying it
```

Same steps as testnet with Circle's mainnet USDC (`17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`), then it registers your own agent wallet with tiny caps: 5 USDC a day and 2 USDC a payment (`DAILY_CAP_USDC`, `PAYMENT_CAP_USDC` to change them). It won't start until you type the contract's account id, and it refuses to run without a terminal or with a `.testnet` account. Costs about 3.1 NEAR. Not run yet: it waits on Victor's mainnet account and their OK.

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
