# Kickoff prompt

History: the prompt that started the build on 26 Oct 2026, kept as it was. The paths it names outside this repo are on Victor's Mac.

Paste this into a fresh Claude Code session started in this folder:

> We're building Aftercall for NEAR HACKATHON. Read `CLAUDE.md` and `README.md` first, then `docs/HACKATHON.md` for the rules.
>
> Start M1. Do the first unticked task: scaffold the pnpm monorepo (`apps/desktop` Tauri v2 + React + TypeScript + Tailwind, `apps/backend` NestJS, `apps/web` Next.js, `packages/core` TypeScript, `contracts/agent-wallet` near-sdk 5.29 with cargo-near) with a hello-world in each that builds and runs.
>
> Use `~/Developer/projects/aftercall-spike` as reference for the Core Audio recorder (`capture/`) and the agent-wallet contract and tests (`contract/`), re-implementing them here as M1 tasks; don't copy the spike repo wholesale.
>
> Follow the loop in `CLAUDE.md`: implement, run, tick the task in `README.md`, commit. Stop and give me a 3-line summary after each task. Ask before adding dependencies outside the stack, spending money, or signing anything on mainnet.

## Before you start (Victor)

- [ ] NEAR testnet account created, with testnet USDC from Circle's faucet
- [ ] `NEARAI_API_KEY` from cloud.near.ai (spend limit set) in `.env` (not committed)
- [ ] Resend account and a sending domain or subdomain
- [ ] Decide: solo or with a teammate (decided by 28 Oct; if solo, follow the gates and the cut list in the build doc)
