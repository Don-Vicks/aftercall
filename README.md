# Aftercall

**Private meeting notes that do the follow-ups.**

Aftercall is a Mac app that records your calls, makes the notes inside NEAR AI Cloud's secure hardware, and then acts on what was agreed: it sends the recap and pays what the call promised in USDC, within limits a NEAR contract enforces.

[![Download for Mac](https://img.shields.io/badge/Download-Mac%20test%20build-2f7d6d)](https://getaftercall.vercel.app/download)
[![Try it in your browser](https://img.shields.io/badge/Try%20it-in%20your%20browser-2f7d6d)](https://getaftercall.vercel.app/demo)
[![NEAR testnet](https://img.shields.io/badge/NEAR-testnet%20contract%20live-111)](#on-chain-evidence)
[![CI](https://github.com/Don-Vicks/aftercall/actions/workflows/ci.yml/badge.svg)](https://github.com/Don-Vicks/aftercall/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-555)](LICENSE)

<picture><source media="(prefers-color-scheme: dark)" srcset="apps/web/public/landing/meeting-dark.webp"><img src="apps/web/public/landing/meeting-light.webp" alt="A meeting in Aftercall: verified notes, each item backed by a quote from the call" width="100%"></picture>

## The problem

Meeting-notes apps send your calls to servers you can't inspect, and they stop at a summary. The recap still has to be written and sent, and the payment agreed on the call still has to be made, by you, later.

## What Aftercall does

1. **Records the call** from any app on your Mac. No bot joins the meeting.
2. **Makes the notes in secure hardware.** Before anything is sent, the app checks NEAR AI Cloud's TEE attestation, then encrypts the transcript end to end to the attested model. (The audio goes to transcription over TLS pinned to the attested gateway's key: NEAR AI has no end-to-end encryption for transcription.) Every note must quote the call; items without an exact quote are dropped.
3. **Proves it on NEAR.** A hash of each meeting's proof is recorded on chain, never the meeting itself. Anyone with the proof link can re-run every check in a browser at `/verify`.
4. **Does the follow-ups.** It sends the recap and pays what the call agreed in USDC after one tap, or on autopilot rules you set. The app's key can only pay listed payees within daily and per-payment caps; anything larger waits for your own wallet.

## Why NEAR

- **NEAR AI Cloud** runs the speech and language models (`openai/whisper-large-v3`, `Qwen/Qwen3.8-27B`) inside Intel TDX and NVIDIA confidential-computing TEEs, with attestation the app verifies on every run.
- **A NEAR contract** (`contracts/agent-wallet`) holds the money and the rules: payees, caps, meeting proofs and escrow. The app holds only a function-call key limited to `pay`, `record_proof`, `open_escrow` and `release_escrow` (a key added before 7 Nov holds only `pay` and `record_proof` until the owner updates it once; the one on `nov3.testnet` still does).
- **NEAR Intents** quotes payouts to payees on Solana or Base.

## Demo

- **Video (1:30, real footage):** [posted on X](https://x.com/VictorShallang/status/2119529850646020401). The Mac app during the 8 Nov testnet run: consent, the secure-hardware checks, notes with quotes, a recap emailed, a 5 USDC payment, a $5,000 payment held for the owner's wallet, and the call's proof passing 8 of 8 on `/verify`.
- **In your browser:** https://getaftercall.vercel.app/demo opens a sample meeting with its notes, checks, follow-ups and a live NEAR Intents quote (dry: nothing is sent).

## How to test

Choose by the time you have. Every command, link and expected result is in [docs/judging.md](docs/judging.md#how-to-test-step-by-step).

| Time | What you do | What you see |
| --- | --- | --- |
| 1 min | Open the link in [docs/proof-sample.txt](docs/proof-sample.txt) in a browser | A sample call's proof re-checked against NEAR testnet: 7 of 7 checks pass (8 of 8 for its first two days, until NVIDIA retired the key that signed its GPU token; that check is then shown as the app recorded it) |
| 1 min | Open [`record_proof`](https://testnet.nearblocks.io/txns/2oawJPTmRiNky6EGzpURh79FRDkFcx4bp1kL76DevZro) on `wallet.aftercall.testnet` | A real call's proof, sent by the Mac app; its link is in [docs/proof-3-nov.txt](docs/proof-3-nov.txt) |
| 2 min | Open https://getaftercall.vercel.app/demo | The app in a browser on a sample meeting |
| 5 min | `pnpm install && pnpm dev:phone -- --relay https://aftercall-api.vercel.app --web https://getaftercall.vercel.app` | A simulated Mac pairs with your phone; approve or dismiss what it sends ([more](docs/judging.md#5-minutes-approve-from-your-own-phone)) |
| 10 min | `curl -fsSL https://getaftercall.vercel.app/install.sh \| sh` | The Mac app (macOS 14.2+, unsigned test build, NEAR testnet) ([more](docs/judging.md#10-minutes-the-mac-app)) |
| From source, with NEAR AI | `pnpm --filter @aftercall/core proof:run` with `NEAR_AI_API_KEY`, `OWNER`, `PAYEE` and `APP_KEY` set, near-cli-rs on the PATH, the owner registered with the payee listed and a per-payment cap of at least 1 USDC, and the payee's key in near-cli's keychain ([details](packages/core/scripts/proof-run.ts)) | The sample call's notes from NEAR AI's TEEs, its proof on testnet, an autopilot payment and a Handshake escrow, written to `docs/proof-run.md` |
| From source | `pnpm install && pnpm verify --quick` | A ✓ line per step and exit code 0 ([full verify](docs/judging.md#from-source-pnpm-verify)) |

Requirements for source builds: Node 24, pnpm 10, stable Rust. Making notes in the Mac app needs a NEAR AI key; the app offers Aftercall's test credits if you don't have one. `/verify`, `/demo`, `/phone` and `/stats` render with JavaScript, so open them in a browser rather than fetching them.

## How it works

```mermaid
flowchart TB
  subgraph Mac["Mac app (Tauri, Rust, React)"]
    rec["Record call<br/>(Core Audio tap + mic)"]
    notes["Notes pipeline<br/>attest → encrypt → check signature"]
    fu["Follow-ups<br/>recap · payment · escrow"]
  end
  subgraph AI["NEAR AI Cloud (TEEs)"]
    whisper["whisper-large-v3"]
    qwen["Qwen3.8-27B"]
  end
  subgraph NEAR["NEAR testnet"]
    wallet["agent-wallet contract<br/>proofs · payees · caps · escrow"]
  end
  web["Web: /verify · /sign · /claim · /phone"]
  rec --> notes
  notes -- "end-to-end encrypted" --> whisper
  notes -- "end-to-end encrypted" --> qwen
  notes --> fu
  fu -- "pay · record_proof (limited key)" --> wallet
  fu -- "over a cap" --> web
  web -- "owner signs in own wallet" --> wallet
  web -- "re-check a proof" --> wallet
```

- **Fails closed.** Nothing leaves the Mac unless the gateway and model TEEs pass attestation; a reply whose signature doesn't match the attested key marks the notes unverified, and autopilot runs nothing from them.
- **Stored encrypted.** Audio, transcripts and notes are sealed on disk with a key in the macOS Keychain.
- **Backend keeps no meeting content.** The NestJS backend handles sign-in, recap email and claim links, and keeps nothing about a meeting.

Details: [how-it-works.md](docs/how-it-works.md) (every attestation check) · [privacy.md](docs/privacy.md) (what leaves the Mac, who approves, what's kept) · [threat-model.md](docs/threat-model.md).

## On-chain evidence

All on NEAR testnet, contract `wallet.aftercall.testnet`. Live counts: https://getaftercall.vercel.app/stats. The contract account still has a full-access key, so the code can be upgraded; the mainnet deploy is meant to remove it ([threat-model.md](docs/threat-model.md)).

| Event | Transaction | Result |
| --- | --- | --- |
| Proof of a real call's notes, made on live NEAR AI (2 Nov) | [`2oawJPTm…`](https://testnet.nearblocks.io/txns/2oawJPTmRiNky6EGzpURh79FRDkFcx4bp1kL76DevZro) | Recorded 3 Nov; `/verify` passes 7 of 7 ([link](docs/proof-3-nov.txt)) |
| A call promised Kemi $5; the app paid 5 USDC to `kemi-ac.testnet` | [`Eq3rPHqz…`](https://testnet.nearblocks.io/txns/Eq3rPHqzDXoanWV8u1kETAkb3WSD1rTrT7ia4CzMqwXH) | Paid 8 Nov, signed by the app's limited key and linked to the meeting's proof |
| The same call's $5,000, over the 10 USDC per-payment cap | [`B8xV41mT…`](https://testnet.nearblocks.io/txns/B8xV41mTk2VBZoMHGjJSdKH6MgzpfPv51zHoFCfdsttE) | `blocked` (`OVER_PAYMENT_CAP`): parked for the owner's wallet, nothing moved |
| The same run, screen-recorded for the demo video | [`6jK1mauq…`](https://testnet.nearblocks.io/txns/6jK1mauqjVNhhJnmvVuhPiP8DzxCBR9Na9ysoKo6jmKN) (paid), [`6jHzBdiT…`](https://testnet.nearblocks.io/txns/6jHzBdiTCbcgdQ7QbCXySWW1fPEeypik3ZxV7SqXiLou) (held) | That call's proof passes 7 of 7 ([link](docs/proof-payment-call.txt)); 8 of 8 until NVIDIA retired its GPU token key |
| Contract upgraded in place to add Handshake escrow | [`BQXQAhui…`](https://testnet.nearblocks.io/txns/BQXQAhui6ixc2B7QacSoSyw6MWqUvgkGvyfSUfCzYpoq) | 7 Nov, every record kept. Deployed code hash `Cc3mNqSrQeq1Aty91x9iCX521vD55SpJcFA8FEdBgYWm`: `contracts/agent-wallet` is unchanged since commit `2f450e1`, and rebuilding it on the developer's Mac (`cargo near build non-reproducible-wasm`, cargo-near 0.22.0, rustc 1.98.1) gives exactly this hash. That build embeds the build machine's file paths, so on another machine it gives a different hash; a reproducible (Docker) build is the way to let anyone match it |
| Headless proof run (12 Nov): a fictional sample call through NEAR AI's TEEs, 30 of 30 checks; its proof passed 8 of 8 on `/verify` on 12 Nov (7 of 7 once NVIDIA retires its GPU token key, about two days later) | [`Af4cs3Pn…`](https://testnet.nearblocks.io/txns/Af4cs3PnouGWKhciSgbHmmE1kgqD1rsggXT4GdtLJZzi) | [docs/proof-run.md](docs/proof-run.md): every step and both links |
| Same run: autopilot paid the in-cap 1 USDC after its 60-second undo window, signed by the limited app key | [`Ay4Yte5e…`](https://testnet.nearblocks.io/txns/Ay4Yte5eqPX5MYg676jfAjiBcCQgnyoXnSG1faFVcPDP) | Test accounts `demo-owner` and `demo-freelancer` (`.aftercall.testnet`) |
| Same run: 0.50 USDC that waits on a condition, held in a Handshake escrow; the payee confirmed the terms from their own account, then it was released | [`AFvFRrFx…`](https://testnet.nearblocks.io/txns/AFvFRrFxu5dNkXEawpWF3RuptPTEjZR9fVqSLxmHZDWi) (open), [`4eEmcyis…`](https://testnet.nearblocks.io/txns/4eEmcyisyppCVkXDN7ikymrQDSLw5oEtoLqXs7trLcLp) (confirmed), [`8d7msRRg…`](https://testnet.nearblocks.io/txns/8d7msRRgDyQfLi1aWNidLwSSGuxVeGBcNc6Vt8qfgJMw) (released) | Confirming different terms was refused (`TERMS_DIFFER`) before any transaction was sent, so there's none to link |
| A payment over the per-payment cap, held, then approved from the owner's own account (12 Nov, command line) | [`CGqtWddP…`](https://testnet.nearblocks.io/txns/CGqtWddPhTKHMPqPbRRConbC7wSxAo8oSsYzTb5HEdfm) (held), [`6CbYm7qU…`](https://testnet.nearblocks.io/txns/6CbYm7qUaM76WiaPZuycysnXx8Yjq3ChYDVMwTrsAvNN) (approved) | The app key used here (`DFPd…`, deleted after the run) couldn't send `withdraw` at all: "Transaction method name <withdraw> isn't allowed by the access key", so there's no transaction |

## Features and status

| Feature | Status |
| --- | --- |
| Record from any app, no bot | Live |
| Notes in attested TEEs, transcript end-to-end encrypted, every item quoted | Live (NEAR AI, since 2 Nov) |
| Proof on NEAR, re-checkable at `/verify` | Live |
| Recap email through Aftercall, with a footer saying what was checked | Live (since 6 Nov) |
| USDC payment within caps; over a cap held for the owner's wallet | Live on testnet (8 Nov) |
| Test credits, so judges need no NEAR AI account | Live (up to 30 installs): the backend hands out one shared, spend-capped key (`/nearai/test-credits`, checked 12 Nov) |
| NEAR Intents quote for payees on Solana or Base | Live, dry quote; a payout needs mainnet |
| Autopilot: recaps and payments that pass every rule run on their own, with a 60-second undo | Autopilot's decision (`meetingAutopilotDecision`, the app's own code) paid an in-cap payment on testnet on 12 Nov in the headless proof run, after a 60-second wait in the script; the app's own runner and undo haven't run live |
| Approving a held payment from the owner's wallet at `/sign` | The approval ran on testnet on 12 Nov from the owner's account by command line. The transactions `/sign` builds are unit-tested and their contract path runs on a local NEAR node; the page itself hasn't approved a parked payment in a browser wallet |
| Handshake: escrow until the payee confirms the terms from their own wallet | Ran on testnet on 12 Nov in the headless proof run: the payee confirmed from their own account; not yet through the `/deal` page with a browser wallet |
| Coding agents (Claude Code, Codex) claim and finish action items over a local MCP server | Built and tested; Claude Code [recorded](docs/agents-demo.md) on a stand-in app, not yet with the Mac app |
| Approvals from your phone, sealed so the relay can't read them | Deployed 7 Nov; run with a simulated Mac, not yet a real phone |
| Post a recap to Slack | Built and tested against a local stand-in |
| Encrypted backup to iCloud Drive | Built and tested; not yet with real iCloud Drive |
| Share one line of a meeting with a Merkle proof | Built and tested; no line link shared yet |
| Mainnet contract and 1Click payout | Not yet. Testnet is eligible in every track (rules, Q-010) |

<table>
<tr>
<td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="apps/web/public/landing/home-c-dark.webp"><img src="apps/web/public/landing/home-c-light.webp" alt="Today: what needs you" width="100%"></picture><br><sub>Today: what needs you, including a $5,000 payment held for your wallet.</sub></td>
<td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="apps/web/public/landing/privacy-c-dark.webp"><img src="apps/web/public/landing/privacy-c-light.webp" alt="Privacy and your data" width="100%"></picture><br><sub>Privacy: what stays on the Mac, encrypted, and what goes where.</sub></td>
</tr>
<tr>
<td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="apps/web/public/landing/actions-c-dark.webp"><img src="apps/web/public/landing/actions-c-light.webp" alt="Action items, one claimed by Claude Code" width="100%"></picture><br><sub>Action items; coding agents can claim them when you allow it.</sub></td>
<td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="apps/web/public/landing/palette-detail-dark.webp"><img src="apps/web/public/landing/palette-detail-light.webp" alt="The command palette" width="100%"></picture><br><sub>⌘K searches decisions, action items and transcript lines.</sub></td>
</tr>
</table>

## Claims, code and tests

| Claim | Code | Tests |
| --- | --- | --- |
| Nothing is sent unless NEAR AI's TEEs pass attestation; the transcript is encrypted end to end to the attested model | `packages/core/src/tee/`, `packages/core/src/notes/pipeline.ts` | `pipeline.test.ts`, `checks.test.ts`, `e2ee.test.ts` |
| Every reply's signature is checked against the attested key; notes that fail are marked unverified, and autopilot runs nothing from them | `pipeline.ts`, `packages/core/src/followups/autopilot.ts` | `pipeline.test.ts`, `autopilot.test.ts` |
| The model can't propose a follow-up without an exact quote from the call; a payment's amount must be in its quote | `packages/core/src/notes/build.ts`, `transcript.ts` | `build.test.ts`, `transcript.test.ts` |
| The app's key can only pay, record proofs and open or release escrows, within the caps; over a cap waits for the owner's wallet | `contracts/agent-wallet/src/lib.rs` | `contracts/agent-wallet/tests/sandbox.rs` (local NEAR node) |
| An escrow pays only after the payee confirms the exact terms (a salted hash on chain) from their own account | `lib.rs`, `packages/core/src/followups/deal.ts`, `apps/web/app/deal/` | `escrow_*` (sandbox), `deal.test.ts` |
| Anyone can re-run a proof's checks in a browser | `apps/web/app/verify/` | `verify.test.ts`, `proof.test.ts` |
| A shared line is checked against the transcript the proof on NEAR commits to; the link reveals no other line | `packages/core/src/notes/lines.ts`, `disclosure.ts` | `lines.test.ts`, `disclosure.test.ts`, `packages/receipts` tests |
| The backend keeps nothing about a recap; claim links keep only a token hash and an amount | `apps/backend/src/email/`, `apps/backend/src/claims/` | `email.test.ts`, `claims.test.ts` |
| An agent's follow-up waits for your tap: never autopilot, never the phone, payments only to listed payees within your caps | `apps/desktop/src-tauri/src/agents.rs`, `autopilot.ts` | `agents.rs` tests, `autopilot.test.ts`, `apps/mcp/src/tools.test.ts` |
| The phone sees only what approving needs, sealed so the relay can't read it; the Mac re-checks every tap | `packages/core/src/relay/`, `apps/backend/src/relay/` | `messages.test.ts`, `mac.test.ts`, `relay.test.ts` |

Every claim with its exact test names: [docs/proven.md](docs/proven.md).

## Hackathon tracks

Built for NEAR HACKATHON (1–14 Nov 2026). How each track is answered, with files and tests: [judging.md](docs/judging.md#tracks).

| Track | In Aftercall |
| --- | --- |
| Privacy & Private AI | Notes made in attested TEEs; the transcript end-to-end encrypted to the attested model; a public proof on NEAR with no meeting content |
| Real-World Money | Pay a freelancer the amount agreed on a call in USDC, under caps a contract enforces, or hold it in escrow until they confirm the terms |
| AI Security & Defense | A function-call key that can only pay listed payees within daily and per-payment caps; anything bigger waits for the owner's wallet |
| Agent Economy | The meeting's model proposes payments the agent wallet makes within caps; coding agents claim action items over MCP and can propose payments that wait for the owner's tap |
| Autonomous Business | Autopilot: the owner sets caps, payees and team domains once, and follow-ups that pass every rule run on their own, with an undo |

## NEAR stack

| Piece | Used for | Code |
| --- | --- | --- |
| [NEAR AI Cloud](https://docs.near.ai/cloud/verification) private inference | Transcription and notes in TEEs; attestation checked per the docs and the [reference verifier](https://github.com/nearai/nearai-cloud-verifier) | `packages/core/src/tee/`, `apps/desktop/src-tauri/src/attest.rs` |
| [End-to-end encrypted chat, v2](https://docs.near.ai/cloud/guides/e2ee-chat-completions) (Ed25519, XChaCha20-Poly1305) | A fresh key per request; the transcript encrypted to the attested model, or not sent | `packages/core/src/tee/e2ee.ts`, `apps/desktop/src-tauri/src/nearai.rs` |
| near-sdk 5.29 | The agent-wallet contract | `contracts/agent-wallet` |
| Function-call access keys | The app's key: `pay`, `record_proof`, `open_escrow` and `release_escrow` only; 1-yocto rule for owner methods | `crates/near-tx`, `contracts/agent-wallet` |
| NEP-141 (Circle USDC) | `ft_transfer_call` deposits, payee registration with `storage_deposit` | `contracts/agent-wallet`, `packages/core/src/wallet/actions.ts` |
| NEP-413 | Sign-in, signed in Rust and verified in TypeScript | `crates/near-tx`, `apps/backend/src/auth` |
| [NEAR Intents 1Click](https://www.npmjs.com/package/@defuse-protocol/one-click-sdk-typescript) | USDC to payees on Solana or Base under a cross-chain cap; dry quotes live | `packages/core/src/intents/oneclick.ts`, [docs](docs/near-intents-1click.md) |
| NEAR Connect 0.12.0 | Owner approvals in any NEAR wallet at `/sign` | `apps/web/app/sign/` |
| JSON-RPC (FastNEAR) | Views, `send_tx`, access-key checks; one config for testnet and mainnet | `crates/near-tx`, `apps/web/app/verify`, `packages/core/src/network.ts` |

Planned, not built: paying for inference with [Staking for NEAR AI](https://near.ai/blog/staking-for-near-ai) ([write-up](docs/staking-for-inference.md)).

## Repository

```
apps/desktop     Mac app (Tauri 2, Rust, React 19)
apps/web         Website, /demo, /verify, /sign, /claim, /phone (Next.js)
apps/backend     Sign-in, recap email, claim links, phone relay (NestJS, Postgres)
apps/mcp         Local MCP server for coding agents
packages/core    Notes pipeline, attestation checks, E2EE, follow-ups, autopilot
packages/receipts  Check proofs and shared lines from code
contracts/agent-wallet  NEAR contract: proofs, payees, caps, escrow
crates/near-tx   Transaction signing and NEP-413 in Rust
scripts/verify.sh  One command that builds and tests every part
```

Run every part locally: [docs/development.md](docs/development.md).

**Platforms:** macOS 14.2+ (Apple silicon and Intel). Windows is next (WASAPI loopback in place of the Core Audio tap). Phones can't record another app's call, so a phone handles approvals at `/phone`, a held payment's wallet approval and a payee's claim link.

## Other project

Victor's other NEAR HACKATHON entry is [ShowUp](https://github.com/Don-Vicks/showup) (https://showup-lake.vercel.app): RSVPs backed by a USDC deposit returned at the door, and sponsors who pay hosts per verified attendee. The two projects are independent and share no code (FAQ Q-015).

## Built with

Disclosed per the hackathon FAQ (Q-005).

- **AI-written code:** most of this repository was written by Claude Code (Anthropic's coding agent) under Victor's direction, from Victor's own plan and design. Commits up to 7 Nov carry a `Co-Authored-By: Claude` line; later ones don't, and were written the same way. Features were often built in parallel by several agents in separate worktrees and then merged, which is why some days have many small commits. History is as committed: nothing squashed or rewritten.
- **No templates or pre-existing project code.** Planning docs from 24 Oct 2026 and code from 26 Oct 2026, after the event's 19 Oct announcement (FAQ Q-001). The attestation checks follow NEAR's [reference verifier](https://github.com/nearai/nearai-cloud-verifier) and the [NEAR AI Cloud agent skill](https://github.com/near/agent-skills/tree/main/skills/near-ai-cloud); the TDX test fixtures are Phala's sample quote and collateral (MIT), in `apps/desktop/src-tauri/tests/fixtures`.
- **Libraries:** desktop: Tauri 2 (tauri-plugin-notification), React 19, Tailwind CSS 4, motion, lucide-react, uqr; Rust: cidre, cpal, hound, reqwest, keyring, objc2-event-kit, dcap-qvl (Phala), bip39, chacha20poly1305, hkdf, sha2, bs58, zeroize. Core: zod, @noble/curves, @noble/hashes, @noble/ciphers (`pnpm sample:notes` uses @phala/dcap-qvl-node). Backend: NestJS, pg, jose, @scure/base. Web: Next.js, @hot-labs/near-connect. MCP: @modelcontextprotocol/sdk. Contract: near-sdk 5.29, near-workspaces; signer: ed25519-dalek.
- **Tooling and design:** Playwright screenshots (`scripts/screens.mjs`); designed with Claude ([Aftercall Screens](https://claude.ai/artifact/RXNzkVE5TXbVu2ynPKRScW)); fonts Newsreader, Instrument Sans, Geist Mono.

More docs: [judging.md](docs/judging.md) · [proven.md](docs/proven.md) · [demo-script.md](docs/demo-script.md) · [plan.md](docs/plan.md) · designs for the [phone](docs/design/phone.md), its [protocol](docs/design/phone-protocol.md) and [agents](docs/design/agents.md)

## License

[MIT](LICENSE).
