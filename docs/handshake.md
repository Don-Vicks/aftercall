# Handshake: a deal both sides confirm

A payment agreed on a call, held in escrow on the agent-wallet contract until it is released. The payee checks the terms against NEAR and confirms them from their own NEAR account; the money then waits for the payer to release it, or, with no condition, goes to the payee at once.

**Status (7 Nov 2026):** built and tested on a local NEAR node, not yet deployed or run live. `wallet.aftercall.testnet` still runs the code from before Handshake; see [Deploying it](#deploying-it).

## From the call to the deal

1. **The call sets the terms.** A payment follow-up can carry a condition ("when the icons are delivered", "after the invoice"). The model gives it in plain words with its own exact quote from the transcript, like the amount; the app keeps it only when that quote is in the transcript (`packages/core/src/notes/build.ts`). A condition without a quote is dropped and the payment is marked (`conditionDropped`), so it can't be paid as if it had none. A payment with a condition, a dropped one or an escrow never runs on autopilot, never reaches the phone, and isn't approved from Home's list: it waits on the meeting's page, where the condition shows.
2. **Ask Kemi to confirm.** On a payment to a listed payee on NEAR, the card offers "Ask Kemi to confirm" (the main button when there's a condition). The meeting's proof must already be on the contract. The app's key calls `open_escrow`, then copies the confirm link; with Aftercall's backend, it can also email the link.
3. **Kemi checks and confirms.** The link opens `/deal`. It shows the amount, who pays, the condition and both quotes, reads the escrow and the meeting's proof from NEAR, and checks them (below). Only when every check passes can Kemi confirm, with her own wallet through NEAR Connect, as the account the escrow pays.
4. **Release.** With a condition, the card shows "Release" once Kemi has confirmed; the app's key pays it, after a 5-second undo. Without one, Kemi's confirmation pays her in the same transaction.

The app reads the escrow every 15 seconds while one waits, and the card says where it is: waiting for your wallet (over a cap), waiting for Kemi, confirmed, released, cancelled or given back.

## What goes on chain, and what doesn't

| | On NEAR, publicly | Only in the link's `#fragment` |
| --- | --- | --- |
| Escrow | Owner and escrow id (the follow-up's id: the recording's start time and its number), payee account, amount, the meeting's proof id and hash, `has_condition`, state, the UTC day it was counted, opened and confirmed times, and `terms_hash` | |
| Terms | Only `terms_hash`: sha256 over the network, contract, escrow id, owner, payee, amount, the words heard, the amount's quote, the condition, its quote, the meeting id, the proof hash and a random 128-bit salt (`dealTermsHash`, `packages/core/src/followups/deal.ts`) | All of them, with the payee's name and the meeting title as the payer wrote them (shown, not hashed) |

The salt keeps the hash from confirming a guess of the quotes. Browsers never send a `#fragment` to a server; the page reads it in the payee's browser. A link emailed through Aftercall passes the backend in memory and Resend, like a recap ([privacy.md](privacy.md#follow-ups-what-leaves-who-approves-whats-kept)).

## What `/deal` checks

`checkDeal` in `packages/core/src/followups/deal.ts`, against `get_escrow` and `get_proof` read at final finality (`readDealOnChain`):

- the escrow exists for that owner and id on that contract;
- its `terms_hash` is the hash of exactly the terms in the link;
- its amount and payee are the link's;
- `has_condition` matches whether the link has a condition (so a link can't hide one, or invent one);
- its proof id and hash are the link's, and the contract's proof for that meeting has the same hash.

Any failure: the page says not to confirm and offers no wallet buttons. The contract checks too: `confirm_escrow` needs the caller to be the payee, the terms hash to match, and 1 yoctoNEAR (a full-access key).

## The contract's rules

Methods on `contracts/agent-wallet` (unit and sandbox tests in brackets, listed in [proven.md](proven.md)):

| Method | Who | Rule |
| --- | --- | --- |
| `open_escrow(escrow_id, payee, amount, meeting_id, terms_hash, has_condition)` | The app's key (owner account, no deposit) | The same checks as `pay`: listed payee, not paused, the id not paid, parked or held already, at most 64 bytes. The meeting's proof must exist (`PROOF_NOT_FOUND`); its hash is copied in. `terms_hash` is 64 lowercase hex. Within the per-payment and daily caps, the amount leaves the balance now and counts towards today (state `open`). Over a cap, nothing moves: it is `parked`, counts against the 20 parked items like a payment, and waits for the owner's wallet. Storage is charged to the owner's credit once, here. |
| `approve_escrow(escrow_id)` | Owner's wallet, 1 yocto | `parked` only. Not paused, payee still listed, balance covers it; it then leaves the balance and counts towards that day (state `open`). |
| `confirm_escrow(owner, escrow_id, terms_hash)` | The payee's own account, 1 yocto | `open` only (`NOT_OPEN_YET` when parked). Caller must be the payee (`NOT_THE_PAYEE`), hash must match (`TERMS_DIFFER`). State `confirmed`, `confirmed_at` set. With no condition it is released in the same call (needs 50 TGas), unless the owner paused or delisted the payee; then it waits, confirmed. |
| `release_escrow(escrow_id)` | Owner account: the app's key, or the owner's wallet, no deposit | `confirmed` only (`NOT_CONFIRMED` before). Not paused, payee still listed, 50 TGas. Not counted against the caps again. Pays the payee's NEAR account. |
| `cancel_escrow(escrow_id)` | Owner's wallet, 1 yocto | `parked` or `open`: back to the owner. `confirmed`: only once 30 days have passed since the payee confirmed (`PAYEE_CONFIRMED` before). The amount goes back on the balance, and off today's spending if it's still the day it was counted. |
| `return_escrow(owner, escrow_id)` | The payee, 1 yocto | `open` or `confirmed`: the payee gives it back to the owner, same as cancelling. |
| `on_escrow_released` | Only the contract | After the transfer. If it failed, the escrow is `confirmed` again with its money still set aside, so it can be released again or given back. |
| `get_escrow(owner, escrow_id)`, `get_payment_proof(owner, followup_id)` | Anyone (view) | |

Once `released`, `cancelled` or `returned`, an escrow is closed for good (`ESCROW_CLOSED`); its record stays as the receipt, and its id can't be paid or held again. A release marks the state before the transfer runs, so nothing else can move the escrow meanwhile.

**The way out after confirming.** Before the payee confirms, the owner can call the deal off alone. After, neither side can take the money alone: the owner releases it, or the payee gives it back. If the owner neither releases it nor gets it back, their wallet can take it back once 30 days have passed since the payee confirmed. So a confirmed deal holds the money for the payee for at least 30 days. Nothing on chain judges whether a condition was met: Handshake proves the money is set aside, for whom, and on which terms both sides saw, and it leaves the decision to release with the payer, as on the call.

**What a stolen app key can do here.** Open escrows to listed payees within the caps (the same bound as `pay`), and release escrows their payees already confirmed, to those payees. It can't confirm (that needs the payee's account and 1 yocto), approve a parked one, cancel, or move money anywhere else.

**Payments link the proof too.** `pay` takes an optional `meeting_id`. With it, the proof must exist, and `get_payment_proof` gives the meeting id and proof hash the payment came from; a parked payment keeps it when approved, and a declined or refunded one frees it. The app passes it when the meeting's proof is on the same contract and account. Payments made before this have no link.

**Not here.** An escrow pays the payee's NEAR account only. Releasing to a payee's Solana or Base address would go through NEAR Intents 1Click, which runs on mainnet only; that isn't built, and the card offers no escrow for a payee paid on another chain.

## The app's key

The app's limited key may now call `pay`, `record_proof`, `open_escrow` and `release_escrow` (`APP_KEY_METHODS`, `packages/core/src/wallet/actions.ts`; checked in `apps/desktop/src-tauri/src/near.rs` `check_permission`). A key added before this still pays and records proofs; the app accepts it and says so in Agent wallet ("Update this Mac's key"), and Ask to confirm opens the update instead of failing. The update is one transaction on `/sign` from the owner's own wallet: delete the key and add the same key back with the four methods (`update-key`), so nothing else about the Mac changes. NEAR can't change a key's methods in place.

## Deploying it

Plain redeploy over the running contract, no migration call. The contract's root state gains no field; escrows and payment links live in maps on new storage prefixes (`StorageKey::Escrows`, `StorageKey::PaymentProofs`, appended), built on the fly. The sandbox test `upgrade_from_the_code_before_handshake_keeps_state_and_adds_escrows` deploys the code from before Handshake (`contracts/agent-wallet/tests/fixtures/agent_wallet_6184cac.wasm`, built from commit 6184cac; its sha256 `1fa7d6cb…` is the code hash [proven.md](proven.md) records for `wallet.aftercall.testnet`), fills it (a wallet, a payee, a proof, a paid and a parked payment), redeploys this code over it, checks every view reads the same, approves the old parked payment, pays with the old key, and opens, confirms and releases an escrow linked to the old proof. Commands: [contracts/README.md](../contracts/README.md#upgrade-testnet-in-place-handshake). Then each owner updates the Mac's key once.

Not run live: the redeploy, the key update in a real wallet, an escrow, `/deal` with a real wallet, and the confirm-link email.
