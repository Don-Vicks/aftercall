# Aftercall

**Private meeting notes that do the follow-ups.**

A call agrees to pay Kemi $5. Aftercall, a Mac app, turns the call into notes inside NEAR AI Cloud's secure hardware, puts a proof of them on NEAR that anyone can re-check in a browser, and pays Kemi the 5 USDC from a NEAR contract whose limits the app can't get around. The same call also agreed $5,000, over the cap, so the contract held it for the owner's own wallet. That ran from the Mac app on NEAR testnet on 8 Nov.

**[Watch the 1:30 demo](https://x.com/VictorShallang/status/2119529850646020401)** · **[See what has run on NEAR testnet](https://getaftercall.vercel.app/proof)** · **[Try it in your browser](https://getaftercall.vercel.app/demo)** · [Download for Mac](https://getaftercall.vercel.app/download)

[![CI](https://github.com/Don-Vicks/aftercall/actions/workflows/ci.yml/badge.svg)](https://github.com/Don-Vicks/aftercall/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-555)](LICENSE)

<img src="docs/media/testnet-strip.webp" alt="Real footage of the Mac app on NEAR testnet on 8 Nov: Kemi paid 5 USDC from the contract and the same call's $5,000 held for the owner's wallet (OVER_PAYMENT_CAP), next to that call's proof re-checked in a browser at /verify" width="100%">
<sub>The Mac app on NEAR testnet, 8 Nov. One call promised Kemi $5 and $5,000: the 5 USDC was paid, the $5,000 was over the cap and held for the owner's own wallet, and the call's proof re-checks in a browser.</sub>

### What makes it different

- **The transcript goes to the model end-to-end encrypted, after the hardware is checked.** On every run, before anything leaves the Mac, the app verifies NEAR AI's attestation: the Intel TDX quote against Intel's collateral, the NVIDIA GPU evidence through NVIDIA's attestation service, and a fresh nonce bound with the model's key. Then it encrypts the transcript to that attested key, with no TLS fallback; a reply counts only if that key signed it. The audio is the one exception: NEAR AI has no end-to-end encryption for transcription, so it goes over TLS pinned to the attested gateway's key.
- **A proof anyone can re-check, with nothing of the meeting in it.** Only a hash goes on NEAR. Its link opens `/verify`, which re-checks the hash on NEAR, the reply's signature and NVIDIA's token in the browser, and shows the rest as the app recorded it.
- **It does what the call agreed, within limits the app can't change.** Every follow-up must quote the call word for word. Autopilot pays only your own words that name a listed payee and say the amount as money. The app's NEAR key can only pay listed payees within daily and per-payment caps; anything bigger waits for your own wallet.
- **Checked from a clean checkout, with no keys.** `pnpm install && pnpm verify --quick` typechecks every package and runs 572 core tests and the rest of the suite with no keys or accounts; `pnpm check:live` reads every testnet transaction and proof link this README cites back from NEAR, and NEAR AI's attestation with fresh nonces ([how to test](#how-to-test)).

### What has run

- **8 Nov, from the Mac app:** notes from a sample call made in NEAR AI's TEEs, the proof recorded on NEAR, 5 USDC paid to Kemi with the app's limited key, and the same call's $5,000 held by the contract for the owner's wallet.
- **9 Nov, approvals on a phone:** the installed Mac app and a real phone, paired through the deployed relay; items acted on and a recap sent from the phone showed in the Mac app within seconds.
- **12 Nov, the app's after-call code run headless with test accounts:** autopilot paid an in-cap 1 USDC after its 60-second undo window, and 0.50 USDC that waited on a condition stayed in escrow until the payee confirmed the terms from their own account, then was released.
- **12 Nov, the limits:** a payment over the cap was held, then approved from the owner's own account; the app's key couldn't send `withdraw` at all.

Every testnet transaction this README cites, one click each and no wallet needed: **https://getaftercall.vercel.app/proof**. The full table is under [On-chain evidence](#on-chain-evidence); what hasn't run yet is under [Features and status](#features-and-status).

## The problem

Meeting-notes apps send your calls to servers you can't inspect, and they stop at a summary. The recap still has to be written and sent, and the payment agreed on the call still has to be made, by you, later.

## What Aftercall does

1. **Records the call** from any app on your Mac. No bot joins the meeting.
2. **Makes the notes in secure hardware.** Before anything is sent, the app checks NEAR AI Cloud's TEE attestation, then encrypts the transcript end to end to the attested model. (The audio goes to transcription over TLS pinned to the attested gateway's key: NEAR AI has no end-to-end encryption for transcription.) Every note must quote the call; items without an exact quote are dropped.
3. **Proves it on NEAR.** A hash of each meeting's proof is recorded on chain, never the meeting itself. Anyone with the proof link can re-check it in a browser at `/verify`: the hash on NEAR, the reply's signature and NVIDIA's GPU token are checked again there, and the rest are shown as the app recorded them.
4. **Does the follow-ups.** It sends the recap and pays what the call agreed in USDC after one tap, or on autopilot rules you set. The app's key can only pay listed payees within daily and per-payment caps; anything larger waits for your own wallet.

## Why NEAR

- **NEAR AI Cloud** runs the speech and language models (`openai/whisper-large-v3`, `Qwen/Qwen3.8-27B`) inside Intel TDX and NVIDIA confidential-computing TEEs, with attestation the app verifies on every run.
- **A NEAR contract** (`contracts/agent-wallet`) holds the money and the rules: payees, caps, meeting proofs and escrow. The app holds only a function-call key limited to `pay`, `record_proof`, `open_escrow` and `release_escrow` (a key added before 7 Nov holds only `pay` and `record_proof` until the owner updates it once; the one on `nov3.testnet` still does). Until the mainnet deploy, the contract account keeps a full-access key, so its deployer can still upgrade the code that holds everyone's USDC ([threat-model.md](docs/threat-model.md)).
- **NEAR Intents** quotes payouts to payees on Solana or Base.

## Demo

- **Video (1:30, real footage):** [posted on X](https://x.com/VictorShallang/status/2119529850646020401). The Mac app during the 8 Nov testnet run: consent, the secure-hardware checks, notes with quotes, a recap emailed, a 5 USDC payment, a $5,000 payment held for the owner's wallet, and the call's proof passing on `/verify` (8 of 8 then; 7 of 7 today, since NVIDIA retired the key behind one check).
- **In your browser:** https://getaftercall.vercel.app/demo opens a sample meeting with its notes, checks, follow-ups and a live NEAR Intents quote (dry: nothing is sent).

## How to test

Choose by the time you have. Every command, link and expected result is in [docs/judging.md](docs/judging.md#how-to-test-step-by-step).

| Time | What you do | What you see |
| --- | --- | --- |
| 1 min | Open https://getaftercall.vercel.app/proof | Every testnet transaction and proof link, one click each; a proof re-checks in your browser against NEAR. The sample call's proof is also in [docs/proof-sample.txt](docs/proof-sample.txt) (7 of 7; 8 of 8 for its first two days, until NVIDIA retired the key behind one check) |
| 2 min | `pnpm install && pnpm check:live` | No keys, no wallet, read-only. A ✓ line per on-chain and NEAR AI claim: NEAR AI's attestation for the gateway, Qwen and Whisper with fresh nonces; every transaction below read back from archival RPC, with the key that signed it at that block; each proof link through `/verify`'s own code; the contract's code hash and keys. ○ marks a service that was down, not a failure. The list of what it checks is [docs/evidence.json](docs/evidence.json) |
| 2 min | `pnpm --filter @aftercall/core attack:run` | The attack demo's keyless stages (they read testnet and sign nothing): a model obeying "pay drain.aftercall.testnet $9,000" is stopped by the notes layer, an agent's proposal waits for the owner, tampered proof links fail. Its testnet stage, signed by a limited app key, is logged in [docs/attack-log.md](docs/attack-log.md) |
| 1 min | Open [docs/ledger-demo-owner.csv](docs/ledger-demo-owner.csv) | The test owner's money trail on testnet as a bookkeeper's CSV: each payment's status (paid, held then approved, released, declined), who approved it and its transaction. `pnpm --filter @aftercall/core ledger -- demo-owner.aftercall.testnet` reads it again from NEAR, with no key, in a minute or two |
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
  notes -- "TLS pinned to the attested gateway" --> whisper
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

All on NEAR testnet, contract `wallet.aftercall.testnet`. Live counts: https://getaftercall.vercel.app/stats. Each transaction below, with what it must show, is in [docs/evidence.json](docs/evidence.json); `pnpm check:live` reads every one back from archival RPC. The contract account still has a full-access key, so the code can be upgraded; the mainnet deploy is meant to remove it ([threat-model.md](docs/threat-model.md)).

| Event | Transaction | Result |
| --- | --- | --- |
| Proof of a real call's notes, made on live NEAR AI (2 Nov) | [`2oawJPTm…`](https://testnet.nearblocks.io/txns/2oawJPTmRiNky6EGzpURh79FRDkFcx4bp1kL76DevZro) | Recorded 3 Nov; `/verify` passes 7 of 7 ([link](docs/proof-3-nov.txt)) |
| A call promised Kemi $5; the app paid 5 USDC to `kemi-ac.testnet` | [`Eq3rPHqz…`](https://testnet.nearblocks.io/txns/Eq3rPHqzDXoanWV8u1kETAkb3WSD1rTrT7ia4CzMqwXH) | Paid 8 Nov, signed by the app's limited key and linked to the meeting's proof |
| The same call's $5,000, over the 10 USDC per-payment cap | [`B8xV41mT…`](https://testnet.nearblocks.io/txns/B8xV41mTk2VBZoMHGjJSdKH6MgzpfPv51zHoFCfdsttE) | `blocked` (`OVER_PAYMENT_CAP`): parked for the owner's wallet, nothing moved |
| The same run, screen-recorded for the demo video | [`6jK1mauq…`](https://testnet.nearblocks.io/txns/6jK1mauqjVNhhJnmvVuhPiP8DzxCBR9Na9ysoKo6jmKN) (paid), [`6jHzBdiT…`](https://testnet.nearblocks.io/txns/6jHzBdiTCbcgdQ7QbCXySWW1fPEeypik3ZxV7SqXiLou) (held) | That call's proof passes 7 of 7 ([link](docs/proof-payment-call.txt)); 8 of 8 until NVIDIA retired its GPU token key |
| Contract upgraded in place to add Handshake escrow | [`BQXQAhui…`](https://testnet.nearblocks.io/txns/BQXQAhui6ixc2B7QacSoSyw6MWqUvgkGvyfSUfCzYpoq) | 7 Nov, every record kept. Deployed code hash `Cc3mNqSrQeq1Aty91x9iCX521vD55SpJcFA8FEdBgYWm`: `contracts/agent-wallet` is unchanged since commit `2f450e1`, and rebuilding it on the developer's Mac (`cargo near build non-reproducible-wasm`, cargo-near 0.22.0, rustc 1.98.1) gives exactly this hash. That build embeds the build machine's file paths, so on another machine it gives a different hash; a reproducible (Docker) build is the way to let anyone match it |
| Headless proof run (12 Nov): a fictional sample call through NEAR AI's TEEs, 30 of 30 checks; its proof passes 8 of 8 on `/verify`, and keeps the GPU check after NVIDIA retires its token key (about two days later) through an archived copy of the key verified by NVIDIA's certificate chain | [`Af4cs3Pn…`](https://testnet.nearblocks.io/txns/Af4cs3PnouGWKhciSgbHmmE1kgqD1rsggXT4GdtLJZzi) | [docs/proof-run.md](docs/proof-run.md): every step and both links |
| Same run: autopilot paid the in-cap 1 USDC after its 60-second undo window, signed by the limited app key | [`Ay4Yte5e…`](https://testnet.nearblocks.io/txns/Ay4Yte5eqPX5MYg676jfAjiBcCQgnyoXnSG1faFVcPDP) | Test accounts `demo-owner` and `demo-freelancer` (`.aftercall.testnet`) |
| Same run: 0.50 USDC that waits on a condition, held in a Handshake escrow; the payee confirmed the terms from their own account, then it was released | [`AFvFRrFx…`](https://testnet.nearblocks.io/txns/AFvFRrFxu5dNkXEawpWF3RuptPTEjZR9fVqSLxmHZDWi) (open), [`4eEmcyis…`](https://testnet.nearblocks.io/txns/4eEmcyisyppCVkXDN7ikymrQDSLw5oEtoLqXs7trLcLp) (confirmed), [`8d7msRRg…`](https://testnet.nearblocks.io/txns/8d7msRRgDyQfLi1aWNidLwSSGuxVeGBcNc6Vt8qfgJMw) (released) | Confirming different terms first failed on chain with `TERMS_DIFFER` ([`3ZDmriAJ…`](https://testnet.nearblocks.io/txns/3ZDmriAJJey8EZpVo6HDtZkf79WeAAjyyQetEvKDxpJu)); nothing moved |
| A payment over the per-payment cap, held, then approved from the owner's own account (12 Nov, command line) | [`CGqtWddP…`](https://testnet.nearblocks.io/txns/CGqtWddPhTKHMPqPbRRConbC7wSxAo8oSsYzTb5HEdfm) (held), [`6CbYm7qU…`](https://testnet.nearblocks.io/txns/6CbYm7qUaM76WiaPZuycysnXx8Yjq3ChYDVMwTrsAvNN) (approved) | The app key used here (`DFPd…`, deleted after the run) couldn't send `withdraw` at all: "Transaction method name <withdraw> isn't allowed by the access key", so there's no transaction |
| Attack demo (12 Nov): a voice on a fictional call tells the AI to pay drain.aftercall.testnet $9,000; then the app's limited key tries it directly | [`Fd9PnR9r…`](https://testnet.nearblocks.io/txns/Fd9PnR9rnjNradwvuMmSGUkw2XKjreWAoiqNg18dmWdA) (`UNKNOWN_PAYEE`), [`AAvo8Ywm…`](https://testnet.nearblocks.io/txns/AAvo8YwmEf6AJvtoCUtGSs3ZFjf6GjVuhwE23JtdHGTN) (9,000 to the listed payee: `blocked`, `OVER_PAYMENT_CAP`), [`8UjvpB9P…`](https://testnet.nearblocks.io/txns/8UjvpB9PmswuzRtMVwJKbKR3SvmEK4g1SVu8WwUPiQgJ) (declined by the owner) | `withdraw`, `set_cap`, `add_payee` and a NEAR transfer from the same key were refused by NEAR before sending. Every layer: [docs/attack-log.md](docs/attack-log.md) |
| The test owner's whole money trail, read back from testnet as a bookkeeper's CSV | [docs/ledger-demo-owner.csv](docs/ledger-demo-owner.csv) | 12 rows: deposits, payments paid, held then approved or declined, and escrows released, each linking its transaction; rows from the proof runs also link the meeting's proof. Columns: [docs/bookkeeping.md](docs/bookkeeping.md) |

## Features and status

| Feature | Status |
| --- | --- |
| Record from any app, no bot | Live |
| Notes in attested TEEs, transcript end-to-end encrypted, every item quoted | Live (NEAR AI, since 2 Nov) |
| Proof on NEAR, re-checkable at `/verify` | Live |
| Recap email through Aftercall, with a footer saying what was checked | Live (since 6 Nov) |
| Send a recap from any meeting, even when the call didn't ask for one, to an invited person from your calendar | Built and tested (`newRecap`; autopilot never sends it); try it at `/demo`; not yet run in the Mac app |
| USDC payment within caps; over a cap held for the owner's wallet | Live on testnet (8 Nov) |
| CSV for a bookkeeper: each payment's status, who approved it, its transaction and the meeting's proof | Read from testnet for the test owner ([CSV](docs/ledger-demo-owner.csv)). In the Mac app, Agent wallet → Export → Copy as CSV copies it; checked in the browser preview with sample data, not yet in the Mac app |
| Test credits, so judges need no NEAR AI account | Live (up to 30 installs): the backend hands out one shared, spend-capped key (`/nearai/test-credits`, checked 12 Nov) |
| NEAR Intents quote for payees on Solana or Base | Live, dry quote; a payout needs mainnet |
| Autopilot: recaps and payments that pass every rule run on their own, with a 60-second undo | Autopilot's decision (`meetingAutopilotDecision`, the app's own code) paid an in-cap payment on testnet on 12 Nov in the headless proof run, after a 60-second wait in the script; the app's own runner and undo haven't run live |
| Approving a held payment from the owner's wallet at `/sign` | The approval ran on testnet on 12 Nov from the owner's account by command line. The transactions `/sign` builds are unit-tested and their contract path runs on a local NEAR node; the page itself hasn't approved a parked payment in a browser wallet |
| Handshake: escrow until the payee confirms the terms from their own wallet | Ran on testnet on 12 Nov in the headless proof run: the payee confirmed from their own account; not yet through the `/deal` page with a browser wallet |
| Coding agents (Claude Code, Codex) claim and finish action items over a local MCP server; Hand to an agent on every open item | Built and tested. On 12 Nov, Claude Code connected to the installed Mac app's own MCP server and read its meetings and open action items ([screenshot](docs/media/claude-code-mcp-12nov.webp)); claiming and completing an item in the Mac app isn't shown yet. A full claim, fix and complete is [recorded](docs/agents-demo.md) against the server's stand-in app. Coding agents also shows the config for Cursor, Claude Desktop, VS Code and Windsurf (standard MCP; not yet tried in those apps) |
| Approvals from your phone, sealed so the relay can't read them | Live (9 Nov): the installed Mac app and a real phone, through the deployed relay; items acted on and a recap sent from the phone showed in the Mac app within seconds. A payment hasn't been approved from the phone yet; no push notifications |
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

<img src="docs/media/claude-code-mcp-12nov.webp" alt="Claude Code listing the Mac app's recent meetings and open action items through Aftercall's MCP server" width="100%">
<sub>12 Nov: Claude Code 2.1.322 connected to the installed Mac app through Aftercall's MCP server (Coding agents → Connect Claude Code) and asked for recent meetings and open action items. The sample meetings are as Claude Code listed them; rows from private meetings are hidden in this screenshot. Agents only read until you turn on claiming, as its last line says.</sub>

## Claims, code and tests

| Claim | Code | Tests |
| --- | --- | --- |
| Nothing is sent unless NEAR AI's TEEs pass attestation; the transcript is encrypted end to end to the attested model | `packages/core/src/tee/`, `packages/core/src/notes/pipeline.ts` | `pipeline.test.ts`, `checks.test.ts`, `e2ee.test.ts` |
| Every reply's signature is checked against the attested key; notes that fail are marked unverified, and autopilot runs nothing from them | `pipeline.ts`, `packages/core/src/followups/autopilot.ts` | `pipeline.test.ts`, `autopilot.test.ts` |
| The model can't propose a follow-up without an exact quote from the call; a payment's amount must be in its quote. Any number in the quote can match, so autopilot also wants your own words, naming the payee, with the amount said as money | `packages/core/src/notes/build.ts`, `transcript.ts`, `amounts.ts` | `build.test.ts`, `transcript.test.ts` |
| The app's key can only pay, record proofs and open or release escrows, within the caps; over a cap waits for the owner's wallet | `contracts/agent-wallet/src/lib.rs` | `contracts/agent-wallet/tests/sandbox.rs` (local NEAR node) |
| A prompt-injected payment is stopped by the layers together, each attempt by at least one: the notes (quote required, unlisted payee gets no Pay button), the agent (proposals wait for the owner), the contract (payee list and caps) and the proof link | `packages/core/scripts/attack-run.ts`, `packages/core/src/node/attack.ts` | `attack.test.ts`; the run: [docs/attack-log.md](docs/attack-log.md) |
| Every on-chain and NEAR AI attestation claim in this README re-checks with one command and no keys (the backend's claims, such as test credits and recap email, aren't covered) | `packages/core/scripts/check-live.ts`, `packages/core/src/node/checkLive.ts`, `evidence.ts`, [docs/evidence.json](docs/evidence.json) | `checkLive.test.ts`, `evidence.test.ts`, `nearai.test.ts` |
| An escrow pays only after the payee confirms the exact terms (a salted hash on chain) from their own account | `lib.rs`, `packages/core/src/followups/deal.ts`, `apps/web/app/deal/` | `escrow_*` (sandbox), `deal.test.ts` |
| A bookkeeper's CSV takes each payment's status and amount from the contract and its transactions, never from the notes; text that would run as a spreadsheet formula stays plain text | `packages/core/src/wallet/ledger.ts`, `packages/core/src/export.ts` | `ledger.test.ts` (real 12 Nov testnet transactions), `export.test.ts` |
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
| Real-World Money | Pay a freelancer the amount agreed on a call in USDC, under caps a contract enforces, or hold it in escrow until they confirm the terms; a CSV a bookkeeper can read, with each payment's status and transaction ([example](docs/ledger-demo-owner.csv)) |
| AI Security & Defense | A function-call key that can only pay listed payees within daily and per-payment caps; anything bigger waits for the owner's wallet; an attack demo stops every attempt at a prompt-injected $9,000 payment, each by at least one layer and the contract regardless ([docs/attack-log.md](docs/attack-log.md)) |
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
- **No templates or pre-existing project code.** Planning docs from 24 Oct 2026 and code from 26 Oct 2026, after the event's 19 Oct announcement (FAQ Q-001). Before this repo, private spikes on 23–24 Oct, also after the announcement, tried the audio recorder, a NEAR AI call and a first agent-wallet contract; that work was rewritten here. The attestation checks follow NEAR's [reference verifier](https://github.com/nearai/nearai-cloud-verifier) and the [NEAR AI Cloud agent skill](https://github.com/near/agent-skills/tree/main/skills/near-ai-cloud); the TDX test fixtures are Phala's sample quote and collateral (MIT), in `apps/desktop/src-tauri/tests/fixtures`.
- **Libraries:** desktop: Tauri 2 (tauri-plugin-notification), React 19, Tailwind CSS 4, motion, lucide-react, uqr; Rust: cidre, cpal, hound, ringbuf, reqwest, rustls, rustls-webpki, webpki-roots, keyring, objc2-event-kit, dcap-qvl (Phala), bip39, chacha20poly1305, hkdf, sha2, bs58, zeroize, and the Tauri plugins global-shortcut, clipboard-manager, dialog and opener. Core: zod, @noble/curves, @noble/hashes, @noble/ciphers (`pnpm sample:notes` uses @phala/dcap-qvl-node). Backend: NestJS, pg, jose, @scure/base. Web: Next.js, @hot-labs/near-connect, @upstash/redis. MCP: @modelcontextprotocol/sdk. Contract: near-sdk 5.29, near-workspaces; signer: ed25519-dalek. Services: NEAR AI Cloud, NEAR RPC (FastNEAR), the NearBlocks API, Resend (recap email), Upstash Redis, Vercel (hosting) and NEAR Intents 1Click.
- **Tooling and design:** Playwright screenshots (`scripts/screens.mjs`); designed with Claude ([Aftercall Screens](https://claude.ai/artifact/RXNzkVE5TXbVu2ynPKRScW)); fonts Newsreader, Instrument Sans, Geist Mono.

More docs: [judging.md](docs/judging.md) · [proven.md](docs/proven.md) · [demo-script.md](docs/demo-script.md) · [plan.md](docs/plan.md) · designs for the [phone](docs/design/phone.md), its [protocol](docs/design/phone-protocol.md) and [agents](docs/design/agents.md)

## License

[MIT](LICENSE).
