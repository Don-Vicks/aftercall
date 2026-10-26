# Agent wallet contract

One shared NEAR contract that holds each user's USDC under rules only the user's own wallet can change.

| Who | Can call |
| --- | --- |
| The desktop app (function-call key) | `pay`, `record_proof` |
| The user's wallet (full-access key, 1 yoctoNEAR) | `set_cap`, `set_payment_cap`, `set_paused`, `add_payee`, `remove_payee`, `set_payee_destination`, `withdraw`, `approve_pending`, `cancel_pending` |
| Only the USDC contract | `ft_on_transfer` (deposits) |
| Only this contract | `on_pay_complete` (refunds a failed transfer) |

`pay` sends a payment only to a listed payee, within the daily cap and the per-payment cap. Anything over a cap is parked; only the owner's wallet can approve or decline it. A function-call key can't attach the 1 yoctoNEAR the owner methods require, so a stolen app key can't change the rules. There is no admin method that moves user funds, and each user's storage is paid from their own registration deposit.

Cross-chain payouts: the owner can opt a payee in to being paid on Solana or Base (`set_payee_destination`). The app then calls the same `pay` with a `cross_chain` route, and the USDC goes to a NEAR Intents 1Click deposit address (a 64-hex implicit account) under the same caps and pause. Each payment is recorded (`get_cross_chain_payment`). The contract can't verify that a deposit address pays the payee's address; see [docs/near-intents-1click.md](../docs/near-intents-1click.md) for that trust gap.

## Test

```bash
cargo test -p agent-wallet --lib                                  # unit tests
cargo test -p agent-wallet --test sandbox -- --test-threads=1     # local NEAR node; needs cargo-near and the wasm32 target
```

28 tests: 13 unit, 15 sandbox. The sandbox tests deploy the contract with `mock-ft`, a USDC-like token, and cover deposits, the caps, parking and approving or declining payments, the limited key's limits, refunds on a failed transfer, the private callback, proof storage, and cross-chain payouts (sent to the deposit address within the caps, refused for unlisted or not-opted-in payees, while paused, or for another caller).

The last sandbox test drives the contract through `crates/near-tx`, the desktop app's own signer, over the node's JSON-RPC: the app's limited key records a proof, is refused a duplicate, pays a listed payee, and can't change a rule.

## Deploy to testnet

```bash
./scripts/deploy-testnet.sh yourname.testnet
```

Creates `wallet.yourname.testnet`, deploys and initialises it with Circle's testnet USDC, and registers it with the token. Needs [near-cli-rs](https://github.com/near/near-cli-rs) with your key in the keychain, and about 3 testnet NEAR. Not run yet: it waits on a testnet account.
