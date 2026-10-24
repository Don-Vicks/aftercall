# Aftercall

Private meeting notes that do the follow-ups. Built for NEAR HACKATHON (1–14 Nov 2026).

Aftercall records a call on your Mac, transcribes and summarises it inside NEAR AI Cloud's secure hardware (TEEs), and records a proof of that on NEAR that anyone can check. It then does what the meeting decided: the recap email goes out and the agreed payment is made in USDC on NEAR, after one approval or under autopilot rules you set. A NEAR contract caps what the app can ever pay, so even a hijacked app or a tricked AI can't overspend.

> Status: planning only. Product code starts 1 Nov 2026 00:00 UTC, as the hackathon rules require. Pre-event experiments live in a separate throwaway repo (`aftercall-spike`); nothing from it is copied in until the build starts.

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

Repo layout (created in M1): `apps/desktop`, `apps/backend`, `apps/web`, `packages/core`, `contracts/agent-wallet`, `docs/`.

## Plan

### M1 · Day 1 (2026-11-01): Foundations
- [ ] Scaffold the pnpm monorepo (apps/desktop, apps/backend, apps/web, packages/core, contracts/agent-wallet) with a hello-world in each
- [ ] Tauri app with menu bar item, consent tick and the Core Audio + mic recorder writing 5-minute WebM/Opus chunks
- [ ] Agent-wallet contract with daily cap, per-payment cap, payee list, pending approvals and proof registry; sandbox tests in CI
- [ ] NestJS backend with NEP-413 NEAR login and a JWT session
- [ ] Silence watchdog: warn when system audio is exact zeros for 30 s

### M2 · Day 3 (2026-11-03): Private notes
- [ ] Transcribe each chunk with Whisper on NEAR AI, passing payee and project names as the prompt
- [ ] Label "You" (mic) and "Others" (system audio) by transcribing the two stems
- [ ] Summarise with Qwen3.8-27B into the zod schema (decisions, action items, follow-ups, evidence quotes); drop items whose quote isn't in the transcript
- [ ] Meeting page and transcript view with quote links
- [ ] Backend mints a spend-limited NEAR AI key per user
- [ ] Attestation preflight and response-signature check for the summary call

### M3 · Day 4 (2026-11-04): Proof anyone can check
- [ ] Deploy the contract to testnet; app adds the limited key (pay, record_proof)
- [ ] Build the proof bundle, hash it and call `record_proof`
- [ ] Processing screen with live stages
- [ ] Verify sheet in the app (5 checks plus "what this does not prove")
- [ ] Public Verify page on the web, re-running the checks in the browser with no meeting content
- [ ] Gate 1: a real call becomes verified notes with a public proof link

### M4 · Day 7 (2026-11-07): It does what the meeting decided
- [ ] Recap email card: Approve and send (Resend, consent line) or Draft in Mail
- [ ] Payment card with the "check before you approve" row (heard words vs parsed amount and payee)
- [ ] Agent wallet in the app: deposit testnet USDC, set caps, add payees
- [ ] Capped payment after one tap; payment states (sending, paid, failed with refund)
- [ ] Over-cap $5,000 blocked; approve-in-wallet web page; app updates when the wallet signs
- [ ] Claim link: email, phone claim page, owner confirms in wallet
- [ ] Autopilot rules (internal recaps, listed payees, per-payment cap)
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
