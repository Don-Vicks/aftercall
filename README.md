# Aftercall

Private meeting notes that do the follow-ups. Built for NEAR HACKATHON (1–14 Nov 2026).

**The problem:** meetings are some of the most sensitive things people say, and every AI note-taker asks you to trust a company with them. Aftercall sends your audio and transcript only to models running in NEAR AI Cloud's secure hardware, checks that hardware's attestation on every run, encrypts the transcript so only the attested model can read it, and keeps nothing on its own servers.

Aftercall records a call on your Mac, transcribes and summarises it inside NEAR AI Cloud's secure hardware (TEEs), and records a proof of that on NEAR that anyone can check. Then it does what the meeting decided: the recap email goes out and the agreed payment is made in USDC on NEAR, after one approval or under autopilot rules you set. A NEAR contract caps what the app can ever pay, so even a hijacked app or a tricked AI can't overspend.

> **Status:** in development for NEAR HACKATHON (tracks: privacy, security, agents). Building started on 26 Oct 2026, after the event was announced on 19 Oct; the official FAQ counts code from the announcement onward ([HACKATHON.md](https://nearhackathon.com/HACKATHON.md), Q-001), so the whole history is hackathon work. The commit history shows the real timeline. What runs against live NEAR AI and NEAR testnet, and what is so far proven only locally, is listed under [What is proven](#what-is-proven).

## Check it in five minutes

| Do | See |
| --- | --- |
| `pnpm install && pnpm verify --quick` | Typecheck of every package, 102 core, 27 backend and 14 MCP server tests (more with `DATABASE_URL` set, adding the Postgres runs), the web build, the NEAR signer, the desktop Rust tests (recorder, encryption at rest, TDX quote verification, recovery) and the contract's unit tests, with a pass/fail summary. `pnpm verify` adds the contract running on a local NEAR node (16 more tests, about 5 minutes; needs `cargo-near` and the `wasm32-unknown-unknown` target). |
| `pnpm dev:ui`, open http://localhost:1420 | The Mac app's interface in a browser on a sample meeting: Today, the ⌘K palette, the meeting with your notes, ticks and approve-with-undo, the transcript as a conversation, People, Ask your meetings (⌘J), Action items, the $5,000 payment the contract blocks. Recording is simulated in the browser: New recording shows the live page, the floating pill, your notes (⌘⇧R) and processing; `/live.html` shows the floating recorder, and `?simulate=silent` the silent-call warning. |
| `pnpm --filter @aftercall/web dev`, open http://localhost:3000 | The landing page, How it works (the journey of one meeting and every check) and Download, plus `/verify`, which re-runs a proof link's checks in your browser. |
| `pnpm sample:notes` (needs `NEAR_AI_API_KEY` in `.env`) | One of the two fictional sample calls in [`samples/`](samples) goes through the real pipeline on NEAR AI Cloud: every attestation check below, Whisper on both stems, the transcript end-to-end encrypted to the attested Qwen TEE, the strict-schema summary and the signature check. It prints the notes (including a 40 USDC deposit to the designer, with its quote) and ✓/✗ for every check, grouped Gateway / Whisper TEE / Qwen TEE / Response. `pnpm sample:notes all` runs both. Without a key it stops before sending anything. |
| In the Mac app: Home → "Open a sample recording", then Make notes | The same sample becomes an ordinary recording labelled Sample, processed with your NEAR AI key; the Verify sheet lists every check. In `pnpm dev:ui` it opens with its script. |
| `pnpm --filter @aftercall/web dev`, open http://localhost:3000/verify | The public Verify page. With a proof link (`/verify#…`, copied from the app's Verify sheet) it reads the proof from NEAR and re-runs every check in your browser. |
| Read [`contracts/agent-wallet/src/lib.rs`](contracts/agent-wallet/src/lib.rs) and [`tests/sandbox.rs`](contracts/agent-wallet/tests/sandbox.rs) | Why the app can't overspend: its key can call only `pay` and `record_proof`, every rule change needs 1 yoctoNEAR (which a limited key can't attach), and over-cap payments park until the owner's own wallet approves. Each claim has a test on a real local NEAR node. |
| Read [`packages/core/src/notes/`](packages/core/src/notes) | The notes pipeline: two audio stems become one transcript, the model's output must match a strict schema, any item without an exact quote from the transcript is dropped, amounts are read from the spoken words (never from the model's number), and the summary's signature must recover to the attested enclave. |

