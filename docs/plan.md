# Plan

The build plan, milestone by milestone, and the submission checklist.

## MVP


- [x] Record a real call on macOS (system audio + mic, consent tick) and get a private, signed summary with decisions, action items and evidence quotes. Done on 3 Nov 2026 on live NEAR AI (a private meeting)
- [ ] Record the proof on NEAR and show it on a public Verify page anyone can open without installing. The proof is on NEAR (3 Nov, [record_proof](https://testnet.nearblocks.io/txns/2oawJPTmRiNky6EGzpURh79FRDkFcx4bp1kL76DevZro)); a sample meeting's public link for judges is still to come
- [x] Send the recap email with its footer (what was checked, and the notice you logged), through Aftercall or as a draft in your own Mail app. Sent through Aftercall on 6 Nov 2026
- [ ] Pay a listed payee in USDC under the contract's caps, and block a $5,000 over-cap payment until your wallet approves it
- [ ] Let a new freelancer share where to be paid with a single-use claim link


## Plan


A ticked box means built, with its tests in `pnpm verify`. What has also run live (in the Mac app, on NEAR AI, on testnet) is in each item's note and under [What is proven](proven.md); "not yet run" in a note means exactly that.

### M1 · Day 1 (2026-11-01): Foundations
- [x] Scaffold the pnpm monorepo (apps/desktop, apps/backend, apps/web, packages/core, contracts/agent-wallet) with a hello-world in each
- [x] Desktop interface from the design on sample data: meeting page, follow-ups with "check before you approve", transcript with evidence links, recording panel with the consent tick, processing stages, light and dark
- [x] Tauri app with menu bar item, consent tick and the Core Audio + mic recorder writing 5-minute 16 kHz WAV chunks (about 9.6 MB each, under NEAR AI's 25 MB limit). Checked on a real call: both stems carry sound, saved recordings reload after a restart
- [x] Agent-wallet contract with daily cap, per-payment cap, payee list, pending approvals and proof registry; sandbox tests in CI (51 tests: 31 unit, 20 on a local NEAR node)
- [x] NestJS backend with NEP-413 NEAR login and a JWT session
- [ ] Silence watchdog: warn when system audio or the mic is exact zeros for 30 s, or the mic sends nothing for 10 s; the pill, the live page and a notification say which side. Built and unit-tested; still to see it fire live (record with System Audio Recording turned off, or switch AirPods mid-call)

### M2 · Day 3 (2026-11-03): Private notes
- [x] Transcribe each chunk with Whisper on NEAR AI, passing payee and project names (and a project brief's words to expect) as the prompt. Tested against a fake NEAR AI; ran live once on the designer-kickoff sample (1 Nov)
- [x] Label "You" (mic) and "Others" (system audio) by transcribing the two stems
- [x] Summarise with Qwen3.8-27B into the zod schema (decisions, action items, follow-ups, evidence quotes); drop items whose quote isn't in the transcript. Tested with a fake model; ran live once (1 Nov): the right decisions, action items and the 40 USDC deposit, each with its quote
- [x] Meeting page and transcript view with quote links, on real notes once a recording is processed
- [x] Backend mints a spend-limited NEAR AI key per user: test credits, one capped key per install of the app (`apps/backend/src/nearai/`), offered in onboarding and Settings as "Use test credits". Tested against a stand-in for NEAR AI's cloud-api; off until Aftercall's own NEAR AI account is set up, so not yet run against the real one
- [x] Attestation preflight and response-signature check for the summary call. Signature recovery matches ethers on 20 of 20 messages; all 29 checks passed against live NEAR AI on 1 Nov

### M3 · Day 4 (2026-11-04): Proof anyone can check
- [x] Deploy the contract to testnet as `wallet.aftercall.testnet` (done 2 Nov 2026 with `contracts/scripts/deploy-testnet.sh aftercall.testnet`, redeployed 3 Nov); app adds the limited key (pay, record_proof). Done on 3 Nov: `nov3.testnet` holds the app's key, limited to `pay` and `record_proof` on the contract, and its wallet signed `register` and `set_cap`
- [x] Build the proof bundle, hash it and call `record_proof` (proven on a local NEAR node: recorded, duplicate refused, nothing else allowed)
- [x] Processing screen with live stages, in run order: secure hardware checked, transcribed, notes written, signature checked, audio deleted from this Mac, proof recorded on NEAR
- [x] Verify sheet in the app (5 checks plus "notes unchanged since signing", "what this does not prove" and your edits after signing)
- [x] Public Verify page on the web (`/verify#…`), re-running the checks in the browser against NEAR RPC with no meeting content
- [ ] Gate 1: a real call becomes verified notes with a public proof link. The real call and its proof on NEAR are done (3 Nov); the public link will be a sample meeting's, since that call was private

### M4 · Day 7 (2026-11-07): It does what the meeting decided
- [x] Recap email card: Approve and send (backend + Resend, app footer required, 50 a day per account) or Draft in Mail (opens your own mail app; nothing leaves the Mac). Sending through Resend waits on a Resend key
- [x] Payment card with the "check before you approve" row (heard words vs parsed amount and payee)
- [x] Agent wallet in the app: balance, spent today, caps, payees, pause, deposit and withdraw, read live from the contract; every change is signed in your own NEAR wallet through the web signing page. The page opens real NEAR wallets; a signed change on testnet waits on a testnet account
- [x] Capped payment after one tap; payment states (sending, paid, failed with refund), sent with this Mac's limited key (pay is proven on a local NEAR node)
- [x] Over-cap $5,000 blocked; approve-in-wallet web page (`/sign`, any NEAR wallet via NEAR Connect); app updates when the wallet signs (polls NEAR; first live check waits on a testnet account)
- [x] Claim link: single-use link (7 days), stored in Postgres with only a hash of the token, phone claim page, owner confirms the payee in their wallet. Tested end to end against the backend; emailing the link waits on Resend
- [x] Autopilot rules (team-domain recaps, listed payees within the per-payment cap and today's allowance; with no per-payment cap set, autopilot pays nothing), with a 60-second undo. If Aftercall closes during the undo window, the item doesn't run on the next launch: it waits for your approval and says why
- [ ] Gate 2: the full demo works end to end on testnet. The $5,000 block needs no 5,000 test USDC: a payment over a cap is parked whatever the balance, and the balance is checked when your wallet approves it
- [x] 5 Nov: public rough build and a video reply in the teaser thread to Illia. The unsigned test build went live on 4 Nov (universal, Apple silicon and Intel, from 5 Nov), with the launch video

### M5 · Day 10 (2026-11-10): Real users and trust
- [x] Onboarding v0: welcome, a real 5-second audio check (triggers the macOS prompts), NEAR AI key, first recording; wallet later in Settings
- [ ] Meeting names and recap recipients from the macOS calendar. Built (EventKit, matching tested in core); first run against a real calendar still to do
- [x] Projects, cross-meeting action items and local search (⌘K: decisions, action items and transcript lines, on the device)
- [ ] Deploy to mainnet with tiny amounts; remove the contract account's full-access keys. `contracts/scripts/deploy-mainnet.sh` (5 USDC a day, 2 a payment, lock as a confirmed last step) and the locked-contract sandbox test are built; the deploy waits on Victor's mainnet account and go-ahead
- [ ] Staking for Inference funds the team org; counts-only stats endpoint. `/stats` (backend, cached 60 s, from the contract's `get_stats` and Postgres) and the web `/stats` page are built; staking is Victor's step, written up in [docs/staking-for-inference.md](staking-for-inference.md)
- [x] Pay for your notes by staking NEAR instead of a subscription (the "Private Granola" idea as Illia wrote it, 3 Oct 2026): Settings → NEAR AI gets a "Pay by staking" card that explains Staking for Inference (stake NEAR, keep it, and its rewards become NEAR AI Cloud credits; unstake any time), opens the staking card on cloud.near.ai for your own NEAR AI org, and shows what a meeting costs against those credits. Your key, your org, your stake: Aftercall never holds NEAR or a NEAR AI session. Mainnet only; researched in [docs/staking-for-inference.md](staking-for-inference.md). The card is built (`NearAiSettings.tsx`; the 30-minute estimate is `typicalMeetingCost` in `packages/core/src/cost.ts`, tested); nobody has staked through it yet
- [x] Recovery phrase, restore on a new Mac, settings: 12-word phrase derives the app key; restore in onboarding and Settings; encrypted backup of notes, projects and settings. Not yet run in the bundled app
- [x] Record from the call's own app: global ⌘⇧R, "Call ended?" after 2 quiet minutes on both sides (asks, never stops), processing steps in run order (audio deleted before the proof). The watches and the press gate are unit-tested; none of it has run in the Mac app yet
- [x] Meetings in any language: notes in English, quotes copied and checked in the language spoken; amounts from digits in any language, number words only in English, other currencies and the countries' dollars Aftercall knows never read as USDC. Tested on fixtures; no live run yet
- [x] Real meeting dates (stored as ISO times, written out when shown) and editable action items with Restore original, marked in recaps and on Verify, signed notes untouched. Core and Rust tested; the Tauri edit command not yet run in the Mac app
- [ ] Gate 3: 20 outside users, no mocked screens

### M6 · Day 12 (2026-11-12): Stretch and judges
- [x] Agent context: local MCP server (read tools; claim and complete action items only when you allow it), shipped in the app as one file run with `node`; Coding agents screen with the write switch and recent agent activity. A real Claude Code session was run against the bundled server and its test stand-in for the app ([docs/agents-demo.md](agents-demo.md)); not yet against the Mac app, and not yet with Codex
- [x] Coding agents on a meeting's follow-ups ([docs/design/agents.md](design/agents.md), parts 1 to 4): Hand to an agent and Open in Claude Code on each action item, done with a link to the work (in recaps only when you turn that on), `draft_follow_up` for proposals that wait for your tap, and projects agents can reach. Tested in core, the MCP server and Rust; not yet run in the Mac app with a real Claude Code or Codex session
- [ ] Approvals on a phone, version 1 ([docs/design/phone.md](design/phone.md)): the `/phone` page, the relay in the backend, and Settings → Your phone with a QR code. Built and tested against fakes, and `pnpm dev:phone` shows the page; not deployed yet, not yet run with the Mac app on a real phone, and no push notifications
- [ ] Pay a payee on Solana or Base through NEAR Intents 1Click under the same caps (tiny mainnet amounts). Built and tested on a local NEAR node; a real payout waits on mainnet. The contract can't check that a deposit address routes to the payee, so it's opt-in per payee and under its own cross-chain cap, 0 (off) until the owner sets it ([docs](near-intents-1click.md))
- [x] README for human and AI judges: "do X, see Y" steps, NEAR pieces used, architecture, what is and isn't proven
- [x] One-command verify script (`pnpm verify`) and all tests in CI

### M7 · Day 14 (2026-11-14): Ship
- [ ] Record the 90-second demo video (13 Nov)
- [ ] X post in the teaser thread, saying it was built at NEAR HACKATHON, with the video and live numbers (Victor posts it)
- [ ] Make the repo public and check no secrets are in history (`gitleaks`). The history scan is clean (6 Nov, `gitleaks git -c .gitleaks.toml`; the five hits checked by hand are pinned in `.gitleaksignore`); the repo isn't public yet
- [ ] Victor submits the form by hand before 2026-11-14 23:59 UTC (tracks: privacy, security, agents, business, realworld)


## Submission checklist


- [ ] Public repo whose README claims match the code exactly
- [ ] Demo video, 90 seconds, following the demo script in the build doc
- [ ] Public X post saying the project was built at NEAR HACKATHON, with the video or screenshots
- [ ] Mainnet NEAR payout account ready (created by Victor)
- [ ] Form at https://nearhackathon.com/#apply filled in by Victor; one submission per project, corrected only through https://nearhackathon.com/request-changes
- [x] Contract tests and the verify script pass from a clean checkout (fresh clone on macOS, 6 Nov: all 8 steps, including 20 sandbox tests)
- [x] No secrets in the repo; `.env.example` only (root and `apps/backend`)
