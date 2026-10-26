# Agent wallet contract

One shared NEAR contract that holds each user's USDC under rules only the user's own wallet can change.

| Who | Can call |
| --- | --- |
| The desktop app (function-call key) | `pay`, `record_proof` |
| The user's wallet (full-access key, 1 yoctoNEAR) | `set_cap`, `set_payment_cap`, `set_paused`, `add_payee`, `remove_payee`, `withdraw`, `approve_pending`, `cancel_pending` |
| Only the USDC contract | `ft_on_transfer` (deposits) |
| Only this contract | `on_pay_complete` (refunds a failed transfer) |

`pay` sends a payment only to a listed payee, within the daily cap and the per-payment cap. Anything over a cap is parked; only the owner's wallet can approve or decline it. A function-call key can't attach the 1 yoctoNEAR the owner methods require, so a stolen app key can't change the rules. There is no admin method that moves user funds, and each user's storage is paid from their own registration deposit.

## Test

```bash
cargo test -p agent-wallet --lib                                  # unit tests
cargo test -p agent-wallet --test sandbox -- --test-threads=1     # local NEAR node; needs cargo-near and the wasm32 target
```

17 tests: 4 unit, 13 sandbox. The sandbox tests deploy the contract with `mock-ft`, a USDC-like token, and cover deposits, the caps, parking and approving or declining payments, the limited key's limits, refunds on a failed transfer, the private callback and proof storage.

The last sandbox test drives the contract through `crates/near-tx`, the desktop app's own signer, over the node's JSON-RPC: the app's limited key records a proof, is refused a duplicate, pays a listed payee, and can't change a rule.

## Deploy to testnet

```bash
./scripts/deploy-testnet.sh yourname.testnet
```

Creates `wallet.yourname.testnet`, deploys and initialises it with Circle's testnet USDC, and registers it with the token. Needs [near-cli-rs](https://github.com/near/near-cli-rs) with your key in the keychain, and about 3 testnet NEAR. Not run yet: it waits on a testnet account.