## How it works

```
 Mac app (Tauri)                                  NEAR AI Cloud (TEEs)
 ├─ Core Audio tap + mic → mic/system WAV ───────▶ openai/whisper-large-v3
 ├─ notes pipeline (packages/core) ──────────────▶ Qwen/Qwen3.8-27B (strict JSON schema)
 │    every run: fresh nonce → Intel TDX quote (dcap-qvl) → report data binds key + nonce
 │    → RTMR3 event log, compose hash in mr_config → NVIDIA GPU evidence via NRAS (JWTs checked
 │    against NVIDIA's keys) → response signature from that attested key; gateway TEE too.
 │    Fail closed: nothing is sent unless the gateway and the model TEEs pass.
 │    Transcript encrypted on the Mac to the Qwen TEE's attested key (E2EE v2)
 ├─ audio, transcripts, notes encrypted at rest (XChaCha20-Poly1305, key in Keychain)
 ├─ NEAR AI key in the macOS Keychain; called from Rust, only for Aftercall's own audio
 ├─ app key in the Keychain (limited: pay, record_proof) ──▶ agent-wallet contract on NEAR
 │                                                            ├─ record_proof(meeting, sha256 of proof bundle)
 │                                                            ├─ pay(): listed payee, daily + per-payment caps
 │                                                            └─ over cap → parked for the owner's wallet
 ├─ follow-ups: Draft in Mail · send via backend · pay · claim link · autopilot
 ├─ pay on Solana or Base: 1Click quote → pay(…, cross_chain) to its deposit address, same caps
 ├─ macOS calendar (EventKit, read-only, on this Mac) → meeting names, recap addresses, and what's coming up today
 ├─ recovery phrase → app key (SLIP-10) + encrypted backup of notes and settings
 └─ local MCP server (apps/mcp): agents read meetings, claim and complete action items,
      only through the running app (owner-only socket + token), off by default

 Web (Next.js)                                    Backend (NestJS + Postgres)
 ├─ /verify  re-runs the proof checks in the browser  ├─ sign-in with NEAR (NEP-413); app keys accepted
 ├─ /sign    owner actions signed in any NEAR wallet  ├─ recap email via Resend (consent line required)
 └─ /claim   payee shares where to be paid            └─ single-use claim links (token hash + amount; no names or titles)
```

## NEAR pieces used

