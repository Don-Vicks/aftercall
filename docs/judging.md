# Judging Aftercall

Meeting notes apps send your calls to servers you can't check, and the recap and payments a call agrees on still wait on you. Aftercall is private meeting notes that do the follow-ups.

This is a guide for reviewing this repository, written for people and for coding agents (Claude Code, Codex) alike. Reviewing needs no keys, accounts or Mac: every check below runs from a fresh clone or a browser. If you are an agent, please only read and run commands; nothing here asks you to change files.

## In three lines

- **What it is:** a Mac app for meeting notes. The call is transcribed and summarised inside NEAR AI Cloud's secure hardware (TEEs), checked by attestation on every run, and a proof of that goes on NEAR that anyone can re-check in a browser.
- **What it does next:** the meeting's follow-ups. The recap email, and USDC payments to people the meeting agreed to pay, from a NEAR contract whose caps the app can't get around.
- **Where it stands (12 Nov 2026):** a test build is live for Apple silicon and Intel Macs, on NEAR testnet. It has made notes from a real call on live NEAR AI, recorded the proof on NEAR, and sent a recap. On 8 Nov it paid 5 USDC agreed on a call to `kemi-ac.testnet` on testnet ([`Eq3rPHqz…`](https://testnet.nearblocks.io/txns/Eq3rPHqzDXoanWV8u1kETAkb3WSD1rTrT7ia4CzMqwXH), the app's limited key); the same call's 5,000 was parked for the owner's wallet by the contract (`OVER_PAYMENT_CAP`, [`B8xV41mT…`](https://testnet.nearblocks.io/txns/B8xV41mTk2VBZoMHGjJSdKH6MgzpfPv51zHoFCfdsttE)). On 12 Nov a headless run of the app's after-call path ([proof-run.md](proof-run.md), `pnpm --filter @aftercall/core proof:run`) put a sample call through NEAR AI's TEEs (30 of 30 checks), recorded its proof, let autopilot pay the in-cap 1 USDC (since 13 Nov every payment waits for a tap instead) and held 0.50 USDC in a Handshake escrow that the payee confirmed and that was then released; a payment over the cap was also approved from the owner's own account. Those ran with test accounts (`demo-owner` and `demo-freelancer`, `.aftercall.testnet`), not from the Mac app. The newest parts, more for coding agents and approvals on a phone, are built and tested; the phone relay and page are deployed, ran end to end with a stand-in Mac on 7 Nov, and with the installed Mac app and a real phone on 9 Nov (a recap sent from the phone; a payment not yet approved from it). On 12 Nov Claude Code connected to the installed Mac app's MCP server and read its meetings and open action items ([screenshot](media/claude-code-mcp-12nov.webp)).

## Checks to run

| # | Run | Expect | Time |
| --- | --- | --- | --- |
| 0 | `pnpm install && pnpm check:live` (no keys, read-only) | A ✓ line per live claim: NEAR AI's attestation for the gateway, Qwen and Whisper with fresh nonces; every transaction the README cites (listed in [evidence.json](evidence.json)), read back from archival RPC with the key that signed it at that block; each proof link through `/verify`'s own code; the contract's code hash and keys. ○ marks a service that was down (often the public RPC's rate limit), not a failure | about 20 seconds |
| 1 | `pnpm install && pnpm verify --quick` (Node 24, pnpm 10, stable Rust) | A summary of ✓ lines, exit code 0: typecheck, 572 core, 53 backend, 25 MCP and 9 receipts tests, the web build, the NEAR signer, the desktop Rust tests (macOS only; on Linux listed as skipped), the contract's unit tests | a few minutes; longer on a machine's first Rust build |
| 2 | `pnpm verify` (adds `cargo-near` and the `wasm32-unknown-unknown` target) | The above plus the contract on a local NEAR node: 26 sandbox tests | about 10 more minutes |
| 3 | Open https://getaftercall.vercel.app/demo in a browser (it renders with JavaScript) | It opens on the sample meeting Sync with Ada; if it lands on Home, click Sync with Ada under Sample in the sidebar. The Mac app's interface on sample meetings: notes with their quotes, the Verify sheet, follow-ups, a $5,000 payment the contract holds for the owner's wallet, and a live NEAR Intents quote for a payment on Solana (Pay Kemi) | 2 minutes |
| 4 | The `curl` commands under [1 minute](#1-minute-the-contract-and-the-first-proof-on-near-testnet) below | `nov3.testnet` calling `record_proof` on `wallet.aftercall.testnet`, status `SuccessValue`; the contract's counts | 1 minute |
| 5 | Open https://getaftercall.vercel.app/stats | The same counts, read live from the contract and the backend | 1 minute |

The 90-second demo video is [posted on X](https://x.com/VictorShallang/status/2119529850646020401) (8 Nov). It is real footage of the Mac app on NEAR testnet and of the live `/verify` page; the first draft's script and shot list are in [demo-script.md](demo-script.md).

`pnpm verify` is `scripts/verify.sh`; CI runs the same steps (`.github/workflows/ci.yml`). The same checks by the time you have, plus your own phone, the Mac app and a testnet payment: [How to test, step by step](#how-to-test-step-by-step).

## How to test, step by step

The README's [How to test](../README.md#how-to-test) in full. Pick by the time you have. Only making notes in the Mac app needs a NEAR AI key. The code: `git clone https://github.com/Don-Vicks/aftercall`.

`/stats`, `/verify`, `/phone` and `/demo` render with JavaScript, so open them in a browser: a plain fetch sees only their loading text.

### 1 minute: the contract and the first proof on NEAR testnet

The contract is `wallet.aftercall.testnet`:

- [register](https://testnet.nearblocks.io/txns/64pwAs3SfUcAJr9vKxGrX6fmhPHzKiUrnKdSWorTEkNz) and [set_cap](https://testnet.nearblocks.io/txns/GDALCrvkRhnMR3qjdpuA9nLVrdFMa4HYSCmwmxhfUuRo), signed in the owner's own NEAR wallet (3 Nov 2026).
- A sample call's proof: [proof-sample.txt](proof-sample.txt). A made-up call, two computer voices and fictional names (Ada, Kemi, Sam, "Lantern Loop"), recorded in the Mac app on 8 Nov 2026 with notes made on live NEAR AI and the proof recorded on NEAR at 17:49 UTC. Open it in a browser and `/verify` passes 7 of 7 (8 of 8 for its first two days: NVIDIA has since retired the key that signed its GPU token, so that check is now shown as the app recorded it); `verifyProofLink` from [packages/receipts](../packages/receipts) answers `Checks out`. Its proof carries a line tree (8 lines), so Share this line works for it.
- [record_proof](https://testnet.nearblocks.io/txns/2oawJPTmRiNky6EGzpURh79FRDkFcx4bp1kL76DevZro), sent by the Mac app with its limited key on 3 Nov 2026, for notes it made from a real call on live NEAR AI on 2 Nov. Its proof link is in [proof-3-nov.txt](proof-3-nov.txt): hashes, nonces and signatures, never what was said. Open it in a browser and `/verify` reads the proof's hash from NEAR and re-checks it (7 of 7 pass); the 29 checks the app ran when it made the notes, Intel's and NVIDIA's attestation among them, are shown as the app recorded them. From code, `verifyProofLink` in [packages/receipts](../packages/receipts) answers `Checks out` for it.
- The 12 Nov headless proof run: [proof-run.md](proof-run.md), with its `/verify` link (8 of 8, still after NVIDIA retires its token key about two days later: `/verify` then checks the token with an archived copy of the key, verified by NVIDIA's certificate chain), its `/deal` link (paid) and every transaction.
- https://getaftercall.vercel.app/stats: counts read live from the contract and the backend. The backend's counts as JSON: `curl -s https://aftercall-api.vercel.app/stats`.

Without a browser (nearblocks refuses scripted requests), the same facts from NEAR's RPC:

```bash
curl -s https://archival-rpc.testnet.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tx","params":{"tx_hash":"2oawJPTmRiNky6EGzpURh79FRDkFcx4bp1kL76DevZro","sender_account_id":"nov3.testnet","wait_until":"FINAL"}}'
```

shows `nov3.testnet` calling `record_proof` on `wallet.aftercall.testnet` with status `SuccessValue`, and

```bash
curl -s https://rpc.testnet.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"wallet.aftercall.testnet","method_name":"get_stats","args_base64":"e30="}}'
```

returns the contract's counts as bytes of JSON, e.g. `{"wallets":2,"proofs":13,"payments":8,"parked":6}` on the evening of 12 Nov; the counts grow as runs are added.

### 2 minutes: the app in your browser

Open https://getaftercall.vercel.app/demo, the Mac app's own interface on made-up meetings. It opens on the sample meeting Sync with Ada; if you land on Home, click Sync with Ada under Sample in the sidebar (the two sample recordings on Home need the Mac app to make notes). You'll see the notes with the quote behind each item, the Verify sheet re-running the checks on a test proof, the follow-ups, a $5,000 payment the contract holds for the owner's wallet, and Pay Kemi on Solana with a live NEAR Intents quote from 1Click (a dry quote: nothing is sent).

### 3 minutes: every live claim, the attack demo and the bookkeeper's CSV

- Open https://getaftercall.vercel.app/proof: every testnet transaction the README cites (all 20 in [evidence.json](evidence.json)), one click each, and the proof links, which re-check in your browser.
- `pnpm install && pnpm check:live`: no keys, read-only, about 20 s. A ✓ line per claim, ending `Summary: … 0 failed`; the 8 Nov proofs' GPU check reads "can't be re-checked", since NVIDIA retired the key behind it. A service that's down shows ○, not a failure.
- `pnpm --filter @aftercall/core attack:run`: no keys, about 10 s. Stages A, B and D print what stopped each attempt at a prompt-injected $9,000 payment; stage C, the app's key against the contract on testnet, needs a key, and its transactions are in [attack-log.md](attack-log.md). B1 runs only on macOS with the desktop UI built.
- `pnpm --filter @aftercall/core ledger -- demo-owner.aftercall.testnet`: no keys, a minute or two (the free APIs slow it down). The test owner's money trail as a bookkeeper's CSV, the same rows as [ledger-demo-owner.csv](ledger-demo-owner.csv) unless the account has been used since; columns in [bookkeeping.md](bookkeeping.md).

### 5 minutes: approve from your own phone

Needs a clone of this repo (`git clone https://github.com/Don-Vicks/aftercall && cd aftercall`), Node 24 and pnpm 10. A made-up Mac pairs with the live `/phone` page through the deployed relay:

```bash
pnpm install
pnpm dev:phone -- --relay https://aftercall-api.vercel.app --web https://getaftercall.vercel.app
```

Open the link it prints on your phone. You'll see the six-digit code (in a browser that paired before, the page first asks "Pair with a different Mac?": tap Pair again), then what needs you: a recap and payments, each with What leaves; Approve and Dismiss behind a 5-second Undo; a recap on an autopilot countdown; a $5,000 payment over the cap that opens your NEAR wallet on `/sign`; a payee not on the list, which you can only dismiss. The terminal logs each tap the made-up Mac accepts or refuses; the relay only passes sealed boxes. No push notifications yet: the page checks every 10 s.

### 10 minutes: the Mac app

macOS 14.2 or later, Apple silicon or Intel. It's an unsigned test build on NEAR testnet.

```bash
curl -fsSL https://getaftercall.vercel.app/install.sh | sh
```

It checks the DMG's SHA-256, copies Aftercall into Applications and opens it with no macOS warning: you trust this script instead of Apple's notarization, which the build doesn't have yet. From https://getaftercall.vercel.app/download instead, open it once, click Done (not Move to Bin) when macOS says it "could not verify" Aftercall, then Open Anyway in System Settings › Privacy & Security. Allow Microphone and Screen & System Audio Recording.

- **Without a NEAR AI key** you can record a call (no bot joins it; the audio stays sealed on the Mac), open the two made-up sample recordings on Home, and set up payments.
- **Making notes needs a NEAR AI API key.** No account? Onboarding and Settings offer **Use test credits**: since 8 Nov the backend hands every install one shared NEAR AI key, paid from Aftercall's NEAR AI credit (up to 30 installs, 3 per network address a day; `GET https://aftercall-api.vercel.app/nearai/test-credits` says whether any are left). Or paste your own key from https://cloud.near.ai. Either way the notes are made inside NEAR AI's secure hardware. If test credits say they're used up, or notes fail with a NEAR AI billing error, the shared credit has run out: paste your own key (hackathon participants get $10 of NEAR AI credit through NEAR Builders, nearbuilders.org/join), or use the browser demo and the public proof links, which need no key.

### Full: a payment on testnet

In the Mac app, Settings → Set up payments (about 3 minutes, 0.35 test NEAR):

1. **A testnet account.** The app makes `<name>.testnet` for you through NEAR's testnet helper, which funds it. Or choose "I already have an account" and get test NEAR from [NEAR's faucet](https://docs.near.org/getting-started/faucet), or with [near-cli-rs](https://github.com/near/near-cli-rs): `near account create-account sponsor-by-faucet-service <name>.testnet autogenerate-new-keypair save-to-keychain network-config testnet create`.
2. **One approval in your wallet.** The app opens https://getaftercall.vercel.app/sign in any NEAR wallet through NEAR Connect, with one signing request: `register` and `set_cap` on the contract, this Mac's limited key, and your USDC registration.
3. **Test USDC.** [Circle's faucet](https://faucet.circle.com): pick Near Testnet (20 USDC per address every 2 hours, checked 3 Nov 2026). Then Deposit and Add payee on the Ready to pay card, each one approval on `/sign`.
4. **A payment.** Record a call where you agree to pay that payee less than your daily cap, make notes and tap Approve. Over a cap, the payment waits for your wallet on `/sign`.

Not yet run live: the batched approval in a real wallet (on 3 Nov `register` and `set_cap` were signed separately). Payments from the Mac app have run on testnet (8 Nov, under Known limits); the same contract paths are tested on a local NEAR node.

### From source: `pnpm verify`

Needs Node 24, pnpm 10 and stable Rust.

```bash
pnpm install && pnpm verify --quick
```

You should see a ✓ line per step and exit code 0: typecheck, unit tests, the web build, the NEAR signer, the desktop Rust tests (macOS only; skipped on Linux) and the contract's unit tests, in a few minutes (longer on a first Rust build). `pnpm verify` also runs the contract on a local NEAR node (26 sandbox tests, about 10 minutes more) and needs:

```bash
rustup target add wasm32-unknown-unknown
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh | sh
```

Running every part locally: [development.md](development.md).

## Questions a judge will ask

Short answers; each links to the full one or to the code and tests behind it.

**Can the gateway read the meeting audio?** Only software inside NEAR AI's attested gateway TEE can, and the Whisper TEE that transcribes it. NEAR AI has no end-to-end encryption for transcription, so the audio goes over TLS, pinned to the TLS key the gateway's verified Intel TDX quote binds: if the gateway's attestation binds no TLS key, or its certificate carries a different one, nothing is uploaded (`gatewayTlsPin` in `packages/core/src/notes/pipeline.ts`; `transcribe` in `apps/desktop/src-tauri/src/nearai.rs`). NEAR AI's operators can't read it as long as the TEEs hold. Not proven: what the gateway's software does with the audio, that its image is NEAR's release, how it reaches Whisper, and that a transcript came from Whisper (no signature). Everything else, the transcript included, is end-to-end encrypted to the model. [Who can see what](privacy.md#who-can-see-what).

**Who can access transcripts?** You, on the Mac, where they are sealed with a key in the Keychain; the Qwen TEE while it writes the notes, end-to-end encrypted; and a coding agent you connect, only for the projects you allow, which then sends what it reads to its own model provider. Never Aftercall's backend, never the chain. The full table: [privacy.md](privacy.md#who-can-see-what).

**What does the TEE protect, and how do you know it's a TEE?** On every run, before anything is sent, the app verifies the gateway's and each model's Intel TDX quote against Intel's collateral with debug off, replays the boot log, checks the attested Docker compose against `mr_config`, checks NVIDIA's GPU evidence through NRAS, and requires a fresh nonce and the signing key in the quote's report data (`packages/core/src/tee/checks.ts`, `nvidia.ts`; `checks.test.ts`, `nvidia.test.ts`, and `tdx_quote.rs` with a real quote). Then the transcript is encrypted to that attested key, and a reply counts only if that key signed it (`e2ee.ts`, `pipeline.test.ts`). Not covered: the images aren't checked against a list of NEAR's releases, and the firmware and OS measurements aren't pinned.

**Can users delete their data?** Audio is deleted right after the notes are saved, and at the next launch if that didn't happen (`delete_audio_in` and `sweep_audio`, `apps/desktop/src-tauri/src/lib.rs`). A meeting can be deleted from its page; "Delete everything on this Mac" removes the app's folder and its Keychain items (`apps/desktop/src-tauri/src/wipe.rs`). What it can't reach, and says so: proofs and payments on NEAR, backups you exported, automatic backups in iCloud Drive, and whatever NEAR AI's own policy keeps.

**What does the NEAR transaction prove?** `record_proof` stores a sha256 of the meeting's proof bundle under the owner's account, and a recorded proof can't be overwritten. `/verify` hashes the bundle from the link and compares it with NEAR, then re-checks the model's signature over the exact request and response and NVIDIA's token. So it proves the bundle is unchanged since that block, recorded by that owner's key on Aftercall's contract, and signed by an attested key. It doesn't prove the meeting's content (it isn't there), that the transcript is accurate, or the app's other checks, which `/verify` shows as the app recorded them. The contract account can still be upgraded by its deployer until mainnet; the transaction itself stays in NEAR's history ([threat-model.md](threat-model.md)).

**What is proven, and what does the app only report?** A proof link carries the bundle the app made, not the hardware's raw evidence, so `/verify` (and `@aftercall/receipts`) splits into two kinds of line:

| Re-checked by anyone, without trusting Aftercall | Reported by the app, shown as it recorded them |
| --- | --- |
| **Proof recorded on NEAR** and **Proof matches this meeting**: the bundle's sha256 is the hash `record_proof` stored on Aftercall's contract, under that owner's account, at that block | That each Intel TDX quote verified against Intel's collateral: the quotes aren't in the link, only the app's result (the 29–30 checks listed under each proof) |
| **Summary signed inside secure hardware**: a valid Ed25519 (or ECDSA) signature over the exact request and response hashes in the bundle | That the signing key and this meeting's nonce were in a genuine quote's report data: **Signer was attested** compares the key with report data the app recorded |
| **NVIDIA attested the signer's GPUs**: a token signed by NVIDIA (checked against NVIDIA's published or archived keys), carrying this meeting's nonce, overall result pass. It isn't tied to the CPU quote's key | **Transcript encrypted to the attested model** and **Signer's setup file matches its hardware**: consistency of values the app recorded |
| A shared line: it is in the transcript the proof on NEAR commits to (a Merkle proof against the root in the bundle; the root is the Mac's own commitment, not something the TEE signed) | That the audio went only over TLS pinned to the attested gateway, and the notice you logged before recording |
| | **Notes unchanged since signing**: runs only in the app that holds the notes; a proof link has no meeting content |

So a dishonest copy of the app could record a bundle whose reported lines pass; the re-checked lines would still tie it to NEAR, to a signing key and to NVIDIA. Putting the raw quotes in the proof, so `/verify` re-checks Intel's evidence too, is the next step and isn't built.

**What happens if the AI gets a decision wrong?** Nothing it says runs on its own word. Every item needs an exact quote from the transcript, or it's dropped; a payment's amount must be in its quote; and no payment runs without your tap, on the Mac or your phone: autopilot only sends recaps to your own team's domain (`autopilot.ts`, `PAYMENTS_NEED_YOU`; `autopilot.test.ts`). Each payment's card also says when its quote isn't your own words, doesn't name the payee or doesn't say the amount as money (`build.ts`, `build.test.ts`). Over a cap, the contract itself holds the payment for your wallet.

**Why does this need a blockchain?** Two things a server can't give. A proof anyone can check without trusting Aftercall: the hash is on NEAR, not in a database Aftercall could edit. And spending limits the app can't get around: the payee list and caps live in a contract, and the app's key can only call `pay`, `record_proof`, `open_escrow` and `release_escrow`; changing a rule needs the owner's own wallet (`contracts/agent-wallet`, sandbox tests). The attack log shows both on testnet ([attack-log.md](attack-log.md)).

## Claims, code and tests

Each claim names the code that does it and the tests that check it. The full list, with every test name: [proven.md](proven.md).

| Claim | Code | Tests |
| --- | --- | --- |
| Nothing leaves the Mac unless the gateway and model TEEs pass attestation (Intel TDX quote, key and nonce in the report data, NVIDIA GPU evidence through NRAS) | `packages/core/src/tee/checks.ts`, `packages/core/src/tee/nvidia.ts`, `packages/core/src/notes/pipeline.ts` | `checks.test.ts`, `nvidia.test.ts`, `pipeline.test.ts` ("nothing leaves the Mac when…") |
| The transcript is end-to-end encrypted to the attested model's key, or not sent; there is no TLS fallback | `packages/core/src/tee/e2ee.ts`, `pipeline.ts` | `e2ee.test.ts`, `pipeline.test.ts` ("a refusal of the encryption headers stops processing…") |
| Every reply's signature is checked against the attested key; notes that fail are kept but marked unverified, and autopilot runs nothing from them | `packages/core/src/tee/`, `pipeline.ts`, `packages/core/src/followups/autopilot.ts` | `verify.test.ts`, `pipeline.test.ts` ("the notes' signature must be the model TEE's own…"), `autopilot.test.ts` ("nothing runs by itself from notes that aren't verified…") |
| The model can't propose a follow-up without an exact quote from the transcript: an item without one is dropped; a payment's amount must be in its quote, where any number with the same value matches. So no payment runs without your tap, and its card says when the quote isn't your own words, doesn't name the payee, doesn't say the amount as money ("$500", not "500 users") or may say not to pay. The rest of the item isn't checked against the quote | `packages/core/src/notes/build.ts`, `amounts.ts`, `transcript.ts`, `followups/autopilot.ts` | `build.test.ts` ("a number that isn't money can't pay by itself…"), `amounts.test.ts`, `transcript.test.ts`, `rematch.test.ts` |
| Anyone can re-run a proof's checks in a browser, with no meeting content | `apps/web/app/verify/`, `packages/core/src/notes/proof.ts` | `proof.test.ts`, `verify.test.ts` |
| One line of a meeting can be shared with a Merkle proof: `/verify` checks it is in the transcript the proof on NEAR commits to, and the link reveals that line and nothing else of the meeting. Built and tested, not yet run live | `packages/core/src/notes/lines.ts`, `disclosure.ts`, `proofLink.ts`, `apps/web/app/verify/`, `apps/desktop/src/ShareLineSheet.tsx`, `packages/receipts` | `lines.test.ts`, `disclosure.test.ts`, `pipeline.test.ts` ("the proof commits to a Merkle root…"), `packages/receipts/test/receipts.test.mjs` |
| The app's NEAR key can only call `pay`, `record_proof`, `open_escrow` and `release_escrow`; rule changes need 1 yoctoNEAR, which that key can't attach | `contracts/agent-wallet/src/lib.rs`, `crates/near-tx` | `contracts/agent-wallet/tests/sandbox.rs`: `limited_key_cannot_change_rules`, `one_yocto_rule_holds_even_if_key_lists_owner_methods` |
| Payments go only to listed payees within a daily and a per-payment cap; over a cap they wait for the owner's own wallet | `contracts/agent-wallet/src/lib.rs` | `over_cap_is_blocked_then_owner_approves`, `per_payment_cap_parks_big_single_payments` (sandbox) |
| Handshake: a payment agreed on a call can be held in escrow under the same caps (over a cap, parked for the owner's wallet); only the payee's own account confirms it, and only for the terms whose salted hash is on chain; release pays once and counts against the caps once; the owner can take it back only before the payee confirms (or 30 days after, unreleased). Built and tested on a local NEAR node; on testnet since 7 Nov; run there on 12 Nov in the headless proof run ([proof-run.md](proof-run.md)): opened by the app key, confirmed from the payee's own account, released. Not yet from the Mac app or through `/deal` with a browser wallet | `contracts/agent-wallet/src/lib.rs`, `packages/core/src/followups/deal.ts`, `apps/web/app/deal/`, [handshake.md](handshake.md) | `escrow_within_cap_is_confirmed_by_the_payee_and_released_by_the_app_key`, `escrow_over_cap_is_parked_until_the_owner_wallet_approves`, `owner_cancels_an_escrow_only_before_the_payee_confirms`, `escrow_without_a_condition_is_released_by_the_payees_confirmation` (sandbox); `deal.test.ts` |
| A payment's condition ("when the icons are delivered") is kept only with its own exact quote from the call; one that needs a condition never runs by itself | `packages/core/src/notes/build.ts`, `autopilot.ts` | `build.test.ts` ("a payment's condition is kept only with its own quote…"), `autopilot.test.ts` ("a payment that waits on a condition…") |
| Payments and escrows point to the meeting's proof on NEAR (`get_payment_proof`, `Escrow.proof`); the contract copies the hash from the recorded proof | `contracts/agent-wallet/src/lib.rs` | `escrows_and_payments_keep_the_meetings_proof_hash` (unit), `app_signer_records_proofs_and_pays_over_rpc` (sandbox) |
| The new contract code upgrades the deployed one in place: every record from before reads the same | `contracts/agent-wallet/src/lib.rs` (no new root-state fields) | `upgrade_from_the_code_before_handshake_keeps_state_and_adds_escrows` (sandbox, from the deployed code's bytes) |
| Payments to Solana or Base through NEAR Intents 1Click stay under the same caps and a cross-chain cap that is off until the owner sets it | `packages/core/src/intents/oneclick.ts`, `contracts/agent-wallet/src/lib.rs` | `cross_chain_pays_the_deposit_address_within_caps` (sandbox), `oneclick.test.ts` |
| The backend keeps nothing about a recap; claim links keep a token hash and an amount | `apps/backend/src/email/`, `apps/backend/src/claims/` | `email.test.ts` ("a sent recap leaves only counts behind…"), `claims.test.ts` |
| Coding agents only read until the owner allows more, reach only the projects the owner chose, and never send, pay or change rules | `apps/desktop/src-tauri/src/agents.rs`, `apps/mcp/` | `agents_read_only_by_default_and_are_told_which_switch_to_turn_on`, `agents_reach_only_the_projects_the_user_chose` (`agents.rs`), `apps/mcp/src/tools.test.ts` |
| A follow-up an agent proposes waits for the owner's tap: it never runs on autopilot, never reaches the phone, and pays only a listed payee within the caps | `agents.rs` (`draft`), `packages/core/src/followups/autopilot.ts`, `packages/core/src/relay/messages.ts` | `agents_propose_payments_only_to_listed_payees_within_the_caps` (`agents.rs`); `autopilot.test.ts` ("a follow-up a coding agent proposed never runs by itself, even when every rule passes"); `messages.test.ts` ("only follow-ups that wait on someone become items…") |
| "Done" carries the agent's link as the agent's word: only a plain http or https link is kept, and a recap lists agents' work only when the owner turns that on | `packages/core/src/agents/work.ts`, `packages/core/src/followups/recap.ts`, `agents.rs` | `work.test.ts`; `recap.test.ts` ("with agentWork, items agents finished are listed as the agents' statement, with their links"); `complete_with_a_link_to_the_work_and_only_a_plain_web_link` (`agents.rs`) |
| Handing an item to an agent quotes the meeting's words as data, and Open in Claude Code never puts them in a shell command | `packages/core/src/agents/handoff.ts`, `agents.rs` (`open_in_claude_code`) | `handoff.test.ts` ("the meeting's words are data…"); `open_in_claude_code_passes_the_prompt_as_one_argument_never_as_code` (`agents.rs`) |
| The phone sees only what approving needs, sealed (X25519, XChaCha20-Poly1305) so the relay can't read or forge it; the Mac re-checks every tap and then runs the app's own button | `packages/core/src/relay/`, `apps/backend/src/relay/` | `messages.test.ts` ("fields outside the schema never ride along…"); `mac.test.ts` ("pair, snapshot, tap and act, through a fake relay that holds only hashes and boxes", "an action is refused when the follow-up changed…"); `relay.test.ts` ("nothing readable is stored…"); `crypto.test.ts` ("a key swapped in by someone who saw the QR gives different codes and keys") |

## Tracks

Aftercall is entered in five tracks. What each track asks, and the part of Aftercall that answers it:

| Track | The track asks for | In Aftercall |
| --- | --- | --- |
| Privacy & Private AI | AI that protects sensitive data; TEEs, NEAR AI Cloud | The whole notes pipeline: attestation on every run, end-to-end encryption to the attested model, notes sealed on the Mac, a public proof without content |
| AI Security & Defense | Spending limits, policy engines, sandboxed wallets; function-call keys, TEE attestation | The agent-wallet contract: a function-call key limited to paying, recording proofs and holding deals, caps, a payee list, parked payments, the 1-yocto rule; quotes required before anything is proposed; an attack demo stops a prompt-injected $9,000 payment at the notes, the agent, the contract and the proof link, with its testnet transactions in [attack-log.md](attack-log.md) (`pnpm --filter @aftercall/core attack:run`) |
| Agent Economy | Agents that spend and pay, directly or through NEAR Intents | The meeting proposes payments and the app pays them in USDC on the owner's tap, within the contract's caps; payees on other chains through 1Click; coding agents work action items over MCP and can propose a payment to a listed payee within the caps, which waits for the owner's tap; 1Click payouts are dry quotes until mainnet |
| Autonomous Business | AI-native operations where humans only set the constraints | The owner sets the caps, payees and team domains once. Recaps to the team then go on their own, with a 60-second undo; every payment waits for one tap, and the contract enforces the caps whatever is tapped. Until 13 Nov payments ran on autopilot too: its decision (`meetingAutopilotDecision`) paid an in-cap payment on testnet on 12 Nov in the headless proof run. The app's own autopilot runner and undo haven't run live yet |
| Real-World Money | Payments and stablecoin rails a normal company could use tomorrow | Invoices and contractor payouts from your meetings: paying a freelancer the amount agreed on a call, in Circle USDC, with a single-use claim link for a new payee to say where to be paid; or holding it in escrow until the freelancer confirms the terms and the work is done (Handshake: run on testnet on 12 Nov in the headless proof run, [proof-run.md](proof-run.md)); the money trail as a bookkeeper's CSV with each payment's status, who approved it and its transaction ([ledger-demo-owner.csv](ledger-demo-owner.csv), columns in [bookkeeping.md](bookkeeping.md), `pnpm --filter @aftercall/core ledger -- <owner>`) |

## Known limits

- Two payments from the Mac app have run on testnet, both on 8 Nov from the same sample call: [`Eq3rPHqz…`](https://testnet.nearblocks.io/txns/Eq3rPHqzDXoanWV8u1kETAkb3WSD1rTrT7ia4CzMqwXH), the first run, and [`6jK1mauq…`](https://testnet.nearblocks.io/txns/6jK1mauqjVNhhJnmvVuhPiP8DzxCBR9Na9ysoKo6jmKN), the screen-recorded one whose proof is in [proof-payment-call.txt](proof-payment-call.txt). Each is `pay` 5 USDC to `kemi-ac.testnet`, signed by the app's function-call key, with `meeting_id` linking the meeting's proof. The same call's 5,000 USDC was refused and parked for the owner's wallet: `pay` answered `blocked`, `OVER_PAYMENT_CAP`, with nothing moved ([`B8xV41mT…`](https://testnet.nearblocks.io/txns/B8xV41mTk2VBZoMHGjJSdKH6MgzpfPv51zHoFCfdsttE)). On 12 Nov, with test accounts: a payment over the cap was parked and then approved from the owner's own account by command line (`approve_pending`, [`6CbYm7qU…`](https://testnet.nearblocks.io/txns/6CbYm7qUaM76WiaPZuycysnXx8Yjq3ChYDVMwTrsAvNN)), and autopilot's decision paid an in-cap payment in the headless proof run ([proof-run.md](proof-run.md)). Neither has run from the Mac app, and `/sign` hasn't approved a parked payment in a browser wallet. On the way, the app said Kemi wasn't on the payee list, although `kemi-ac.testnet` had just been added as "Kemi", and offered a claim link instead; the payment went out through it, and the payee now reads "Kemi (kemi-ac.testnet)". The cause: the model is shown payees as "Kemi (kemi-ac.testnet)" and gave that whole string back as the name, which matched neither the label nor the account (fixed 8 Nov in `matchPayee`, `packages/core/src/notes/build.ts`, tested in `rematch.test.ts`, and in the Mac test build since 8 Nov). The app also now reads the payee list again when its window regains focus, so a payee added by signing in the browser is there for the next call.
- Handshake (escrow, the `/deal` page, conditions on payments, payments linked to their proof) is built and tested on a local NEAR node and on testnet since 7 Nov ([`BQXQAhui…`](https://testnet.nearblocks.io/txns/BQXQAhui6ixc2B7QacSoSyw6MWqUvgkGvyfSUfCzYpoq), an in-place upgrade that kept every record), and run on testnet on 12 Nov in the headless proof run ([proof-run.md](proof-run.md): opened, refused for different terms, confirmed by the payee's own account, released). Not yet from the Mac app or through `/deal` with a browser wallet, and each owner needs to update the Mac's key once ([handshake.md](handshake.md)): the key on `nov3.testnet` still has only `pay` and `record_proof`.
- The public proof ([proof-3-nov.txt](proof-3-nov.txt)) is from a real meeting that stays private, so its notes aren't shown: "Notes unchanged since signing" needs them and runs only in the app that holds them.
- Mainnet: no deploy yet, and so no real 1Click payout (1Click has no testnet). Testnet is eligible under the rules (Q-010).
- Test credits are one shared NEAR AI key (on since 8 Nov), so NEAR AI can't cap each tester: the key's own limit is the cap, and when the credit runs out notes need your own key. The per-tester mode (a capped key minted for each install) is built and tested against a stand-in for NEAR AI's API, and waits on a NEAR account for Aftercall's NEAR AI workspace.
- The Mac app is an unsigned test build; macOS asks once to open it.
- Audio isn't end-to-end encrypted, because NEAR AI has none for transcription. It goes over TLS pinned to the key the gateway's attestation binds.
- Coding agents: on 12 Nov Claude Code connected to the installed Mac app's own MCP server and read its meetings and open action items ([screenshot](media/claude-code-mcp-12nov.webp)). A full claim, fix and complete was recorded against the MCP server and a stand-in for the app ([agents-demo.md](agents-demo.md)), before Hand to an agent, Open in Claude Code, links, proposals and projects existed. Claiming and completing in the Mac app, and those newer parts, haven't run with a real Claude Code session yet, and Codex hasn't run at all.
- Approvals on a phone: the relay and the `/phone` page were deployed on 7 Nov, when a stand-in Mac (`pnpm dev:phone -- --relay https://aftercall-api.vercel.app --web https://getaftercall.vercel.app`) paired with the live `/phone` page through the live relay in a phone-sized browser, and an approve, a dismiss, an autopilot recap and a held payment's wallet link went through. On 9 Nov the installed Mac app and a real phone ran together through the deployed relay: the phone showed what needed the owner, the owner acted on several items and sent a recap from it, and the Mac app showed each change within seconds. A payment hasn't been approved from the phone yet. Anyone can repeat that run, and open its link on their own phone. No push notifications yet: the page checks for news every 10 s while it's open.
- Everything else not yet run live is listed at the end of [proven.md](proven.md).

## How it was built

Planning docs start on 24 Oct 2026 and code on 26 Oct 2026, both after the event was announced on 19 Oct; the FAQ counts code from the announcement (Q-001). The commit history is the real timeline. Most of the code was written by Claude Code under Victor's direction (README, [Built with](../README.md#built-with)); `CLAUDE.md` holds the working rules those sessions followed, and [kickoff.md](kickoff.md) the prompt that started them.
