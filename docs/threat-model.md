# Threat model

What Aftercall protects, and what can still go wrong. Each line points to the code and tests that back it; [proven.md](proven.md) lists the test names.

## What's worth protecting

- **What was said:** audio, transcript, notes, your own notes.
- **Money:** USDC in the agent wallet (`contracts/agent-wallet`) on NEAR.
- **The record:** a proof that the notes came from attested hardware and weren't changed since.
- **Secrets on the Mac** (macOS Keychain, service `dev.aftercall.app`): the data key, the app's NEAR key, the NEAR AI key, the backup key, the phone-relay key, the Slack webhook.

## The app's NEAR key, if it's stolen

The Mac holds a NEAR function-call key that may call only `pay`, `record_proof`, `open_escrow` and `release_escrow` on Aftercall's contract (`KEY_METHODS`, `apps/desktop/src-tauri/src/near.rs`; `APP_KEY_METHODS`, `packages/core/src/wallet/actions.ts`). Its fee allowance is 0.25 NEAR.

**What a thief could do:**
- Pay listed payees, within the per-payment cap and what's left of the daily cap.
- Park up to 20 payments over a cap; those wait for the owner's wallet.
- Record proofs.
- Open escrows to listed payees within the same caps.
- Release escrows their payees already confirmed.
- Spend the 0.25 NEAR fee allowance on gas.

**What it can't do:**
- Change any rule: the caps, the payee list, pause, withdraw, or approve and cancel parked payments and escrows.
  Every such method calls `assert_one_yocto`, and a NEAR function-call key can't attach a deposit, so only the owner's own wallet (a full-access key) can sign them.
- Pay anyone who isn't on the list, or pay more than the caps in a day.
- Confirm an escrow; that takes the payee's own account.

**Worst case:** one day's cap, to people you already listed. **The fix:** `set_paused`, or delete the key, from your wallet.

Details per method: [handshake.md](handshake.md), "The contract's rules" and "What a stolen app key can do here". Tests: `contracts/agent-wallet/tests/sandbox.rs` (a local NEAR node) and the unit tests in `lib.rs`.

## The owner's wallet

The only thing that can:
- set the caps (`set_cap`, `set_payment_cap`, `set_cross_chain_cap`);
- list or delist payees;
- pause, withdraw, approve or decline what's parked, cancel escrows;
- add, change or delete the app's key.

Aftercall never holds this key. `/sign` builds the transaction and the owner's own wallet signs it.

## NEAR AI and the secure hardware

**Trusted:** Intel TDX and NVIDIA confidential-computing attestation, and NEAR AI's attested deployment.

**Before anything leaves the Mac**, every run checks:
- the gateway's and each model's quote against Intel's collateral, with debug off;
- the boot log and the attested setup file (`mr_config`);
- the NVIDIA GPU evidence through NRAS;
- that a fresh nonce and the signing key are bound in the report data.

The code is in `packages/core/src/tee/`; the tests are `checks.test.ts` and `nvidia.test.ts`.

**What travels, and how:**
- **The transcript** is encrypted end to end to the attested model's key (`packages/core/src/tee/e2ee.ts`).
- **Each reply** is signed by that key over the exact request and response, and the signature is checked.
- **Audio is the one exception:** NEAR AI has no end-to-end encryption for transcription. It goes over TLS pinned to the key the gateway's attestation binds.

**Not covered:**
- The attested images aren't checked against a list of NEAR's releases.
- Transcription isn't signed per response.
- What NEAR AI keeps is set by its own policy.

`/verify` lists all three on every proof.

## The proof on NEAR

Only a hash goes on chain, never the meeting. Anyone can re-check a proof link in a browser (`/verify`) or in code (`@aftercall/receipts`). A link naming a contract other than Aftercall's own fails, because whoever deploys a contract decides what `get_proof` answers.

**Not covered:** `wallet.aftercall.testnet` isn't locked, so its deployer can still upgrade it in place. Locking waits for the mainnet deploy.

## The servers in between

- **The backend:**
  - It sends recaps through Resend and keeps nothing of them.
  - It keeps claim links only as a token hash and an amount.
  - It hands out the shared tester key under install, total and per-address limits.
  - Code: `apps/backend`.
- **The phone relay:** it holds only sealed blobs (X25519 and XChaCha20-Poly1305) that it can't read. The Mac re-checks every tap against the same caps (`packages/core/src/relay/`).
- **iCloud Drive, if you turn on backup:** it gets one file sealed with a key derived from your recovery phrase. The phrase is never stored; the key stays in the Keychain.

## Coding agents

Over the local MCP server, an agent can:
- read meetings;
- claim and complete action items;
- propose a recap, or a payment to a listed payee within the caps.

**A proposal** waits for your tap: it never runs on autopilot and never reaches the phone. **An agent can't** send, pay, post to Slack, record proofs or change notes. Code: `apps/desktop/src-tauri/src/agents.rs`, `apps/mcp`.

## Decisions a person made

- **End-to-end encryption or nothing** (1 Nov 2026). The transcript, your notes and Ask excerpts go to NEAR AI only end to end encrypted, with no TLS fallback and no downgrade on failure. If encryption isn't available, the run stops and sends nothing.
- **Consent before every recording.** Recording can't start until "I've told everyone on the call" is ticked.
- **No quote, no item.** Every action item and follow-up must quote the call word for word, and a payment's amount must be in its quote.
- **Autopilot only where every rule passes,** and never for what an agent proposed or for Slack.
- **Claims match the code.** Anything not yet run live is labelled so in the README and [proven.md](proven.md).

## Known limits

- **A compromised macOS user account** can read what that user can, Keychain prompts aside.
- **The shared tester key** is one key for every tester. Only its own spend limit on NEAR AI caps it.
- **The Mac app is an unsigned test build.**
