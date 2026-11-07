# Judging Aftercall

A guide for reviewing this repository, written for people and for coding agents (Claude Code, Codex) alike. Reviewing needs no keys, accounts or Mac: every check below runs from a fresh clone or a browser. If you are an agent, please only read and run commands; nothing here asks you to change files.

## In three lines

- **What it is:** a Mac app for meeting notes. The call is transcribed and summarised inside NEAR AI Cloud's secure hardware (TEEs), checked by attestation on every run, and a proof of that goes on NEAR that anyone can re-check in a browser.
- **What it does next:** the meeting's follow-ups. The recap email, and USDC payments to people the meeting agreed to pay, from a NEAR contract whose caps the app can't get around.
- **Where it stands (7 Nov 2026):** a test build is live for Apple silicon and Intel Macs, on NEAR testnet. It has made notes from a real call on live NEAR AI, recorded the proof on NEAR, and sent a recap. Payments from the app haven't run on testnet yet. The newest parts, more for coding agents and approvals on a phone, are built and tested but haven't run live.

## Checks to run

| # | Run | Expect | Time |
| --- | --- | --- | --- |
| 1 | `pnpm install && pnpm verify --quick` (Node 24, pnpm 10, stable Rust) | A summary of ✓ lines, exit code 0: typecheck, 434 core, 48 backend and 25 MCP tests, the web build, the NEAR signer, the desktop Rust tests (macOS only; on Linux listed as skipped), the contract's unit tests | a few minutes; longer on a machine's first Rust build |
| 2 | `pnpm verify` (adds `cargo-near` and the `wasm32-unknown-unknown` target) | The above plus the contract on a local NEAR node: 20 sandbox tests | about 8 more minutes |
| 3 | Open https://getaftercall.vercel.app/demo | The Mac app's interface on sample meetings: notes with their quotes, the Verify sheet, follow-ups, a $5,000 payment the contract holds for the owner's wallet, and a live NEAR Intents quote for a payment on Solana (Pay Kemi) | 2 minutes |
| 4 | The `curl` commands under [For judges](../README.md#for-judges) | `nov3.testnet` calling `record_proof` on `wallet.aftercall.testnet`, status `SuccessValue`; the contract's counts | 1 minute |
| 5 | Open https://getaftercall.vercel.app/stats | The same counts, read live from the contract and the backend | 1 minute |

`pnpm verify` is `scripts/verify.sh`; CI runs the same steps (`.github/workflows/ci.yml`).

## Claims, code and tests

Each claim names the code that does it and the tests that check it. The full list, with every test name: [proven.md](proven.md).

| Claim | Code | Tests |
| --- | --- | --- |
| Nothing leaves the Mac unless the gateway and model TEEs pass attestation (Intel TDX quote, key and nonce in the report data, NVIDIA GPU evidence through NRAS) | `packages/core/src/tee/checks.ts`, `packages/core/src/tee/nvidia.ts`, `packages/core/src/notes/pipeline.ts` | `checks.test.ts`, `nvidia.test.ts`, `pipeline.test.ts` ("nothing leaves the Mac when…") |
| The transcript is end-to-end encrypted to the attested model's key, or not sent; there is no TLS fallback | `packages/core/src/tee/e2ee.ts`, `pipeline.ts` | `e2ee.test.ts`, `pipeline.test.ts` ("a refusal of the encryption headers stops processing…") |
| Every reply's signature must come from the attested key | `packages/core/src/tee/`, `pipeline.ts` | `verify.test.ts`, `pipeline.test.ts` ("the notes' signature must be the model TEE's own…") |
| The model can't invent a follow-up: an item without an exact quote from the transcript is dropped; amounts come from the spoken words | `packages/core/src/notes/build.ts`, `amounts.ts`, `transcript.ts` | `build.test.ts`, `amounts.test.ts`, `transcript.test.ts` |
| Anyone can re-run a proof's checks in a browser, with no meeting content | `apps/web/app/verify/`, `packages/core/src/notes/proof.ts` | `proof.test.ts`, `verify.test.ts` |
| The app's NEAR key can only call `pay` and `record_proof`; rule changes need 1 yoctoNEAR, which that key can't attach | `contracts/agent-wallet/src/lib.rs`, `crates/near-tx` | `contracts/agent-wallet/tests/sandbox.rs`: `limited_key_cannot_change_rules`, `one_yocto_rule_holds_even_if_key_lists_owner_methods` |
| Payments go only to listed payees within a daily and a per-payment cap; over a cap they wait for the owner's own wallet | `contracts/agent-wallet/src/lib.rs` | `over_cap_is_blocked_then_owner_approves`, `per_payment_cap_parks_big_single_payments` (sandbox) |
| Payments to Solana or Base through NEAR Intents 1Click stay under the same caps and a cross-chain cap that is off until the owner sets it | `packages/core/src/intents/oneclick.ts`, `contracts/agent-wallet/src/lib.rs` | `cross_chain_pays_the_deposit_address_within_caps` (sandbox), `oneclick.test.ts` |
| The backend keeps nothing about a recap; claim links keep a token hash and an amount | `apps/backend/src/email/`, `apps/backend/src/claims/` | `email.test.ts` ("a sent recap leaves only counts behind…"), `claims.test.ts` |
| Coding agents only read until the owner allows more, reach only the projects the owner chose, and never send, pay or change rules | `apps/desktop/src-tauri/src/agents.rs`, `apps/mcp/` | `agents_read_only_by_default_and_are_told_which_switch_to_turn_on`, `agents_reach_only_the_projects_the_user_chose` (`agents.rs`), `apps/mcp/src/tools.test.ts` |
| A follow-up an agent proposes waits for the owner's tap: it never runs on autopilot, never reaches the phone, and pays only a listed payee within the caps | `agents.rs` (`draft`), `packages/core/src/followups/autopilot.ts`, `packages/core/src/relay/messages.ts` | `agents_propose_payments_only_to_listed_payees_within_the_caps` (`agents.rs`); `autopilot.test.ts` ("a follow-up a coding agent proposed never runs by itself, even when every rule passes"); `messages.test.ts` ("only follow-ups that wait on someone become items…") |
| "Done" carries the agent's link as the agent's word: only a plain http or https link is kept, and a recap lists agents' work only when the owner turns that on | `packages/core/src/agents/work.ts`, `packages/core/src/followups/recap.ts`, `agents.rs` | `work.test.ts`; `recap.test.ts` ("with agentWork, items agents finished are listed as the agents' statement, with their links"); `complete_with_a_link_to_the_work_and_only_a_plain_web_link` (`agents.rs`) |
| Handing an item to an agent quotes the meeting's words as data, and Open in Claude Code never puts them in a shell command | `packages/core/src/agents/handoff.ts`, `agents.rs` (`open_in_claude_code`) | `handoff.test.ts` ("the meeting's words are data…"); `open_in_claude_code_passes_the_prompt_as_one_argument_never_as_code` (`agents.rs`) |
| The phone sees only what approving needs, sealed (X25519, XChaCha20-Poly1305) so the relay can't read or forge it; the Mac re-checks every tap and then runs the app's own button | `packages/core/src/relay/`, `apps/backend/src/relay/` | `messages.test.ts` ("fields outside the schema never ride along…"); `mac.test.ts` ("pair, snapshot, tap and act, through a fake relay that holds only hashes and boxes", "an action is refused when the follow-up changed…"); `relay.test.ts` ("nothing readable is stored…"); `crypto.test.ts` ("a key swapped in by someone who saw the QR gives different codes and keys") |

## Tracks

Aftercall is entered in five tracks. What each track asks, and the part of Aftercall that answers it:

| Track | The track asks for | In Aftercall |
| --- | --- | --- |
| Privacy & Private AI | AI that protects sensitive data; TEEs, NEAR AI Cloud | The whole notes pipeline: attestation on every run, end-to-end encryption to the attested model, notes sealed on the Mac, a public proof without content |
| AI Security & Defense | Spending limits, policy engines, sandboxed wallets; function-call keys, TEE attestation | The agent-wallet contract: a function-call key limited to `pay` and `record_proof`, caps, a payee list, parked payments, the 1-yocto rule; quotes required before anything is proposed |
| Agent Economy | Agents that spend and pay, directly or through NEAR Intents | The meeting proposes payments and the app pays them in USDC under autopilot rules; payees on other chains through 1Click; coding agents work action items over MCP |
| Autonomous Business | AI-native operations where humans only set the constraints | Autopilot: the owner sets the caps, payees and team domains once, and recaps and payments that pass every rule run on their own, with an undo |
| Real-World Money | Payments and stablecoin rails a normal company could use tomorrow | Paying a freelancer the amount agreed on a call, in Circle USDC, with a single-use claim link for a new payee to say where to be paid |

## Known limits

- Payments from the Mac app and the over-cap hold haven't run on testnet yet; they're tested on a local NEAR node.
- The proof on testnet is from a private meeting, so its proof link isn't published. A sample meeting's link is still to come.
- Mainnet: no deploy yet, and so no real 1Click payout (1Click has no testnet). Testnet is eligible under the rules (Q-010).
- Test credits (a capped NEAR AI key for each tester) are built and tested against a stand-in for NEAR AI's API, and are off until Aftercall's own NEAR AI account exists.
- The Mac app is an unsigned test build; macOS asks once to open it.
- Audio isn't end-to-end encrypted, because NEAR AI has none for transcription. It goes over TLS pinned to the key the gateway's attestation binds.
- Coding agents: Claude Code was recorded against the MCP server and a stand-in for the app ([agents-demo.md](agents-demo.md)), before Hand to an agent, Open in Claude Code, links, proposals and projects existed. None of those has run with the Mac app and a real Claude Code session yet, and Codex hasn't run at all.
- Approvals on a phone: the relay and the `/phone` page aren't deployed yet, and the Mac app, the relay and a real phone haven't run together; the parts are tested against fakes, and `pnpm dev:phone` shows the page against a stand-in Mac. No push notifications yet: the page checks for news every 10 s while it's open.
- Everything else not yet run live is listed at the end of [proven.md](proven.md).

## How it was built

Building started on 26 Oct 2026, after the event was announced on 19 Oct; the FAQ counts code from the announcement (Q-001). The commit history is the real timeline. Most of the code was written by Claude Code under Victor's direction (README, [Built with](../README.md#built-with)); `CLAUDE.md` holds the working rules those sessions followed, and [kickoff.md](kickoff.md) the prompt that started them.
