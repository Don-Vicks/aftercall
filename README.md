# Aftercall

Private meeting notes that do the follow-ups. Built for NEAR HACKATHON (1–14 Nov 2026).

Aftercall records a call on your Mac, transcribes and summarises it inside NEAR AI Cloud's secure hardware (TEEs), and records a proof of that on NEAR that anyone can check. Then it does what the meeting decided: the recap email goes out and the agreed payment is made in USDC on NEAR, after one approval or under autopilot rules you set. A NEAR contract caps what the app can ever pay, so even a hijacked app or a tricked AI can't overspend.

> **Status:** in development. Building started on 26 Oct 2026, before the 1–14 Nov window, after a NEAR HACKATHON moderator confirmed in the event Discord (22 Oct) that early development is allowed. The commit history shows the real timeline. What runs against live NEAR AI and NEAR testnet, and what is so far proven only locally, is listed under [What is proven](#what-is-proven).

## Check it in five minutes

| Do | See |
| --- | --- |
| `pnpm install && pnpm verify --quick` | Typecheck of every package, 41 core and 17 backend tests (20 with `DATABASE_URL` set, adding the Postgres runs), the web build, the NEAR signer, the recorder and the contract's unit tests, with a pass/fail summary. `pnpm verify` adds the contract running on a local NEAR node (13 more tests, about 5 minutes; needs `cargo-near` and the `wasm32-unknown-unknown` target). |
| `pnpm dev:ui`, open http://localhost:1420 | The Mac app's interface in a browser on a sample meeting: Home, search (sidebar), follow-ups with "check before you approve", the $5,000 payment the contract blocks, the transcript with evidence links. Recording is simulated in the browser. |
| `pnpm --filter @aftercall/web dev`, open http://localhost:3000/verify | The public Verify page. With a proof link (`/verify#…`, copied from the app's Verify sheet) it reads the proof from NEAR and re-runs every check in your browser. |
| Read [`contracts/agent-wallet/src/lib.rs`](contracts/agent-wallet/src/lib.rs) and [`tests/sandbox.rs`](contracts/agent-wallet/tests/sandbox.rs) | Why the app can't overspend: its key can call only `pay` and `record_proof`, every rule change needs 1 yoctoNEAR (which a limited key can't attach), and over-cap payments park until the owner's own wallet approves. Each claim has a test on a real local NEAR node. |
| Read [`packages/core/src/notes/`](packages/core/src/notes) | The notes pipeline: two audio stems become one transcript, the model's output must match a strict schema, any item without an exact quote from the transcript is dropped, amounts are read from the spoken words (never from the model's number), and the summary's signature must recover to the attested enclave. |

## How it works

```
 Mac app (Tauri)                                  NEAR AI Cloud (TEEs)
 ├─ Core Audio tap + mic → mic/system WAV ───────▶ openai/whisper-large-v3
 ├─ notes pipeline (packages/core) ──────────────▶ Qwen/Qwen3.8-27B (strict JSON schema)
 │    attestation (fresh nonce) + response signature checked against the attested signer
 ├─ NEAR AI key in the macOS Keychain; called from Rust, only for Aftercall's own audio
 ├─ app key in the Keychain (limited: pay, record_proof) ──▶ agent-wallet contract on NEAR
 │                                                            ├─ record_proof(meeting, sha256 of proof bundle)
 │                                                            ├─ pay(): listed payee, daily + per-payment caps
 │                                                            └─ over cap → parked for the owner's wallet
 └─ follow-ups: Draft in Mail · send via backend · pay · claim link · autopilot

 Web (Next.js)                                    Backend (NestJS + Postgres)
 ├─ /verify  re-runs the proof checks in the browser  ├─ sign-in with NEAR (NEP-413); app keys accepted
 ├─ /sign    owner actions signed in any NEAR wallet  ├─ recap email via Resend (consent line required)
 └─ /claim   payee shares where to be paid            └─ single-use claim links (only token hashes stored)
```

## NEAR pieces used

| Piece | Where |
| --- | --- |
| NEAR AI Cloud: Confidential TEE models (Whisper, Qwen3.8-27B), attestation reports, response signatures | `packages/core/src/notes/pipeline.ts`, `verify.ts`; Rust transport `apps/desktop/src-tauri/src/nearai.rs` |
| A NEAR smart contract (near-sdk 5.29): caps, payees, parked payments, proof registry, per-user storage | `contracts/agent-wallet` |
| Function-call access keys as the app's limited authority; the 1-yocto rule for owner methods | `crates/near-tx`, `contracts/agent-wallet` |
| NEP-141 (Circle USDC): `ft_transfer_call` deposits, payee registration with `storage_deposit` | `contracts/agent-wallet`, `packages/core/src/wallet/actions.ts` |
| NEP-413 sign-in, signed by the app's key in Rust and verified in TypeScript | `crates/near-tx`, `apps/backend/src/auth` |
| NEAR Connect, for owner signatures in any wallet (Meteor, Intear, Ledger, NEAR CLI…) | `apps/web/app/sign` |
| JSON-RPC: views, `send_tx`, access-key checks | `crates/near-tx`, `apps/web/app/verify` |

