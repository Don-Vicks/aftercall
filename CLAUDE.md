# Aftercall: working rules

## The event

- NEAR HACKATHON, https://nearhackathon.com/ (rules and submission steps: `docs/HACKATHON.md`).
- Build window: 2026-11-01 00:00 UTC to **2026-11-14 23:59 UTC** (00:59 Lagos, 15 Nov). Results 16–18 Nov.
- No product code before 1 Nov 00:00 UTC. Before then, only these docs change.
- Judges include Claude Code and Codex. They read this repo, so every README claim must match the code, and the code must be clean, tested and runnable from a clean checkout.
- Victor posts on X and submits the form. Never post, submit, push a public repo, or sign a mainnet transaction without Victor's explicit OK in chat.

## Scope rule

MVP first. Nothing outside the README's MVP list and the current milestone until every MVP box is ticked. Stretch work (M6) starts only if Gate 3 passed. If a milestone slips, finish it before starting the next: the submission is whatever the last passed gate proved.

## The loop

1. Read `README.md`.
2. Do the first unticked task in the earliest unfinished milestone.
3. Run it (or its tests) and prove it works.
4. Tick it in `README.md`.
5. Commit with a conventional message (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

Stop and ask when a task needs a decision, a new dependency outside the stack, money, an account, or anything signed on mainnet.

## Product rules (from the spec)

- Privacy: meeting audio and text go only to `cloud-api.near.ai`, and only to Confidential TEE models (`openai/whisper-large-v3`, `Qwen/Qwen3.8-27B`, fallback `Qwen/Qwen3.6-35B-A3B-FP8`). Never Claude, GPT, Gemini or DeepSeek models for meeting content. Delete audio after transcription. No voiceprints. Logs hold stage names and timings, never content.
- Verify claims only what is proven. Transcription has no per-response signature on NEAR AI; say so.
- Consent: recording can't start until the consent box is ticked, every time.
- Follow-ups: only recap email and USDC payment. Every proposed item needs an exact quote from the transcript. Payments go only to listed payees, show the heard words next to the parsed amount, and never run under autopilot unless every rule passes.
- Contract: limited key may call only `pay` and `record_proof`; every rule change is 1-yocto; no admin method can move user funds; callbacks are `#[private]`; users pay their own storage.
- Secrets live in env vars and the macOS Keychain, never in the repo.

## Design

Use the Aftercall design system (dark-first warm monochrome): Newsreader for notes, Instrument Sans for the interface, Geist Mono for figures, one accent `verdigris` (`#8dbfa8` dark / `#2d5e4f` light). Status colours only with a word. Screens: https://claude.ai/artifact/RXNzkVE5TXbVu2ynPKRScW. Tokens: https://claude.ai/artifact/96RdBedZXsLxdXixzAdk6x.

## Useful paths

- Pre-event spikes (reference only, not copied before 1 Nov): `~/Developer/projects/aftercall-spike` (capture recorder, NEAR AI test script, agent-wallet contract with 12 passing tests).
- Opportunity record: `~/Developer/projects/opportunity-engine/data/history.jsonl` (`watchlist:near-hackathon-2026`), notes in `data/notes/watchlist-near-hackathon-2026.md`.
