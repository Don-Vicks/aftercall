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

<picture><source media="(prefers-color-scheme: dark)" srcset="apps/web/public/landing/meeting-dark.webp"><img src="apps/web/public/landing/meeting-light.webp" alt="A meeting in Aftercall: verified notes, each item backed by a quote from the call" width="100%"></picture>

## How to test

Pick by the time you have. Every command, link and expected result: [How to test, step by step](docs/judging.md#how-to-test-step-by-step). Only making notes in the Mac app needs a NEAR AI key. The code: `git clone https://github.com/Don-Vicks/aftercall`.

`/stats`, `/verify`, `/phone` and `/demo` render with JavaScript, so open them in a browser: a plain fetch sees only their loading text.

- **1 minute, the contract on NEAR testnet.** [record_proof](https://testnet.nearblocks.io/txns/2oawJPTmRiNky6EGzpURh79FRDkFcx4bp1kL76DevZro) on `wallet.aftercall.testnet`, sent by the Mac app after notes from a real call on 3 Nov. Its proof link (hashes, nonces and signatures, never what was said) is in [docs/proof-3-nov.txt](docs/proof-3-nov.txt): open it in a browser and `/verify` re-checks it against NEAR. Live counts at https://getaftercall.vercel.app/stats. The owner's transactions and `curl` checks: [step by step](docs/judging.md#1-minute-the-contract-and-the-first-proof-on-near-testnet).
- **2 minutes, the app in your browser.** https://getaftercall.vercel.app/demo opens on the sample meeting Sync with Ada: notes with their quotes, the Verify sheet, follow-ups, a $5,000 payment held for the owner's wallet, a live NEAR Intents quote (dry: nothing sent). [More](docs/judging.md#2-minutes-the-app-in-your-browser).
- **5 minutes, approve from your own phone.** From a clone (Node 24, pnpm 10), `pnpm install && pnpm dev:phone -- --relay https://aftercall-api.vercel.app --web https://getaftercall.vercel.app` pairs a made-up Mac with your phone; approve or dismiss what it sends. [More](docs/judging.md#5-minutes-approve-from-your-own-phone).
- **10 minutes, the Mac app.** `curl -fsSL https://getaftercall.vercel.app/install.sh | sh` (macOS 14.2+, unsigned test build). [More](docs/judging.md#10-minutes-the-mac-app).
- **Full, a payment on testnet.** In the Mac app, Settings → Set up payments (about 3 minutes, 0.35 test NEAR), then approve a payment agreed on a call. Not yet run live from the Mac app. [Steps and faucets](docs/judging.md#full-a-payment-on-testnet).
- **From source.** `pnpm install && pnpm verify --quick` (Node 24, pnpm 10, stable Rust): a ✓ line per step, exit code 0. [Full `pnpm verify`](docs/judging.md#from-source-pnpm-verify).

## Tracks

Entered in five tracks. What answers each, with files and tests: [judging.md](docs/judging.md#tracks).

| Track | In Aftercall |
| --- | --- |
| Privacy & Private AI | Notes made inside NEAR AI's TEEs after the app checks their attestation; the transcript end-to-end encrypted to the attested model; a public proof on NEAR with no meeting content |
| Real-World Money | Invoices and contractor payouts from your meetings: pay a freelancer the amount agreed on a call in USDC, under caps a NEAR contract enforces, or hold it in escrow until they confirm the terms (Handshake) |
| AI Security & Defense | The agent-wallet contract: a function-call key that can only pay listed payees within daily and per-payment caps; anything bigger waits for the owner's own wallet |
| Agent Economy | The meeting's model proposes payments and the app's agent wallet pays them in USDC within the contract's caps. Coding agents claim and finish action items over MCP and can propose a payment to a listed payee, which waits for the owner's tap. Payees on Solana or Base through NEAR Intents 1Click: live quotes; a payout needs mainnet |
| Autonomous Business | Autopilot: the owner sets caps, payees and team domains once, and recaps and payments that pass every rule run on their own, with an undo |

## Built on NEAR's newest

| NEAR launch | When | What Aftercall does with it | Code |
| --- | --- | --- | --- |
| **NEAR AI Cloud:** private inference in TEEs | 3 Dec 2025 ([NEAR AI](https://near.ai/blog/introducing-near-ai-cloud-private-chat)) | Whisper and Qwen3.8-27B make the notes; the app checks attestation first ([every check](docs/how-it-works.md)), per [the docs](https://docs.near.ai/cloud/verification) and [reference verifier](https://github.com/nearai/nearai-cloud-verifier) | `packages/core/src/tee/`, `apps/desktop/src-tauri/src/attest.rs` |
| **End-to-end encrypted chat, v2** (Ed25519, XChaCha20-Poly1305) | Documented Mar 2026 ([guide](https://docs.near.ai/cloud/guides/e2ee-chat-completions), [commit](https://github.com/nearai/docs/commit/8a285bf49bf6f502b02cb61d956c5508d4ba292b)) | A fresh key per request; the transcript encrypted to the attested model, or not sent | `packages/core/src/tee/e2ee.ts`, `apps/desktop/src-tauri/src/nearai.rs` |
| **NEAR Intents 1Click API** | SDK 28 Mar 2025 ([npm](https://www.npmjs.com/package/@defuse-protocol/one-click-sdk-typescript)) | Pay USDC on Solana or Base under a cross-chain cap; dry quotes live; a real payout needs mainnet, not yet deployed | `packages/core/src/intents/oneclick.ts`, [docs](docs/near-intents-1click.md) |
| **NEAR Connect 0.12.0** | 26 Oct 2026 ([release](https://github.com/azbang/near-connect/releases/tag/v0.12.0)) | Owner approvals on `/sign` | `apps/web/app/sign/` |
| **near-sdk 5.29** | 13 Jul 2026 ([release](https://github.com/near/near-sdk-rs/releases/tag/near-sdk-v5.29.0)) | The agent-wallet contract | `contracts/agent-wallet` |

Planned, not built: paying for Aftercall's own inference with **Staking for NEAR AI** (announced 30 Jul 2026, [NEAR AI](https://near.ai/blog/staking-for-near-ai)); written up in [docs/staking-for-inference.md](docs/staking-for-inference.md), nothing in the repo signs it.

## What it does

1. **Records the call on your Mac,** from any app. No bot joins.
2. **Makes the notes inside secure hardware:** NEAR AI Cloud's TEEs, checked every run, with the transcript encrypted to the attested model. Items without an exact quote from the call are dropped.
3. **Proves it on NEAR.** A hash of the meeting's proof goes on chain; anyone with the proof link can re-run the checks at `/verify`. The 3 Nov proof's link is public: [docs/proof-3-nov.txt](docs/proof-3-nov.txt). **Share this line** sends one line of a meeting with a Merkle proof that it's in the transcript the proof commits to, and nothing else of the meeting (built and tested, not yet run live).
4. **Does what the meeting decided.** Sends the recap, with a footer saying what was checked, by email or to a Slack channel when you tap Post to Slack (never on autopilot; the webhook stays in your Keychain), and pays agreed USDC after one tap, or by autopilot if you turn it on (listed payees, verified notes, 60-second undo). The contract enforces the caps; over a cap waits for your wallet. A deal with a condition can be held in escrow until the payee confirms the terms from their own NEAR wallet and you release it ([Handshake](docs/handshake.md); on testnet since 7 Nov, not yet run live).
5. **Hands action items to coding agents, when you allow it.** Claude Code or Codex reads the meeting over Aftercall's local MCP server, claims an item, marks it done with a link, and can propose a follow-up that waits for your tap. Agents never send or pay on their own.
6. **Keeps your notes yours, and safe.** Meetings stay on your Mac, sealed. Export backup writes one encrypted file; turn on **Back up automatically to iCloud Drive** and the same file goes there after each meeting and each change to your notes (one a day, the 7 newest kept). Apple gets only the encrypted file, never the key, which comes from your recovery phrase (built and tested, not yet run with real iCloud Drive).

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

## For judges

Guide for people and coding agents: [docs/judging.md](docs/judging.md). The 90-second demo video isn't recorded yet (7 Nov); its [script](docs/demo-script.md) gives a source for every spoken line.

| Claim | Code | Tests |
| --- | --- | --- |
| Nothing is sent unless NEAR AI's TEEs pass attestation; the transcript is encrypted end to end to the attested model | `packages/core/src/tee/`, `packages/core/src/notes/pipeline.ts` | `pipeline.test.ts`, `checks.test.ts`, `e2ee.test.ts` |
| Every reply's signature is checked against the attested key; notes that fail are marked unverified, and autopilot runs nothing from them | `pipeline.ts`, `packages/core/src/followups/autopilot.ts` | `pipeline.test.ts`, `autopilot.test.ts` |
| The model can't propose a follow-up without an exact quote from the call; a payment's amount must be in its quote | `packages/core/src/notes/build.ts`, `transcript.ts` | `build.test.ts`, `transcript.test.ts` |
| The app's key can only pay, record proofs and open or release escrows, within the caps; over a cap waits for the owner's wallet | `contracts/agent-wallet/src/lib.rs` | `contracts/agent-wallet/tests/sandbox.rs` (local NEAR node) |
| An escrow pays only after the payee confirms the exact terms (a salted hash on chain) from their own account; on testnet, not yet run live | `lib.rs`, `packages/core/src/followups/deal.ts`, `apps/web/app/deal/` | `escrow_*` (sandbox), `deal.test.ts` |
| Anyone can re-run a proof's checks in a browser | `apps/web/app/verify/` | `verify.test.ts`, `proof.test.ts` |
| A shared line is checked against the transcript the proof on NEAR commits to; the link reveals no other line (not yet run live) | `packages/core/src/notes/lines.ts`, `disclosure.ts` | `lines.test.ts`, `disclosure.test.ts`, `packages/receipts` tests |
| The backend keeps nothing about a recap; claim links keep only a token hash and an amount | `apps/backend/src/email/`, `apps/backend/src/claims/` | `email.test.ts`, `claims.test.ts` |
| An agent's follow-up waits for your tap: never autopilot, never the phone, payments only to listed payees within your caps | `apps/desktop/src-tauri/src/agents.rs`, `autopilot.ts` | `agents.rs` tests, `autopilot.test.ts`, `apps/mcp/src/tools.test.ts` |
| The phone sees only what approving needs, sealed so the relay can't read it; the Mac re-checks every tap | `packages/core/src/relay/`, `apps/backend/src/relay/` | `messages.test.ts`, `mac.test.ts`, `relay.test.ts` |

Every claim with its exact test names: [docs/proven.md](docs/proven.md).

## Live today

| What | Where | Status (8 Nov 2026) |
| --- | --- | --- |
| Website, browser demo, install guide | https://getaftercall.vercel.app | Live |
| Mac test build | https://getaftercall.vercel.app/download | Live, unsigned, NEAR testnet |
| Backend (sign-in, recap email, claim links, counts) | https://aftercall-api.vercel.app/health | Live, with Postgres |
| Contract | `wallet.aftercall.testnet` | Testnet: 1 wallet, 1 proof, 0 payments. Upgraded in place to Handshake on 7 Nov ([`BQXQAhui…`](https://testnet.nearblocks.io/txns/BQXQAhui6ixc2B7QacSoSyw6MWqUvgkGvyfSUfCzYpoq)), every record kept |
| Notes from a real call on live NEAR AI, proof on NEAR | Mac app | Done 3 Nov (private meeting) |
| Recap email through Aftercall (Resend) | Mac app → backend | Done 6 Nov |
| A payment, and the $5,000 hold, on testnet | Mac app | Not yet |
| The 3 Nov proof's public link | [docs/proof-3-nov.txt](docs/proof-3-nov.txt) | Published 8 Nov; `/verify` passes 7 of 7 |
| 90-second demo video | README | Not yet; [script](docs/demo-script.md) |
| Test credits (a capped NEAR AI key per tester) | Backend | Built and tested; off until Aftercall's NEAR AI account is set up |
| NEAR Intents quote for a payment to Solana or Base | Browser demo, Mac app | Live (dry quote: nothing sent) |
| Coding agents: Connect Claude Code, Hand to an agent, done with a link, proposed follow-ups | Mac app, MCP server | Built and tested. Claude Code ran on the MCP server and a stand-in app on 1 Nov ([recorded](docs/agents-demo.md)), before most of these; not yet with the Mac app. Codex not yet |
| Phone approvals: `/phone`, the relay, Settings → Your phone | Web, backend, Mac app | Deployed 7 Nov; run with a stand-in Mac in a phone-sized browser. Not yet with the Mac app or a real phone |
| Post to Slack (a recap, through an incoming webhook) | Mac app | Built and tested 8 Nov against a local stand-in for Slack; not yet posted to a real workspace |
| Automatic encrypted backup to iCloud Drive | Mac app | Built and tested 8 Nov; not yet run with real iCloud Drive |
| Mainnet: contract, 1Click payout | | Not yet; testnet is eligible (rules, Q-010) |

**Platforms:** macOS 14.2+ (Apple silicon, Intel) now; Windows next (WASAPI loopback in place of the Core Audio tap). Phones can't record another app's call, so a phone handles approvals at `/phone` (paired by QR code in Settings → Your phone), a held payment's wallet approval and a payee's claim link; recording in the room on a phone comes later.

## How it works

The Mac app (Tauri, Rust, React) records the call and seals audio and notes on disk with a key in the Keychain. NEAR AI Cloud makes the notes in checked TEEs. `contracts/agent-wallet` keeps proofs, payees and caps. The web app serves `/verify`, `/sign`, `/claim` and `/phone`; the backend (NestJS, Postgres) keeps nothing about a meeting. Diagram and checks: [docs/how-it-works.md](docs/how-it-works.md).

## Follow-ups: what leaves, who approves, what's kept

A recap goes to your own mail app by default, or through Aftercall's backend if you choose. A payment within your caps puts the payee, amount, a fixed memo and an id on NEAR, never meeting text; over a cap, only your wallet can approve it. Each meeting's proof on NEAR is its start time, a hash and the model name, never the meeting. Row by row: [docs/privacy.md](docs/privacy.md#follow-ups-what-leaves-who-approves-whats-kept).

## NEAR pieces used

Besides [the newest](#built-on-nears-newest):

| Piece | Where |
| --- | --- |
| Function-call access keys (`pay`, `record_proof` only); 1-yocto rule for owner methods | `crates/near-tx`, `contracts/agent-wallet` |
| NEP-141 (Circle USDC): `ft_transfer_call` deposits, payee registration with `storage_deposit` | `contracts/agent-wallet`, `packages/core/src/wallet/actions.ts` |
| NEP-413 sign-in, signed in Rust, verified in TypeScript | `crates/near-tx`, `apps/backend/src/auth` |
| JSON-RPC: views, `send_tx`, access-key checks | `crates/near-tx`, `apps/web/app/verify` |
| One network config for testnet and mainnet (FastNEAR RPC, Circle USDC ids, explorers) | `packages/core/src/network.ts`, `crates/near-tx` |

## More

[judging.md](docs/judging.md) · [proven.md](docs/proven.md) · [how-it-works.md](docs/how-it-works.md) · [privacy.md](docs/privacy.md) · [development.md](docs/development.md) (run every part locally) · [demo-script.md](docs/demo-script.md) · [plan.md](docs/plan.md) · [agents-demo.md](docs/agents-demo.md) · [near-intents-1click.md](docs/near-intents-1click.md) · [staking-for-inference.md](docs/staking-for-inference.md) · [@aftercall/receipts](packages/receipts/README.md) (check proofs and shared lines from code) · designs for the [phone](docs/design/phone.md), its [protocol](docs/design/phone-protocol.md) and [agents](docs/design/agents.md)

## Built with

Disclosed per the hackathon FAQ (Q-005).

- **AI-written code:** most of this repository was written by Claude Code (Anthropic's coding agent) under Victor's direction, from Victor's own plan and design. Commits up to 7 Nov carry a `Co-Authored-By: Claude` line; later ones don't, and were written the same way.
- **Why some days have many commits:** features were often built in parallel by several Claude Code agents, each in its own worktree and branch, then merged, and every change is its own small commit. So 236 commits landed on 7 Nov, when Handshake, line sharing and the receipts SDK were merged, and 72 on 1 Nov. History is as committed: nothing squashed or rewritten.
- **No templates or pre-existing project code.** Planning docs from 24 Oct 2026, code from 26 Oct 2026, all after the event's 19 Oct announcement (FAQ Q-001). The attestation checks follow NEAR's [reference verifier](https://github.com/nearai/nearai-cloud-verifier) and the [NEAR AI Cloud agent skill](https://github.com/near/agent-skills/tree/main/skills/near-ai-cloud); the TDX test fixtures are Phala's sample quote and collateral (MIT), in `apps/desktop/src-tauri/tests/fixtures`.
- **Libraries:** desktop: Tauri 2 (tauri-plugin-notification), React 19, Tailwind CSS 4, motion, lucide-react, uqr; Rust: cidre, cpal, hound, reqwest, keyring, objc2-event-kit, dcap-qvl (Phala), bip39, chacha20poly1305, hkdf, sha2, bs58, zeroize. Core: zod, @noble/curves, @noble/hashes, @noble/ciphers (`pnpm sample:notes` uses @phala/dcap-qvl-node). Backend: NestJS, pg, jose, @scure/base. Web: Next.js, @hot-labs/near-connect. MCP: @modelcontextprotocol/sdk. Contract: near-sdk 5.29, near-workspaces; signer: ed25519-dalek.
- **Tooling and design:** Playwright screenshots (`scripts/screens.mjs`); designed with Claude ([Aftercall Screens](https://claude.ai/artifact/RXNzkVE5TXbVu2ynPKRScW)); fonts Newsreader, Instrument Sans, Geist Mono.

## License

[MIT](LICENSE).