## What is proven

| Claim | Evidence |
| --- | --- |
| The app's limited key records proofs and pays, and can't change a rule or move funds outside the caps | `app_signer_records_proofs_and_pays_over_rpc`, `limited_key_cannot_change_rules`, `one_yocto_rule_holds_even_if_key_lists_owner_methods` (sandbox, local NEAR node) |
| Over-cap payments are parked; only the owner approves or declines; a bounced transfer is refunded | `over_cap_is_blocked_then_owner_approves`, `owner_can_decline_a_blocked_payment`, `failed_transfer_refunds_everything` |
| The model can't invent a follow-up: anything without an exact transcript quote is dropped | `packages/core/src/notes/build.test.ts`, `pipeline.test.ts` |
| A tampered response, an unattested signer or a changed note fails verification | `verify.test.ts`, `proof.test.ts`; signature recovery matches ethers on 20 of 20 messages |
| A failed summary doesn't pay to transcribe the same audio again | `pipeline.test.ts` (transcript cache) |
| Recording captures both sides of a real call | Checked on a real call on macOS (both stems carry sound) |
| Claim links work once, even when answered twice at the same moment | `claims.test.ts`, run against Postgres |

**Not proven yet:** a run against live NEAR AI (waits on an API key), the contract on testnet and a wallet-signed change (wait on a testnet account), email through Resend (waits on a key), and the silence warning firing live. Gates 1 and 2 below depend on these.

## Run it

Needs Node 24, pnpm 10, Rust stable. Postgres for claim links (`DATABASE_URL`; kept in memory otherwise).

```bash
pnpm install
./scripts/dev.sh   # backend (Postgres), web pages and the Mac app together
pnpm dev:ui        # the interface in a browser at http://localhost:1420
pnpm verify        # every check
```

macOS grants system-audio capture only to a bundled app, so to record, build it with `pnpm --filter @aftercall/desktop tauri build --debug --bundles app` and open the `.app`. The first run walks through an audio check and the NEAR AI key; Settings connects NEAR (two signatures in your own wallet) and sets autopilot. Deploy the contract to testnet with [`contracts/scripts/deploy-testnet.sh`](contracts/README.md). Backend settings: `apps/backend/.env.example`.

| Part | Choice |
| --- | --- |
| Desktop | Tauri v2, React, TypeScript, Tailwind; Rust Core Audio process tap (`cidre`), `cpal` microphone |
| Shared core | TypeScript: notes pipeline, schema (zod), verification, owner actions, recap, autopilot, search |
| Backend | NestJS + Postgres: NEP-413 sign-in, Resend email, claim links |
| Web | Next.js: Verify, sign and claim pages |
| Contract | Rust, near-sdk 5.29, cargo-near, near-workspaces sandbox tests; Circle USDC |

Repo layout: `apps/desktop`, `apps/backend`, `apps/web`, `packages/core`, `contracts/agent-wallet`, `crates/near-tx`, `scripts/`, `docs/` (rules, design source).