| Piece | Where |
| --- | --- |
| NEAR AI Cloud: Confidential TEE models (Whisper, Qwen3.8-27B) through the OpenAI-compatible API; attestation reports verified the way [the verification docs](https://docs.near.ai/cloud/verification) and NEAR's [reference verifier](https://github.com/nearai/nearai-cloud-verifier) describe; response signatures; end-to-end encrypted chat | `packages/core/src/tee/` (checks, NVIDIA, E2EE), `packages/core/src/notes/pipeline.ts`; Rust `apps/desktop/src-tauri/src/attest.rs` (TDX quotes with dcap-qvl, NRAS) and `nearai.rs` |
| A NEAR smart contract (near-sdk 5.29): caps, payees, parked payments, proof registry, per-user storage | `contracts/agent-wallet` |
| Function-call access keys as the app's limited authority; the 1-yocto rule for owner methods | `crates/near-tx`, `contracts/agent-wallet` |
| NEP-141 (Circle USDC): `ft_transfer_call` deposits, payee registration with `storage_deposit` | `contracts/agent-wallet`, `packages/core/src/wallet/actions.ts` |
| NEP-413 sign-in, signed by the app's key in Rust and verified in TypeScript | `crates/near-tx`, `apps/backend/src/auth` |
| NEAR Connect, for owner signatures in any wallet (Meteor, Intear, Ledger, NEAR CLI…) | `apps/web/app/sign` |
| JSON-RPC: views, `send_tx`, access-key checks | `crates/near-tx`, `apps/web/app/verify` |
| NEAR Intents 1Click: quotes and deposit addresses for paying a payee in USDC on Solana or Base | `packages/core/src/intents/oneclick.ts`, `contracts/agent-wallet` (`pay` with `cross_chain`), [docs](docs/near-intents-1click.md) |
| Testnet and mainnet from one network config (FastNEAR RPC, Circle USDC ids, explorers) | `packages/core/src/network.ts`, `crates/near-tx` |

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
| A locked contract (no full-access keys) still serves owners and the app key, and can't be redeployed | `locked_contract_still_serves_owners_and_the_app_key` (sandbox) |
| A cross-chain payment goes to the 1Click deposit address under the same caps and pause, only for payees the owner opted in | `cross_chain_pays_the_deposit_address_within_caps` and the refusal tests (sandbox); the 1Click client against recorded responses (`oneclick.test.ts`) |
| The same recovery phrase always gives the same app key, distinct from the NEAR wallet's own key; backups fail with a wrong phrase or a changed byte | `recovery.rs` tests, with the BIP39 and SLIP-10 test vectors |
| Agents racing for one action item: exactly one claim wins, and no write is lost | `concurrent_claims_of_one_item_have_one_winner` and `writes_change_only_the_one_item_and_stay_encrypted` (`apps/desktop/src-tauri/src/agents.rs`); the MCP tools through the socket client (`apps/mcp/src/tools.test.ts`), plus a real stdio `tools/list` run |
| A genuine Intel TDX quote verifies against Intel's collateral; a changed byte, expired collateral or garbage doesn't | `apps/desktop/src-tauri/tests/tdx_quote.rs` (Phala's sample quote and collateral); live Intel PCS fetch checked |
| Each attestation check catches its own failure: key or nonce not in the report data, wrong compose, broken event log, revoked TCB, debug TD; NVIDIA tokens not signed by NVIDIA, stale nonce, secure boot off | `packages/core/src/tee/checks.test.ts`, `nvidia.test.ts` |
| Nothing leaves the Mac unless the gateway and the model TEEs pass; the transcript is encrypted to the attested model, never falling back to plaintext when a node failed | `pipeline.test.ts`: "nothing leaves the Mac when the gateway or Whisper TEE fails a check", "a failing summary node is avoided by pinning E2EE to a verified one", "no plaintext fallback when E2EE is refused and a summary node failed"; `e2ee.test.ts` (cross-checked against Node's own X25519 and HKDF) |
| Audio never touches the disk unencrypted; notes and transcripts are sealed; any changed byte or wrong key fails | `audio_round_trips_as_a_wav_and_has_no_riff_on_disk`, `any_tampered_byte_fails`, `wrong_key_fails`, `plaintext_files_are_read_then_sealed_by_migration` (`at_rest.rs`) |
| The backend keeps nothing about a recap after sending it, and nothing about a claim beyond a token hash and amount | `email.test.ts`: "a sent recap leaves only counts behind…"; `claims.test.ts` (the live Postgres table has only the allowed columns) |
| `/stats` returns counts only | `apps/backend/src/stats/stats.test.ts` |
| Your notes guide the model but are never evidence: they travel inside the encrypted request, and a payment only in your notes is dropped | `pipeline.test.ts`: "your notes go to the model inside the encrypted request…"; `build.test.ts`: "your notes ride along on the meeting but are never evidence" |
| A salted hash in the proof covers your notes: a change, removal, later addition or missing salt fails "Your notes unchanged since signing"; proofs without notes hash exactly as before | `pipeline.test.ts`, `proof.test.ts` (pinned hash) |
| Your notes never reach a recap or a connected agent | `recap.test.ts`; `your_notes_and_their_salt_never_reach_agents` (`agents.rs`); `apps/mcp/src/tools.test.ts` |
| Ask sends nothing when attestation fails, only end-to-end encrypted excerpts otherwise, and drops quotes that aren't in them | `packages/core/src/ask.test.ts` |
| Delete everything removes only the app's own folder (never through a symlink) and its Keychain items | `wipe.rs` tests |

**Not proven yet:** a run against live NEAR AI (waits on an API key): real attestation reports through the checks above, E2EE accepted by Qwen3.8-27B, and Whisper on the sample voices, the contract on testnet and a wallet-signed change (wait on a testnet account), email through Resend (waits on a key), the silence warning firing live, the mainnet deploy and lock (waits on a mainnet account), a real 1Click payout (1Click is mainnet only), reading a real calendar, a restore in the bundled app, and an agent connected through Claude Code or Codex. Gates 1 and 2 below depend on these.

## Privacy

Meeting audio and text go only to NEAR AI Cloud's Confidential TEE models, and only after their attestation passes. Aftercall's own servers keep nothing about a meeting after a response returns. What each party sees and keeps, with file:line pointers: [docs/privacy.md](docs/privacy.md).

- **Verified every run.** Each recording gets a fresh nonce. The app checks the gateway TEE and every Whisper and Qwen TEE node: Intel's TDX quote, the signing key and nonce in its report data, the boot event log, the software (compose hash), NVIDIA's GPU evidence through NRAS, and the response signature. The Verify sheet lists each check; the public `/verify` page re-checks what a browser can and labels the rest "as recorded by the app".
- **End-to-end encrypted summaries.** The transcript is encrypted on the Mac to the Qwen TEE's attested key, so the gateway relays ciphertext. Audio isn't end-to-end encrypted (NEAR AI doesn't offer it for transcription); it goes over TLS through the attested gateway, and transcriptions aren't signed per response. The app says so.
- **Encrypted on this Mac.** Audio is sealed about once a second while recording, and deleted after transcription; transcripts and notes are sealed with a key in your Keychain. This stops other apps, backup and sync tools from reading them; it doesn't protect a compromised user account.
- **Nothing kept server-side.** Draft in Mail, the default, opens the recap in your own mail app. Send through Aftercall holds it in memory for one request and hands it to Resend, which keeps sent mail under its own policy; the backend keeps a count. Claim links store a token hash and an amount; the payee's name and the meeting title travel in the link's `#fragment`. Payments carry a fixed memo, so no meeting title goes on chain.
- **Agents only when you say so.** Connected agents are off by default and reach meetings through the running app over an owner-only socket with a token.
- **Your notes stay yours.** What you type during a call is sealed in `your-notes.json` beside the recording and goes only to the Qwen TEE, inside the same end-to-end encrypted request as the transcript, marked as context. Evidence for every item must still come from the transcript, so a payment that is only in your notes is dropped. Your notes are never put in a recap and never sent to connected agents. The proof holds only `sha256(salt ‖ notes)`; the salt stays in the encrypted notes file, so the public link can't be used to guess them.
- **Ask your meetings (⌘J).** The question is searched on your Mac first. Only the matching transcript lines go out (at most 8, each cut to 400 characters), end-to-end encrypted to a Qwen TEE whose attestation is checked first. Nothing is sent if no line matches or a check fails. Every answer shows its quotes; a quote that isn't in your meetings is dropped.
- **People** are worked out on the Mac from calendar invites and the notes; lines are credited to someone only from calls where your calendar invited just them. **Privacy and your data** shows where everything lives and lets you delete everything on this Mac.

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

Repo layout: `apps/desktop`, `apps/backend`, `apps/web`, `apps/mcp`, `packages/core`, `packages/tokens` (design tokens as CSS for the web), `contracts/agent-wallet`, `crates/near-tx`, `scripts/`, `docs/` (rules, design source).

Design: [Aftercall Screens](https://claude.ai/artifact/RXNzkVE5TXbVu2ynPKRScW) · [Design system](https://claude.ai/artifact/96RdBedZXsLxdXixzAdk6x) (private links for the team).

## Built with

Disclosed per the hackathon FAQ (Q-005).

- **AI-written code:** most of this repository was written by Claude Code (Anthropic's coding agent) under Victor's direction, from a plan and design he set. Commits carry a `Co-Authored-By: Claude` line.
- **No templates or pre-existing project code.** Everything here was written from 26 Oct 2026. The attestation checks follow NEAR's [reference verifier](https://github.com/nearai/nearai-cloud-verifier) and the [NEAR AI Cloud agent skill](https://github.com/near/agent-skills/tree/main/skills/near-ai-cloud); the TDX test fixtures are Phala's sample quote and collateral (MIT), in `apps/desktop/src-tauri/tests/fixtures`.
- **Libraries:**
  - Desktop: Tauri 2 (with tauri-plugin-notification), React 19, Tailwind CSS 4, motion, lucide-react; Rust: cidre (Core Audio tap), cpal, hound, reqwest, keyring, objc2-event-kit, dcap-qvl (Phala, Intel TDX quote verification), bip39, chacha20poly1305, hkdf, sha2, bs58, zeroize
  - Shared core: zod, @noble/curves, @noble/hashes, @noble/ciphers; `pnpm sample:notes` uses @phala/dcap-qvl-node
  - Backend: NestJS, pg, jose, @scure/base
  - Web: Next.js, @hot-labs/near-connect
  - MCP server: @modelcontextprotocol/sdk
  - Contract: near-sdk 5.29, near-workspaces (tests); signer crate: ed25519-dalek
- **Dev tooling:** Playwright for screenshots of every screen (`scripts/screens.mjs`).
- **Design:** made with Claude in an artifact ([Aftercall Screens](https://claude.ai/artifact/RXNzkVE5TXbVu2ynPKRScW)); fonts Newsreader, Instrument Sans and Geist Mono.

## License

[MIT](LICENSE).

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
- [ ] Meeting names and recap recipients from the macOS calendar. Built (EventKit, matching tested in core); first run against a real calendar still to do
- [x] Projects, cross-meeting action items and local search (⌘K: decisions, action items and transcript lines, on the device)
- [ ] Deploy to mainnet with tiny amounts; remove the contract account's full-access keys. `contracts/scripts/deploy-mainnet.sh` (5 USDC a day, 2 a payment, lock as a confirmed last step) and the locked-contract sandbox test are built; the deploy waits on Victor's mainnet account and go-ahead
- [ ] Staking for Inference funds the team org; counts-only stats endpoint. `/stats` (backend, cached 60 s, from the contract's `get_stats` and Postgres) and the web `/stats` page are built; staking is Victor's step, written up in [docs/staking-for-inference.md](docs/staking-for-inference.md)
- [x] Recovery phrase, restore on a new Mac, settings: 12-word phrase derives the app key; restore in onboarding and Settings; encrypted backup of notes, projects and settings. Not yet run in the bundled app
- [ ] Gate 3: 20 outside users, no mocked screens

### M6 · Day 12 (2026-11-12): Stretch and judges
- [x] Agent context: local MCP server (read tools plus claim and complete action items), Connected agents screen. Not yet connected to a real Claude Code or Codex
- [ ] Pay a payee on Solana or Base through NEAR Intents 1Click under the same caps (tiny mainnet amounts). Built and tested on a local NEAR node; a real payout waits on mainnet. The contract can't check that a deposit address routes to the payee, so it's opt-in per payee and capped ([docs](docs/near-intents-1click.md))
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
