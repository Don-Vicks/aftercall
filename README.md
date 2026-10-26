# Aftercall

Private meeting notes that do the follow-ups. Built for NEAR HACKATHON (1–14 Nov 2026).

Aftercall records a call on your Mac, transcribes and summarises it inside NEAR AI Cloud's secure hardware (TEEs), and records a proof of that on NEAR that anyone can check. It then does what the meeting decided: the recap email goes out and the agreed payment is made in USDC on NEAR, after one approval or under autopilot rules you set. A NEAR contract caps what the app can ever pay, so even a hijacked app or a tricked AI can't overspend.

> Status: in development. Building started on 26 Oct 2026, before the 1–14 Nov window, after a NEAR HACKATHON moderator confirmed in the event Discord (22 Oct) that early development is allowed. The commit history shows the real timeline. Pre-event experiments live in a separate throwaway repo (`aftercall-spike`) and are re-implemented here, not copied.

Design: [Aftercall Screens](https://claude.ai/artifact/RXNzkVE5TXbVu2ynPKRScW) · [Design system](https://claude.ai/artifact/96RdBedZXsLxdXixzAdk6x) · Spec: [Build doc](https://claude.ai/artifact/6GEqowfi9wDWXqV1iYo1Pp) (private links for the team).

## MVP

- [ ] Record a real call on macOS (system audio + mic, consent tick) and get a private, signed summary with decisions, action items and evidence quotes
- [ ] Record the proof on NEAR and show it on a public Verify page anyone can open without installing
- [ ] Send the recap email with the consent line, through Aftercall or as a draft in your own Mail app
- [ ] Pay a listed payee in USDC under the contract's caps, and block a $5,000 over-cap payment until your wallet approves it
- [ ] Let a new freelancer share where to be paid with a single-use claim link

## Stack

| Part | Choice |
| --- | --- |
| Desktop | Tauri v2, React, TypeScript, Tailwind; Rust Core Audio process tap (`cidre`) for system audio |
| Shared core | TypeScript package: NEAR AI client (OpenAI SDK, `https://cloud-api.near.ai/v1`), summary schema (zod), follow-up engine, NEAR calls |
| AI | `openai/whisper-large-v3` and `Qwen/Qwen3.8-27B`, both Confidential TEE on NEAR AI Cloud |
| Backend | NestJS + Postgres: NEAR login (NEP-413), per-user spend-limited NEAR AI keys, Resend email, claim links, counts-only stats |
| Web | Next.js: public Verify page, payee claim page, approve-in-wallet page |
| Contract | Rust, near-sdk 5.29, cargo-near 0.22, near-sandbox tests; Circle USDC (NEP-141) |
| Wallets | @hot-labs/near-connect |

Repo layout: `apps/desktop` (Tauri app), `apps/backend` (NestJS), `apps/web` (Next.js), `packages/core` (shared types and helpers), `contracts/agent-wallet` (NEAR contract), `docs/` (rules, design source).

## Run it

Needs Node 24, pnpm 10 and Rust (stable).

```bash
pnpm install
./scripts/dev.sh   # backend (Postgres), web pages and the Mac app together
pnpm dev:desktop   # the Mac app (Tauri); first build compiles Rust for a few minutes
pnpm dev:ui        # the same interface in a browser at http://localhost:1420
pnpm test          # unit tests (core, backend)
```

Contract tests: see [`contracts/README.md`](contracts/README.md). Backend settings: copy `apps/backend/.env.example` to `.env`.

Recording is real in the Mac app: it writes `mic-NNN.wav` (You) and `system-NNN.wav` (Others) to `~/Library/Application Support/dev.aftercall.app/recordings/<id>/`. macOS only grants system-audio capture to the bundled app, so test recording with `pnpm --filter @aftercall/desktop tauri build --debug --bundles app` and open the `.app`. With a NEAR AI key (pasted once in the app, kept in the macOS Keychain) a recording becomes notes: Whisper and Qwen3.8-27B in NEAR AI's secure hardware, the summary's signature checked against the attested signer, only quote-backed items kept, then the audio is deleted. The app opens on Home: start a recording, what needs you, recent meetings and setup. If NEAR is connected (Settings), the proof hash is recorded with `record_proof`; the Verify sheet re-checks it live and copies a public link to the web Verify page. On real notes, approving a payment pays through the contract and a recap sends through the backend; the sample meeting only simulates both. Payees come from `apps/desktop/src/sample.ts` until the contract is wired in.

## Plan

### M1 · Day 1 (2026-11-01): Foundations
- [x] Scaffold the pnpm monorepo (apps/desktop, apps/backend, apps/web, packages/core, contracts/agent-wallet) with a hello-world in each
- [x] Desktop interface from the design on sample data: meeting page, follow-ups with "check before you approve", transcript with evidence links, recording panel with the consent tick, processing stages, light and dark
- [x] Tauri app with menu bar item, consent tick and the Core Audio + mic recorder writing 5-minute 16 kHz WAV chunks (about 9.6 MB each, under NEAR AI's 25 MB limit). Checked on a real call: both stems carry sound, saved recordings reload after a restart
- [x] Agent-wallet contract with daily cap, per-payment cap, payee list, pending approvals and proof registry; sandbox tests in CI (16 tests pass locally; the CI workflow runs them on push)
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
- [ ] Onboarding v0: download, permissions, record, notes; wallet and recovery phrase later
- [ ] Meeting names and recap recipients from the macOS calendar
- [ ] Projects, cross-meeting action items and local search
- [ ] Deploy to mainnet with tiny amounts; remove the contract account's full-access keys
- [ ] Staking for Inference funds the team org; counts-only stats endpoint
- [ ] Recovery phrase, restore on a new Mac, settings
- [ ] Gate 3: 20 outside users, no mocked screens

### M6 · Day 12 (2026-11-12): Stretch and judges
- [ ] Agent context: local MCP server (read tools plus claim and complete action items), Connected agents screen
- [ ] Pay a payee on Solana or Base through NEAR Intents 1Click under the same caps (tiny mainnet amounts)
- [ ] README for human and AI judges: "do X, see Y" steps, NEAR pieces used, architecture, what is and isn't proven
- [ ] One-command verify script and all tests passing in CI

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
