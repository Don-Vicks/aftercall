# Aftercall

Meeting notes apps send your calls to servers you can't check, and the recap and payments a call agrees on still wait on you.

**Aftercall is private meeting notes that do the follow-ups.** A Mac app records the call, with no bot joining. The notes are made inside NEAR AI Cloud's secure hardware, which the app checks first. Then Aftercall sends the recap and pays what the call agreed in USDC, once you approve or by autopilot rules you set.

**Why NEAR:** NEAR AI Cloud runs the models in attested hardware (TEEs), and the transcript is encrypted end to end to the attested model. A NEAR contract holds the money: the app's key can only pay listed payees within your caps and record each meeting's proof. Anything over a cap waits for your own wallet.

[![Download for Mac](https://img.shields.io/badge/Download-Mac%20test%20build-2f7d6d)](https://getaftercall.vercel.app/download)
[![Try it in your browser](https://img.shields.io/badge/Try%20it-in%20your%20browser-2f7d6d)](https://getaftercall.vercel.app/demo)
[![NEAR testnet](https://img.shields.io/badge/NEAR-testnet%20contract%20live-111)](#how-to-test)
[![CI](https://github.com/Don-Vicks/aftercall/actions/workflows/ci.yml/badge.svg)](https://github.com/Don-Vicks/aftercall/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-555)](LICENSE)

Built for NEAR HACKATHON (1–14 Nov 2026), tracks: privacy, security, agents, business, realworld. The Mac test build (Apple silicon and Intel) runs on NEAR testnet. On 3 Nov 2026 it made notes from a real call on live NEAR AI and recorded the proof on NEAR.

<picture><source media="(prefers-color-scheme: dark)" srcset="apps/web/public/landing/meeting-dark.webp"><img src="apps/web/public/landing/meeting-light.webp" alt="A meeting in Aftercall: verified notes with decisions, action items and follow-ups, each backed by a quote from the call" width="100%"></picture>

## How to test

Pick by the time you have. Only making notes in the Mac app needs a NEAR AI key. The code: `git clone https://github.com/Don-Vicks/aftercall`.

`/stats`, `/verify`, `/phone` and `/demo` render with JavaScript, so open them in a browser: a plain fetch sees only their loading text.

### 1 minute: the contract and the first proof on NEAR testnet

The contract is `wallet.aftercall.testnet`:

- [register](https://testnet.nearblocks.io/txns/64pwAs3SfUcAJr9vKxGrX6fmhPHzKiUrnKdSWorTEkNz) and [set_cap](https://testnet.nearblocks.io/txns/GDALCrvkRhnMR3qjdpuA9nLVrdFMa4HYSCmwmxhfUuRo), signed in the owner's own NEAR wallet (3 Nov 2026).
- [record_proof](https://testnet.nearblocks.io/txns/2oawJPTmRiNky6EGzpURh79FRDkFcx4bp1kL76DevZro), sent by the Mac app with its limited key after it made notes from a real call on live NEAR AI (3 Nov 2026). That call was a private meeting, so its proof link isn't published. A sample meeting's proof link to open at `/verify` is still to come; until then `/verify` only explains what a proof link is.
- https://getaftercall.vercel.app/stats: counts read live from the contract and the backend. The backend's counts as JSON: `curl -s https://aftercall-api.vercel.app/stats`.

Without a browser (nearblocks refuses scripted requests), the same facts from NEAR's RPC:

```bash
curl -s https://archival-rpc.testnet.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tx","params":{"tx_hash":"2oawJPTmRiNky6EGzpURh79FRDkFcx4bp1kL76DevZro","sender_account_id":"nov3.testnet","wait_until":"FINAL"}}'
```

shows `nov3.testnet` calling `record_proof` on `wallet.aftercall.testnet` with status `SuccessValue`, and

```bash
curl -s https://rpc.testnet.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"wallet.aftercall.testnet","method_name":"get_stats","args_base64":"e30="}}'
```

returns the contract's counts as bytes of JSON, `{"wallets":1,"proofs":1,"payments":0,"parked":0}` on 6 Nov.

### 2 minutes: the app in your browser

Open https://getaftercall.vercel.app/demo, the Mac app's own interface on made-up meetings. It opens on the sample meeting Sync with Ada; if you land on Home, click Sync with Ada under Sample in the sidebar (the two sample recordings on Home need the Mac app to make notes). You'll see the notes with the quote behind each item, the Verify sheet re-running the checks on a test proof, the follow-ups, a $5,000 payment the contract holds for the owner's wallet, and Pay Kemi on Solana with a live NEAR Intents quote from 1Click (a dry quote: nothing is sent).

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
- **Making notes needs your own NEAR AI API key** from https://cloud.near.ai: onboarding asks (Skip for now works; add it later in Settings). Test credits (a capped key from Aftercall for each tester) are built and tested but off until Aftercall's own NEAR AI account is set up, so the app shows only the key field.

### Full: a payment on testnet

In the Mac app, Settings → Set up payments (about 3 minutes, 0.35 test NEAR):

1. **A testnet account.** The app makes `<name>.testnet` for you through NEAR's testnet helper, which funds it. Or choose "I already have an account" and get test NEAR from [NEAR's faucet](https://docs.near.org/getting-started/faucet), or with [near-cli-rs](https://github.com/near/near-cli-rs): `near account create-account sponsor-by-faucet-service <name>.testnet autogenerate-new-keypair save-to-keychain network-config testnet create`.
2. **One approval in your wallet.** The app opens https://getaftercall.vercel.app/sign in any NEAR wallet through NEAR Connect, with one signing request: `register` and `set_cap` on the contract, this Mac's limited key, and your USDC registration.
3. **Test USDC.** [Circle's faucet](https://faucet.circle.com): pick Near Testnet (20 USDC per address every 2 hours, checked 3 Nov 2026). Then Deposit and Add payee on the Ready to pay card, each one approval on `/sign`.
4. **A payment.** Record a call where you agree to pay that payee less than your daily cap, make notes and tap Approve. Over a cap, the payment waits for your wallet on `/sign`.

Not yet run live: the batched approval in a real wallet (on 3 Nov `register` and `set_cap` were signed separately), and any payment from the Mac app on testnet. The same contract paths are tested on a local NEAR node.

### From source: `pnpm verify`

Needs Node 24, pnpm 10 and stable Rust.

```bash
pnpm install && pnpm verify --quick
```

You should see a ✓ line per step and exit code 0: typecheck, unit tests, the web build, the NEAR signer, the desktop Rust tests (macOS only; skipped on Linux) and the contract's unit tests, in a few minutes (longer on a first Rust build). `pnpm verify` also runs the contract on a local NEAR node (20 sandbox tests, about 8 minutes more) and needs:

```bash
rustup target add wasm32-unknown-unknown
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh | sh
```

Running every part locally: [docs/development.md](docs/development.md).

## Built on NEAR's newest

| NEAR launch | When | What Aftercall does with it | Code |
| --- | --- | --- | --- |
| **NEAR AI Cloud:** private inference in TEEs (Intel TDX, NVIDIA confidential GPUs) with attestation reports | Launched 3 Dec 2025 ([NEAR AI](https://near.ai/blog/introducing-near-ai-cloud-private-chat)) | Whisper and Qwen3.8-27B make the notes. The app checks the attestation itself before sending anything, as [the verification docs](https://docs.near.ai/cloud/verification) and the [reference verifier](https://github.com/nearai/nearai-cloud-verifier) describe: TDX quotes with dcap-qvl, GPU evidence through NVIDIA NRAS, the key and nonce bindings, and a signature on every reply from the attested key | `packages/core/src/tee/`, `packages/core/src/notes/pipeline.ts`, `apps/desktop/src-tauri/src/attest.rs` |
| **End-to-end encrypted chat, v2** (Ed25519 keys, XChaCha20-Poly1305) | Documented Mar 2026 ([guide](https://docs.near.ai/cloud/guides/e2ee-chat-completions), [docs commit](https://github.com/nearai/docs/commit/8a285bf49bf6f502b02cb61d956c5508d4ba292b)) | Aftercall's own v2 client: a fresh key for each request, and the transcript encrypted to the attested model's key, or not sent | `packages/core/src/tee/e2ee.ts`, `apps/desktop/src-tauri/src/nearai.rs` |
| **NEAR Intents 1Click API** | SDK first published 28 Mar 2025 ([npm](https://www.npmjs.com/package/@defuse-protocol/one-click-sdk-typescript)) | Paying a payee in USDC on Solana or Base from USDC on NEAR (quote, deposit address, status), under a cross-chain cap the contract enforces. Live dry quotes in `/demo`; a real payout needs mainnet, not yet deployed | `packages/core/src/intents/oneclick.ts`, `contracts/agent-wallet`, [docs](docs/near-intents-1click.md) |
| **NEAR Connect 0.12.0** | Released 26 Oct 2026 ([release](https://github.com/azbang/near-connect/releases/tag/v0.12.0)) | Owner approvals on `/sign` from any NEAR wallet it supports | `apps/web/app/sign/` |
| **near-sdk 5.29** | Released 13 Jul 2026 ([release](https://github.com/near/near-sdk-rs/releases/tag/near-sdk-v5.29.0)) | The agent-wallet contract: caps, payees, parked payments, the proof registry, per-user storage | `contracts/agent-wallet` |

Planned, not built: paying for Aftercall's own inference with **Staking for NEAR AI**, where staking rewards become NEAR AI Cloud credits (announced 30 Jul 2026, [NEAR AI](https://near.ai/blog/staking-for-near-ai)). It's written up in [docs/staking-for-inference.md](docs/staking-for-inference.md); nothing in the repo signs it, and it hasn't been done.

## What it does

1. **Records the call on your Mac.** Your mic and the call's audio, from any app. No bot joins the call.
2. **Makes the notes inside secure hardware.** Whisper and Qwen run in NEAR AI Cloud's TEEs, checked on every run; the transcript is encrypted so only the attested model can read it. Any item without an exact quote from the call is dropped.
3. **Proves it on NEAR.** A hash of the meeting's proof goes on chain, and anyone you share the proof link with can re-run the checks in a browser at `/verify`. No public proof link is published yet ([Live today](#live-today)).
4. **Does what the meeting decided.** The recap goes out with a footer saying what was checked. An agreed USDC payment is made after one tap, or by autopilot if you turn it on (listed payees only, from verified notes, with a 60-second undo). A NEAR contract enforces the caps either way; anything over a cap waits for your own wallet.
5. **Hands action items to coding agents, when you allow it.** Claude Code or Codex reads the meeting through Aftercall's local MCP server, claims an item, marks it done with a link to the work, and can propose a follow-up that waits for your tap. Agents never send or pay on their own.

<table>
<tr>
<td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="apps/web/public/landing/home-c-dark.webp"><img src="apps/web/public/landing/home-c-light.webp" alt="Today: record a meeting, and what needs you, with the payment the contract holds" width="100%"></picture><br><sub>Today: what needs you, including a $5,000 payment the contract holds for your wallet.</sub></td>
<td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="apps/web/public/landing/privacy-c-dark.webp"><img src="apps/web/public/landing/privacy-c-light.webp" alt="Privacy and your data: what stays on the Mac, encrypted, and where data goes" width="100%"></picture><br><sub>Privacy: what stays on the Mac, encrypted, and what goes where.</sub></td>
</tr>
<tr>
<td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="apps/web/public/landing/actions-c-dark.webp"><img src="apps/web/public/landing/actions-c-light.webp" alt="Action items across meetings, one of them claimed by Claude Code" width="100%"></picture><br><sub>Action items across meetings; coding agents can claim them when you allow it.</sub></td>
<td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="apps/web/public/landing/palette-detail-dark.webp"><img src="apps/web/public/landing/palette-detail-light.webp" alt="The command palette searching decisions, action items and transcript lines" width="100%"></picture><br><sub>Search everything on the Mac with ⌘K: decisions, action items, transcript lines.</sub></td>
</tr>
</table>

## For judges

The checks are under [How to test](#how-to-test). The full guide, for people and coding agents: [docs/judging.md](docs/judging.md).

**Where each claim lives:**

| Claim | Code | Tests |
| --- | --- | --- |
| Nothing is sent unless NEAR AI's TEEs pass attestation; the transcript is end-to-end encrypted to the attested model | `packages/core/src/tee/`, `packages/core/src/notes/pipeline.ts` | `pipeline.test.ts`, `checks.test.ts`, `e2ee.test.ts` |
| Every reply's signature is checked against the attested model's key; notes that fail are marked unverified, and autopilot runs nothing from them | `packages/core/src/notes/pipeline.ts`, `packages/core/src/followups/autopilot.ts` | `pipeline.test.ts`, `autopilot.test.ts` |
| The model can't propose a follow-up without an exact quote from the call: items without one are dropped, and a payment's amount must be in its quote | `packages/core/src/notes/build.ts`, `transcript.ts` | `build.test.ts`, `transcript.test.ts` |
| The app's key can only `pay` and `record_proof`, within the caps; over-cap payments wait for the owner's wallet | `contracts/agent-wallet/src/lib.rs` | `contracts/agent-wallet/tests/sandbox.rs` (local NEAR node) |
| Anyone can re-run a proof's checks in a browser | `apps/web/app/verify/` | `verify.test.ts`, `proof.test.ts` |
| The backend keeps nothing about a recap; claim links keep only a token hash and an amount | `apps/backend/src/email/`, `apps/backend/src/claims/` | `email.test.ts`, `claims.test.ts` |
| A follow-up a coding agent proposes waits for your tap: never autopilot, never the phone, payments only to listed payees within your caps | `apps/desktop/src-tauri/src/agents.rs`, `packages/core/src/followups/autopilot.ts` | `agents.rs` tests, `autopilot.test.ts`, `apps/mcp/src/tools.test.ts` |
| The phone sees only what approving needs, sealed so the relay can't read it; the Mac re-checks every tap | `packages/core/src/relay/`, `apps/backend/src/relay/` | `messages.test.ts`, `mac.test.ts`, `relay.test.ts` |

Every claim with its exact test names: [What is proven](docs/proven.md). What has run live and what hasn't: [Live today](#live-today).

## Live today

| What | Where | Status (7 Nov 2026) |
| --- | --- | --- |
| Website, browser demo, install guide | https://getaftercall.vercel.app | Live |
| Test build for Mac (Apple silicon and Intel) | https://getaftercall.vercel.app/download | Live, unsigned, NEAR testnet |
| Backend (sign-in with NEAR, recap email, claim links, counts) | https://aftercall-api.vercel.app/health | Live, with Postgres |
| Contract | `wallet.aftercall.testnet` | Live on testnet: 1 wallet, 1 proof, 0 payments |
| Notes from a real call on live NEAR AI, proof on NEAR | Mac app | Done 3 Nov (private meeting) |
| Recap email sent through Aftercall (Resend) | Mac app → backend | Done 6 Nov |
| A payment, and the $5,000 hold, on testnet | Mac app | Not yet |
| A sample meeting's public proof link for judges | README | Not yet |
| Test credits (a capped NEAR AI key per tester) | backend | Built and tested, off until Aftercall's NEAR AI account is set up |
| Live NEAR Intents quote for a payment to Solana or Base | Browser demo, and the Mac app | Live (a dry quote: nothing is sent) |
| Coding agents: Connect Claude Code, Hand to an agent, done with a link, agent-drafted follow-ups | Mac app, MCP server | Built and tested. Claude Code ran against the MCP server and a stand-in for the app on 1 Nov ([recorded](docs/agents-demo.md)), before most of these existed; not yet with the Mac app. Codex not yet run |
| Approvals on a phone: the `/phone` page, the relay, Settings → Your phone | Web app, backend, Mac app | Deployed 7 Nov and run end to end with a stand-in Mac in a phone-sized browser (the 5-minute check above). Not yet with the Mac app or on a real phone |
| Mainnet: contract, 1Click payout to Solana or Base | | Not yet; testnet is eligible (rules, Q-010) |

**Platforms:** macOS now (Apple silicon and Intel, macOS 14.2 or later). Windows is next: most of the app carries over, and recording the call's audio needs WASAPI loopback capture in place of the Mac's Core Audio tap. Phones can't record another app's call (iOS and Android don't allow it), so on a phone Aftercall handles approvals: the `/phone` page, paired with your Mac by a QR code in Settings → Your phone. A held payment's wallet approval and a payee's claim link also work on a phone. Recording meetings in the room on a phone is a later version.

## How it works

- **Mac app** (Tauri, Rust and React): records both sides of the call, seals audio and notes on disk with a key in the Keychain, and holds a NEAR key that can only call `pay` and `record_proof`. It ships a local MCP server for coding agents.
- **NEAR AI Cloud:** Whisper and Qwen3.8-27B in TEEs, checked on every run ([above](#built-on-nears-newest)).
- **NEAR contract** (`contracts/agent-wallet`): proof registry, payee list, daily and per-payment caps; over-cap payments wait for the owner's wallet.
- **Web:** `/verify` re-runs a proof's checks in the browser; `/sign` for owner actions in any NEAR wallet; `/claim` for payees; `/phone` for approvals on a paired phone.
- **Backend** (NestJS and Postgres): sign-in with NEAR, recap email through Resend, claim links, and the phone relay, which passes sealed boxes it can't open. It keeps nothing about a meeting.

The full diagram, every check and what each part does with your data: [docs/how-it-works.md](docs/how-it-works.md). Who sees and keeps what: [docs/privacy.md](docs/privacy.md).

## Follow-ups: what leaves, who approves, what's kept

A follow-up has to leave the secure hardware to do anything. This is what each one shares, who can say yes, and what record it leaves. The app says the same in place: a "What leaves?" line on each follow-up card (`packages/core/src/followups/boundaries.ts`, tested) and a "Where this meeting went" trail on each meeting.

| Follow-up | What leaves, and to whom | Who approves | What's kept, and where |
| --- | --- | --- | --- |
| Recap, **Draft in Mail** (the default) | The summary, decisions and open action items, to your own mail app. Nothing goes to Aftercall's servers | You, when you send it from Mail | Your mail provider. On the Mac: when you drafted it |
| Recap, **Send through Aftercall** | The same recap, to Aftercall's backend (in memory for one request), then Resend, then the recipient | You tap Send, with a 5-second undo. Autopilot sends only to team domains you list, with a 60-second undo | Resend keeps sent mail under its own policy; the backend keeps a count. On the Mac: the time sent and Resend's email id |
| **Payment within your caps** | The payee's NEAR account and the amount, to NEAR, with a fixed memo ("Aftercall payment") and an id made of the recording's start time and the follow-up's number. No meeting title or text | You tap Approve. Autopilot pays only listed payees within your per-payment cap and today's allowance, with a 60-second undo. The contract checks the payee list and both caps either way | On NEAR, publicly and for good. On the Mac: the transaction hash |
| **Payment over a cap** | The same, parked on the contract instead of paid | Only your own NEAR wallet, on the `/sign` page, can approve or decline it. The app's key can't | On NEAR: the parked payment and your decision |
| **Payment on Solana or Base** (NEAR Intents 1Click) | The amount, the payee's address and your refund account, to the 1Click API; then the payment, to NEAR, with 1Click's deposit address and quote id | As above, and only for payees you opted in, under a cross-chain cap that is 0 (off) until your wallet sets it. Over that cap it's refused, not parked | 1Click's own policy; NEAR as above |
| **Claim link** for a new payee | A token hash and the amount, to Aftercall's backend. The payee's name and the meeting title stay in the link itself | The payee chooses where to be paid; you confirm them as a payee in your own wallet | Backend: the token hash, owner, amount, expiry, status and the account the payee shared |
| **Changing your caps, payees or pause** | A transaction from your wallet, to NEAR | Only your wallet. Each change needs 1 yoctoNEAR attached, which the app's limited key can't attach | On NEAR |
| **Coding agents** (Claude Code, Codex) | To Aftercall's servers, nothing: agents read meetings over a socket only the running app opens, and only in the projects you let them reach. What an agent reads, it sends to its own model provider, as with anything it reads | You. Agents are off by default; claiming, completing and proposing follow-ups is a second switch, also off. Agents can never send, pay or change your rules | On the Mac: a sealed list of each read, claim, completion, proposal and refusal (the newest 200), never meeting content |
| **A follow-up a coding agent proposes** (`draft_follow_up`) | Nothing until you approve it; then the same as the recap or payment rows above | You tap Approve on the Mac. It shows "Proposed by" the agent, with its reason in place of a quote; it never runs on autopilot and never reaches the phone. A payment only to a payee already on your list, within your per-payment cap and what's left today | On the Mac: the proposal, with the agent's name and reason, in the meeting's sealed `notes.json` (at most 20 per meeting); the activity list records it |
| **Approving from your phone** | Each waiting recap's address and subject; each payment's payee, amount, heard words, route and quote; the meeting's title and start. Sealed to a key only your Mac and phone hold, through Aftercall's relay; a held payment's wallet links also carry your NEAR account and what's left of today's cap. Your taps come back the same way | You, on the phone, with a 5-second undo. The Mac checks each tap again and runs its own button under the same rules and caps. A held payment opens your NEAR wallet instead | Relay: the latest sealed snapshot and hashes of the tokens, until you unpair or 30 days after your Mac last called; taps until the Mac collects them, a day at most. Phone: the pairing and the latest snapshot in the browser's storage, until you unpair |

Every meeting also leaves a proof on NEAR, for good: the recording's start time, a hash and the model name, never the meeting itself. The proof link you share carries the checks, hashes and counts, your logged notice and your NEAR account, never the notes or the transcript. Everything else, the field-by-field list with file and line pointers: [docs/privacy.md](docs/privacy.md).

## NEAR pieces used

The newest are under [Built on NEAR's newest](#built-on-nears-newest). The rest:

| Piece | Where |
| --- | --- |
| Function-call access keys as the app's limited authority (`pay` and `record_proof` only); the 1-yocto rule for owner methods | `crates/near-tx`, `contracts/agent-wallet` |
| NEP-141 (Circle USDC): `ft_transfer_call` deposits, payee registration with `storage_deposit` | `contracts/agent-wallet`, `packages/core/src/wallet/actions.ts` |
| NEP-413 sign-in, signed by the app's key in Rust and verified in TypeScript | `crates/near-tx`, `apps/backend/src/auth` |
| JSON-RPC: views, `send_tx`, access-key checks | `crates/near-tx`, `apps/web/app/verify` |
| Testnet and mainnet from one network config (FastNEAR RPC, Circle USDC ids, explorers) | `packages/core/src/network.ts`, `crates/near-tx` |

## More

| | |
| --- | --- |
| [docs/judging.md](docs/judging.md) | The guide for judges: checks to run, claims with their code and tests, track fit, known limits |
| [docs/proven.md](docs/proven.md) | Every claim with the tests that check it, and what has run live |
| [docs/how-it-works.md](docs/how-it-works.md) | Architecture, the checks on every run, privacy in detail |
| [docs/privacy.md](docs/privacy.md) | What leaves the Mac, and who keeps what |
| [docs/development.md](docs/development.md) | Running every part locally, and what each check shows |
| [docs/plan.md](docs/plan.md) | The build plan by milestone, and the submission checklist |
| [docs/agents-demo.md](docs/agents-demo.md) | Claude Code on Aftercall's MCP server: the recorded run, Connect Claude Code, and what agents can do since |
| [docs/near-intents-1click.md](docs/near-intents-1click.md) | Paying a payee on Solana or Base through NEAR Intents 1Click |
| [docs/staking-for-inference.md](docs/staking-for-inference.md) | Paying for notes by staking NEAR |
| [docs/design/phone.md](docs/design/phone.md) | Aftercall on a phone: approvals (built, no push notifications yet), then in-room meetings (not built) |
| [docs/design/phone-protocol.md](docs/design/phone-protocol.md) | The phone protocol: pairing, sealed boxes, the relay's routes and what it keeps, and the tests for each part |
| [docs/design/agents.md](docs/design/agents.md) | Design for coding agents and a meeting's follow-ups: parts 1 to 4 are built, paid work for agents is not |

## Built with

Disclosed per the hackathon FAQ (Q-005).

- **AI-written code:** most of this repository was written by Claude Code (Anthropic's coding agent) under Victor's direction, from Victor's own plan and design. Commits carry a `Co-Authored-By: Claude` line.
- **No templates or pre-existing project code.** Planning docs from 24 Oct 2026, code from 26 Oct 2026: every commit is after the event's 19 Oct announcement, so all of it counts (FAQ Q-001). The attestation checks follow NEAR's [reference verifier](https://github.com/nearai/nearai-cloud-verifier) and the [NEAR AI Cloud agent skill](https://github.com/near/agent-skills/tree/main/skills/near-ai-cloud); the TDX test fixtures are Phala's sample quote and collateral (MIT), in `apps/desktop/src-tauri/tests/fixtures`.
- **Libraries:**
  - Desktop: Tauri 2 (with tauri-plugin-notification), React 19, Tailwind CSS 4, motion, lucide-react, uqr (the pairing QR code); Rust: cidre (Core Audio tap), cpal, hound, reqwest, keyring, objc2-event-kit, dcap-qvl (Phala, Intel TDX quote verification), bip39, chacha20poly1305, hkdf, sha2, bs58, zeroize
  - Shared core: zod, @noble/curves, @noble/hashes, @noble/ciphers; `pnpm sample:notes` uses @phala/dcap-qvl-node
  - Backend: NestJS, pg, jose, @scure/base
  - Web: Next.js, @hot-labs/near-connect
  - MCP server: @modelcontextprotocol/sdk
  - Contract: near-sdk 5.29, near-workspaces (tests); signer crate: ed25519-dalek
- **Dev tooling:** Playwright for screenshots of every screen (`scripts/screens.mjs`).
- **Design:** made with Claude in an artifact ([Aftercall Screens](https://claude.ai/artifact/RXNzkVE5TXbVu2ynPKRScW)); fonts Newsreader, Instrument Sans and Geist Mono.


## License

[MIT](LICENSE).