Design: [Aftercall Screens](https://claude.ai/artifact/RXNzkVE5TXbVu2ynPKRScW) · [Design system](https://claude.ai/artifact/96RdBedZXsLxdXixzAdk6x) (private links for the team).

## MVP

- [ ] Record a real call on macOS (system audio + mic, consent tick) and get a private, signed summary with decisions, action items and evidence quotes
- [ ] Record the proof on NEAR and show it on a public Verify page anyone can open without installing
- [ ] Send the recap email with the consent line, through Aftercall or as a draft in your own Mail app
- [ ] Pay a listed payee in USDC under the contract's caps, and block a $5,000 over-cap payment until your wallet approves it
- [ ] Let a new freelancer share where to be paid with a single-use claim link

## Plan

### M1 · Day 1 (2026-11-01): Foundations
- [x] Scaffold the pnpm monorepo (apps/desktop, apps/backend, apps/web, packages/core, contracts/agent-wallet) with a hello-world in each
- [x] Desktop interface from the design on sample data: meeting page, follow-ups with "check before you approve", transcript with evidence links, recording panel with the consent tick, processing stages, light and dark
- [x] Tauri app with menu bar item, consent tick and the Core Audio + mic recorder writing 5-minute 16 kHz WAV chunks (about 9.6 MB each, under NEAR AI's 25 MB limit). Checked on a real call: both stems carry sound, saved recordings reload after a restart
- [x] Agent-wallet contract with daily cap, per-payment cap, payee list, pending approvals and proof registry; sandbox tests in CI (18 tests: 5 unit, 13 on a local NEAR node)
- [x] NestJS backend with NEP-413 NEAR login and a JWT session
- [ ] Silence watchdog: warn when system audio is exact zeros for 30 s. Built and unit-tested; still to see it fire live (record with System Audio Recording turned off)

### M2 · Day 3 (2026-11-03): Private notes
- [ ] Transcribe each chunk with Whisper on NEAR AI, passing payee and project names as the prompt. Built and tested against a fake NEAR AI; first real run waits on a NEAR AI key
- [x] Label "You" (mic) and "Others" (system audio) by transcribing the two stems
- [ ] Summarise with Qwen3.8-27B into the zod schema (decisions, action items, follow-ups, evidence quotes); drop items whose quote isn't in the transcript. Built and tested with a fake model; real quality check waits on the key
- [x] Meeting page and transcript view with quote links, on real notes once a recording is processed
- [ ] Backend mints a spend-limited NEAR AI key per user
- [ ] Attestation preflight and response-signature check for the summary call. Built; signature recovery matches ethers on 20 of 20 messages; first check against real NEAR AI waits on the key

### M3 · Day 4 (2026-11-04): Proof anyone can check
- [ ] Deploy the contract to testnet; app adds the limited key (pay, record_proof). The app's key, Connect NEAR screen and `contracts/scripts/deploy-testnet.sh` are built; the app's signer is tested against a local NEAR node; the testnet deploy waits on a testnet account
- [x] Build the proof bundle, hash it and call `record_proof` (proven on a local NEAR node: recorded, duplicate refused, nothing else allowed)
- [x] Processing screen with live stages
- [x] Verify sheet in the app (5 checks plus "notes unchanged since signing" and "what this does not prove")
- [x] Public Verify page on the web (`/verify#…`), re-running the checks in the browser against NEAR RPC with no meeting content
- [ ] Gate 1: a real call becomes verified notes with a public proof link

### M4 · Day 7 (2026-11-07): It does what the meeting decided
- [x] Recap email card: Approve and send (backend + Resend, consent line, 50 a day per account) or Draft in Mail (opens your own mail app; nothing leaves the Mac). Sending through Resend waits on a Resend key
- [x] Payment card with the "check before you approve" row (heard words vs parsed amount and payee)
- [x] Agent wallet in the app: balance, spent today, caps, payees, pause, deposit and withdraw, read live from the contract; every change is signed in your own NEAR wallet through the web signing page. The page opens real NEAR wallets; a signed change on testnet waits on a testnet account
- [x] Capped payment after one tap; payment states (sending, paid, failed with refund), sent with this Mac's limited key (pay is proven on a local NEAR node)
- [x] Over-cap $5,000 blocked; approve-in-wallet web page (`/sign`, any NEAR wallet via NEAR Connect); app updates when the wallet signs (polls NEAR; first live check waits on a testnet account)
- [x] Claim link: single-use link (7 days), stored in Postgres with only a hash of the token, phone claim page, owner confirms the payee in their wallet. Tested end to end against the backend; emailing the link waits on Resend
- [x] Autopilot rules (team-domain recaps, listed payees within the per-payment cap and today's allowance), with a 60-second undo
- [ ] Gate 2: the full demo works end to end on testnet
- [ ] 5 Nov: public rough build and a video reply in the teaser thread to Illia

### M5 · Day 10 (2026-11-10): Real users and trust
- [x] Onboarding v0: welcome, a real 5-second audio check (triggers the macOS prompts), NEAR AI key, first recording; wallet later in Settings
- [ ] Meeting names and recap recipients from the macOS calendar
- [x] Projects, cross-meeting action items and local search (⌘K: decisions, action items and transcript lines, on the device)
- [ ] Deploy to mainnet with tiny amounts; remove the contract account's full-access keys
- [ ] Staking for Inference funds the team org; counts-only stats endpoint
- [ ] Recovery phrase, restore on a new Mac, settings. Settings done (NEAR AI key, NEAR, autopilot); recovery not started
- [ ] Gate 3: 20 outside users, no mocked screens

### M6 · Day 12 (2026-11-12): Stretch and judges
- [ ] Agent context: local MCP server (read tools plus claim and complete action items), Connected agents screen
- [ ] Pay a payee on Solana or Base through NEAR Intents 1Click under the same caps (tiny mainnet amounts)
- [x] README for human and AI judges: "do X, see Y" steps, NEAR pieces used, architecture, what is and isn't proven
- [x] One-command verify script (`pnpm verify`) and all tests in CI

### M7 · Day 14 (2026-11-14): Ship
- [ ] Record the 90-second demo video (13 Nov)
- [ ] X post in the teaser thread, saying it was built at NEAR HACKATHON, with the video and live numbers (Victor posts it)
- [ ] Make the repo public and check no secrets are in history (`gitleaks`)
- [ ] Victor submits the form by hand before 2026-11-14 23:59 UTC (tracks: privacy, security, agents, business, realworld)

## Submission checklist

- [ ] Public repo whose README claims match the code exactly
- [ ] Demo video, 90 seconds, following the demo script in the build doc
- [ ] Public X post saying the project was built at NEAR HACKATHON, with the video or screenshots
- [ ] Mainnet NEAR payout account ready (created by Victor)
- [ ] Form at https://nearhackathon.com/#apply filled in by Victor; one submission, can't be edited
- [ ] Contract tests and the verify script pass from a clean checkout
- [ ] No secrets in the repo; `.env.example` only
