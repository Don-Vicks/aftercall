# Aftercall

Private meeting notes that do the follow-ups. Built for NEAR HACKATHON (1–14 Nov 2026).

**The problem:** meetings are some of the most sensitive things people say, and every AI note-taker asks you to trust a company with them. Aftercall sends your audio and transcript only to models running in NEAR AI Cloud's secure hardware, checks that hardware's attestation on every run, encrypts the transcript so only the attested model can read it, and keeps nothing on its own servers.

Aftercall records a call on your Mac, transcribes and summarises it inside NEAR AI Cloud's secure hardware (TEEs), and records a proof of that on NEAR that anyone can check. Then it does what the meeting decided: the recap email goes out and the agreed payment is made in USDC on NEAR, after one approval or under autopilot rules you set. A NEAR contract caps what the app can ever pay, so even a hijacked app or a tricked AI can't overspend.

> **Status:** in development for NEAR HACKATHON (tracks: privacy, security, agents). Building started on 26 Oct 2026, after the event was announced on 19 Oct; the official FAQ counts code from the announcement onward ([HACKATHON.md](https://nearhackathon.com/HACKATHON.md), Q-001), so the whole history is hackathon work. The commit history shows the real timeline. What runs against live NEAR AI and NEAR testnet, and what is so far proven only locally, is listed under [What is proven](#what-is-proven).

## Check it in five minutes

| Do | See |
| --- | --- |
| `pnpm install && pnpm verify --quick` | Typecheck of every package, 269 core, 28 backend and 20 MCP server tests (more with `DATABASE_URL` set, adding the Postgres runs; the MCP tests build the one-file server first and run it with plain `node`), the web build, the NEAR signer, the desktop Rust tests (recorder with the mic-silent, mic-stopped and "Call ended?" watches, the ⌘⇧R press gate, encryption at rest, agents read-only by default and their activity list, action item edits, TDX quote verification, recovery, the audio sweep) and the contract's unit tests, with a pass/fail summary. `pnpm verify` adds the contract running on a local NEAR node (16 more tests, about 5 minutes; needs `cargo-near` and the `wasm32-unknown-unknown` target). |
| `pnpm dev:ui`, open http://localhost:1420 | The Mac app's interface in a browser on a sample meeting: Today, the ⌘K palette, the meeting with your notes, ticks and approve-with-undo, the transcript as a conversation, People, Ask your meetings (⌘J), Action items (the pencil on a row edits its text, owner or due date; an edited item shows "edited" and offers Restore original), the $5,000 payment the contract blocks, Settings → Connected agents with sample activity. Recording is simulated in the browser: New recording shows the live page, the floating pill, your notes (⌘⇧R) and processing in run order; `/live.html` shows the floating recorder, and `?simulate=silent`, `?simulate=mic-silent`, `?simulate=mic-stopped` and `?simulate=call-ended` show the call and mic warnings and the "Call ended?" prompt 3 s into a recording. |
| `pnpm --filter @aftercall/web dev`, open http://localhost:3000 | The landing page, How it works (the journey of one meeting and every check) and Download, plus `/verify`, which re-runs a proof link's checks in your browser, and `/handling`, How a call is handled: each step a call goes through, what each line of the recap footer means, what isn't proven, and the open NEAR AI issues Aftercall's checks don't close. |
| `pnpm sample:notes` (needs `NEAR_AI_API_KEY` in `.env`) | One of the two fictional sample calls in [`samples/`](samples) goes through the real pipeline on NEAR AI Cloud: every attestation check below, Whisper on both stems, the transcript end-to-end encrypted to the attested Qwen TEE, the strict-schema summary and the signature check. It prints the notes (including a 40 USDC deposit to the designer, with its quote), ✓/✗ for every check, grouped Gateway / Whisper TEE / Qwen TEE / Response, and the estimated cost: typically well under a cent per sample at NEAR AI's prices on 1 Nov 2026, with the summary capped at 12,288 output tokens. `pnpm sample:notes all` runs both and adds a total. It exits 0 when every sample came back verified and 1 otherwise. Without a key it stops before sending anything. |
| In the Mac app: Home → "Open a sample recording", then Make notes | The same sample becomes an ordinary recording labelled Sample, processed with your NEAR AI key; the Verify sheet lists every check. In `pnpm dev:ui` it opens with its script. |
| `pnpm --filter @aftercall/web dev`, open http://localhost:3000/verify | The public Verify page. With a proof link (`/verify#…`, copied from the app's Verify sheet) it reads the proof from NEAR and re-runs every check in your browser. |
| Read [`docs/agents-demo.md`](docs/agents-demo.md), or run `pnpm --filter @aftercall/mcp build && node apps/mcp/scripts/demo.ts` and the `claude` command it prints | Claude Code 2.1.314 on the MCP server the app ships, recorded on 1 Nov 2026: read-only, it lists meetings and doesn't claim; after the switch, it claims an item. The other end of the socket is the server's test stand-in for the app (same protocol and rules, two sample meetings), not the Mac app. |
| Read [`contracts/agent-wallet/src/lib.rs`](contracts/agent-wallet/src/lib.rs) and [`tests/sandbox.rs`](contracts/agent-wallet/tests/sandbox.rs) | Why the app can't overspend: its key can call only `pay` and `record_proof`, every rule change needs 1 yoctoNEAR (which a limited key can't attach), and over-cap payments park until the owner's own wallet approves. Each claim has a test on a real local NEAR node. |
| Read [`packages/core/src/notes/`](packages/core/src/notes) | The notes pipeline: two audio stems become one transcript, the model's output must match a strict schema, any item without an exact quote from the transcript is dropped (listed on the meeting page under "N items dropped", never acted on, and counted in the proof), amounts are read from the spoken words (never from the model's number) and kept only when the same value is in the quote, and the summary's signature must recover to the attested enclave. Meetings can be in any language: the notes are written in English and every quote is copied in the language spoken, then checked against the transcript the same way. |

## How it works

```
 Mac app (Tauri)                                  NEAR AI Cloud (TEEs)
 ├─ Core Audio tap + mic → mic/system WAV ───────▶ openai/whisper-large-v3
 ├─ notes pipeline (packages/core) ──────────────▶ Qwen/Qwen3.8-27B (strict JSON schema)
 │    every run: fresh nonce → Intel TDX quote (dcap-qvl) → report data binds key + nonce
 │    → RTMR3 event log, compose hash in mr_config → NVIDIA GPU evidence via NRAS (JWTs checked
 │    against NVIDIA's keys) → response signature from that attested key; gateway TEE too.
 │    Fail closed: nothing is sent unless the gateway and the model TEEs pass.
 │    Transcript encrypted on the Mac to the Qwen TEE's attested key (E2EE v2), or not sent
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
 └─ local MCP server (apps/mcp, shipped in the app as one file, run with node): agents read
      meetings; claim and complete action items only if you turn that on. Only through the
      running app (owner-only socket + token), off by default; a sealed activity list on the Mac

 Web (Next.js)                                    Backend (NestJS + Postgres)
 ├─ /verify  re-runs the proof checks in the browser  ├─ sign-in with NEAR (NEP-413); app keys accepted
 ├─ /sign    owner actions signed in any NEAR wallet  ├─ recap email via Resend (app footer required)
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
| Autopilot never runs a follow-up after a restart: one queued when Aftercall closed is held for your approval, says why, and fails every autopilot rule from then on; items queued since launch keep their countdown, and notes.json keeps the hold | `autopilot.test.ts`: "a queued follow-up read from disk at launch is held for you, never run"; `follow_ups_are_saved_as_the_app_sent_them_and_ticks_keep_them` (`notes_file.rs`) (the app's save of a new meeting's countdown to notes.json was only typechecked) |
| The model can't invent a follow-up: anything without an exact transcript quote is dropped | `packages/core/src/notes/build.test.ts`, `pipeline.test.ts` |
| A quote must match whole words: "50 per user" isn't found in "$1.50 per user" | `transcript.test.ts`: "a quote must start and end on whole words…"; `build.test.ts`: "a quote that starts or ends inside a number isn't in the transcript" |
| Quotes work in any language: matched after Unicode NFKC and case folding, accents still count; in Chinese, Japanese, Thai, Lao, Khmer and Myanmar (no spaces) any letter is a word edge, never before a combining mark; a quote needs 3 words, or 6 letters in those scripts | `transcript.test.ts`: "English quotes match exactly as before", "Japanese, written without spaces…", "Chinese and Thai: any letter is a word edge…", "full-width letters and digits match their plain forms…", "Russian and Arabic…", "Hindi…", "French and Spanish: accents count, case doesn't"; `build.test.ts`: "a Japanese meeting keeps its notes…", "Hindi, French and Spanish meetings keep quotes…"; `ask.test.ts`: "checkAnswer keeps quotes copied in the excerpt's language and drops translations" |
| Amounts in other languages: digits 0-9 and full-width digits are read in any language; number words only in English; a number beside a word in another script is US dollars only when that word is a dollar word Aftercall knows and no country follows it; other currencies are named, other digit sets give no amount. A country written in Latin script that isn't on Aftercall's list (it knows Canadian, Australian, Singapore, Hong Kong, New Zealand, Taiwan and Jamaica) can still be missed | `amounts.test.ts`: "number words are read in English only…", "digits with a dollar word in another language are dollars; other currencies are named", "amountsIn reads digits in a quote in any language, but not beside a currency it can't name as dollars", "a country named after the dollar word makes it another country's dollar", "digits other than 0-9 give no amount"; `build.test.ts`: "Russian and Arabic meetings…" |
| A payment keeps its amount only when the same value is in its quote; a value the quote gives in another currency or as a percentage doesn't count, and "one fifty" is never fifty | `build.test.ts`: "an amount that isn't in the quote is dropped to null…", "partial-span trap…", "a value the quote gives in another currency or as a percentage is not a dollar amount", "one fifty is not fifty…"; `amounts.test.ts`: "amountsIn stops at commas and full stops…", "amountsIn skips values in another currency or given as a percentage" |
| "Fifty cents" is 0.50, not 50.00; naira and every other currency are refused, never read as USDC | `amounts.test.ts`: "cents are hundredths of a dollar, never whole dollars", "any other currency is refused, never read as USDC"; `build.test.ts`: "naira is not USDC…" |
| How many proposed items were dropped, and the notice you logged, are in the proof and covered by its hash; proofs without them hash exactly as before | `pipeline.test.ts`: "the proof records how many proposed items were dropped…", "a logged notice goes into the proof as your statement…"; `proof.test.ts`: "old proofs without dropped or notice hash exactly as before" (pinned hash) |
| Every notes and Ask call is capped (12,288 and 6,144 output tokens); a reply cut off at the cap is never parsed, saved or shown | `pipeline.test.ts`: "every summary request is capped at SUMMARY_MAX_TOKENS…", "a reply cut off at the cap stops processing in plain words…"; `ask.test.ts`: "Ask is capped at ASK_MAX_TOKENS…", "an answer cut off at the cap isn't shown" |
| The cost estimate comes from the tokens and Whisper seconds NEAR AI reports times its price list; without reported usage it says unknown, never a made-up figure | `cost.test.ts`; `pipeline.test.ts`: "the cost estimate…", "cached chunks were paid for earlier and aren't counted again" |
| The recap footer says only what the app knows, and the backend accepts what the app builds | `recap.test.ts`: "the footer claims only what the app can check"; `email.test.ts`: "a recap built by the app is accepted…" |
| A tampered response, an unattested signer or a changed note fails verification | `verify.test.ts`, `proof.test.ts`; signature recovery matches ethers on 20 of 20 messages |
| A failed summary doesn't pay to transcribe the same audio again | `pipeline.test.ts` (transcript cache) |
| Recording captures both sides of a real call | Checked on a real call on macOS (both stems carry sound) |
| Your mic warns like the call: exact zeros for 30 s, or no audio at all for 10 s (the mic stream stopped), and the warning clears when audio returns; the system stem never counts as stopped; the watches wait while paused | `the_mic_stopping_warns_after_ten_seconds_without_audio_and_clears_when_audio_returns`, `the_mic_stem_reports_zeros_and_stopping_and_the_system_stem_never_stalls` (`recorder.rs`) |
| "Call ended?" asks only after both sides stay under about -46 dBFS (RMS over each second) for 2 minutes, only while the call side can be heard (never with system audio missing or only zeros), asks again only after sound returns and 2 more quiet minutes pass, and never stops the recording | `two_quiet_minutes_ask_once_and_ask_again_only_after_sound_returns`, `a_noisy_room_never_counts_as_quiet`, `a_call_side_that_cant_be_heard_never_counts_as_quiet`, `the_quiet_window_is_the_rms_of_what_was_kept` (`recorder.rs`) |
| One ⌘⇧R press is one action, even when the menu bar item and the global shortcut both see it | `one_press_of_the_shortcut_is_one_action` (`lib.rs`) |
| Claim links work once, even when answered twice at the same moment | `claims.test.ts`, run against Postgres |
| A locked contract (no full-access keys) still serves owners and the app key, and can't be redeployed | `locked_contract_still_serves_owners_and_the_app_key` (sandbox) |
| A cross-chain payment goes to the 1Click deposit address under the same caps and pause, only for payees the owner opted in | `cross_chain_pays_the_deposit_address_within_caps` and the refusal tests (sandbox); the 1Click client against recorded responses (`oneclick.test.ts`) |
| The same recovery phrase always gives the same app key, distinct from the NEAR wallet's own key; backups fail with a wrong phrase or a changed byte | `recovery.rs` tests, with the BIP39 and SLIP-10 test vectors |
| Agents racing for one action item: exactly one claim wins, and no write is lost | `concurrent_claims_of_one_item_have_one_winner` and `writes_change_only_the_one_item_and_stay_encrypted` (`apps/desktop/src-tauri/src/agents.rs`); the MCP tools through the socket client (`apps/mcp/src/tools.test.ts`), plus a real stdio `tools/list` run |
| Agents only read until you turn on "Let agents claim and complete action items": claim and complete are refused with a message naming that switch, nothing changes, the switch applies to the next request, settings saved before the switch existed read as off, and turning agents off ends connections still open | `agents_read_only_by_default_and_are_told_which_switch_to_turn_on`, `settings_from_before_the_switch_read_as_read_only`, `the_socket_is_owner_only_needs_the_token_and_goes_away_when_stopped`, `turning_agents_off_ends_connections_that_are_still_open` (`agents.rs`); `tools.test.ts`: "read-only by default: reads work, claim and complete are refused by name, nothing changes"; `stdio.test.ts` (refused, then allowed, through the MCP server) |
| The agent activity list holds each read, claim and completion and every refused request, with times, names and ids only, never meeting content; it is sealed and keeps the newest 200 | `the_activity_list_holds_ids_and_names_never_meeting_content`, `the_activity_list_keeps_the_newest_200` (`agents.rs`) |
| The MCP server the app ships is one file that runs with plain `node`, away from `node_modules` | `stdio.test.ts`: "the bundled server runs on its own with plain node" |
| A real Claude Code session reads meetings while agents are read-only, and claims an item once allowed | [docs/agents-demo.md](docs/agents-demo.md): recorded on 1 Nov 2026 against the bundled server and its test stand-in for the app's socket, not the Mac app |
| A genuine Intel TDX quote verifies against Intel's collateral; a changed byte, expired collateral or garbage doesn't | `apps/desktop/src-tauri/tests/tdx_quote.rs` (Phala's sample quote and collateral); live Intel PCS fetch checked |
| Each attestation check catches its own failure: key or nonce not in the report data, wrong compose, broken event log, revoked TCB, debug TD; NVIDIA tokens not signed by NVIDIA, stale nonce, secure boot off | `packages/core/src/tee/checks.test.ts`, `nvidia.test.ts` |
| Nothing leaves the Mac unless the gateway and the model TEEs pass and a verified summary node offers an attested key to encrypt to; the transcript is only ever sent encrypted to that model | `pipeline.test.ts`: "nothing leaves the Mac when the gateway or Whisper TEE fails a check", "nothing leaves the Mac when no verified summary node offers a key for end-to-end encryption", "a failing summary node is avoided by pinning E2EE to a verified one"; `e2ee.test.ts` (cross-checked against Node's own X25519 and HKDF) |
| The transcript never goes over TLS instead: a 400 refusing the encryption headers, like any other 4xx on the encrypted request, stops processing with nothing sent again; NEAR AI's 421 for a model key it no longer serves (as its gateway words it in the cloud-api source) leads to a fresh attestation and one more encrypted try; key, credit and rate errors keep their own message. Older proofs whose transcript went over TLS still pass every other check; only the E2EE line fails. The Mac app's Verify sheet leaves that line out of its verdict; the public /verify page counts it, so it says such a proof doesn't fully check out | `pipeline.test.ts`: "a refusal of the encryption headers stops processing; the transcript never goes over TLS instead", "any 4xx on the encrypted request stops with nothing resent", "a stale-key 421 attests again and retries encrypted to a key from the new quotes, never over TLS instead", "a stale-key 421 stops with nothing sent over TLS instead when the retry or the fresh attestation fails", "key, credit and rate errors on the encrypted request keep their own message and resend nothing"; `errors.test.ts`: "e2eeStaleKey: only the 421 that asks for a fresh attestation"; `proof.test.ts`: "an older proof whose transcript went over TLS still passes every other check, with only the E2EE line failing" |
| Audio never touches the disk unencrypted; notes and transcripts are sealed; any changed byte or wrong key fails | `audio_round_trips_as_a_wav_and_has_no_riff_on_disk`, `any_tampered_byte_fails`, `wrong_key_fails`, `plaintext_files_are_read_then_sealed_by_migration` (`at_rest.rs`) |
| Audio left beside saved notes is deleted at launch; a recording without notes keeps its audio | `audio_left_beside_saved_notes_is_swept_and_unprocessed_audio_stays` (`lib.rs`) |
| The backend keeps nothing about a recap after sending it, and nothing about a claim beyond a token hash and amount | `email.test.ts`: "a sent recap leaves only counts behind…"; `claims.test.ts` (the live Postgres table has only the allowed columns) |
| `/stats` returns counts only | `apps/backend/src/stats/stats.test.ts` |
| Your notes guide the model but are never evidence: they travel inside the encrypted request, and a payment only in your notes is dropped | `pipeline.test.ts`: "your notes go to the model inside the encrypted request…"; `build.test.ts`: "your notes ride along on the meeting but are never evidence" |
| A salted hash in the proof covers your notes: a change, removal, later addition or missing salt fails "Your notes unchanged since signing"; proofs without notes hash exactly as before | `pipeline.test.ts`, `proof.test.ts` (pinned hash) |
| Make notes uses the notes you last typed on the recording's page, saved to `your-notes.json` first; a waiting edit isn't lost, an older save never lands last, and a failed save sends nothing | `yourNotesDrafts.test.ts`: "Make notes right after typing gets the latest text, saved first, not the stale one", "saves run one at a time…", "a save that fails stops the run, and the next try saves again" (the Tauri path in the Mac app was only typechecked) |
| Your notes never reach a recap or a connected agent; nor do the proof's notice or the cost estimate | `recap.test.ts`; `your_notes_and_their_salt_never_reach_agents` (`agents.rs`); `apps/mcp/src/tools.test.ts` |
| Editing an action item changes only the meeting's copy, never the signed notes or the proof hash; it records which fields differ from the signed item, editing back clears the mark, Restore original brings back the signed item and keeps ticks and agent claims, and saving unchanged is no edit | `edits.test.ts`; `edit_changes_the_meeting_item_never_the_signed_notes_and_restore_puts_it_back`, `saving_unchanged_is_no_edit_when_the_model_gave_an_empty_owner_or_spaces`, `whole_file_saves_keep_edits_of_the_same_signed_notes_only` (`notes_file.rs`) |
| Edits, ticks and agent claims don't overwrite each other, one after another or from 3 threads at once | `edits_ticks_and_agent_claims_interleaved_keep_each_other` (`agents.rs`) |
| Edited items reach search, People, Action items, recaps and agents; a recap marks each open edited item "(edited by the sender)" and its footer says Aftercall didn't check those changes; no edit makes anything payable | `edits.test.ts`: "everything that reads action items gets the edited version; no edit makes anything payable"; `recap.test.ts`: "action items the sender edited are marked…"; `tools.test.ts`: "get_meeting: action items as you edited them, marked as edited" |
| Meeting dates are real times: "Today 14:02", "Yesterday 09:30", a weekday within the last week, then the date; a stale "Today HH:MM" saved by older versions is replaced by the time in the recording id; agents get ISO times | `when.test.ts`: "meetingLabel: today, yesterday, a weekday within the last week, then the date", "meetingLabel ignores the stale 'Today HH:MM'…"; `tools.test.ts`: "list_meetings and get_meeting: the start as an ISO time…" |
| Ask sends nothing when attestation fails, only end-to-end encrypted excerpts otherwise, and drops quotes that aren't in them | `packages/core/src/ask.test.ts` |
| An export says what the meeting page shows and no more: your notes and the transcript only when you ask, no email addresses (someone the calendar has no name for is counted, as "1 other"), NEAR accounts or transaction ids, dismissed follow-ups left out, edited items marked "(edited by you)"; text from the model, the transcript or you can't turn into Markdown formatting, link syntax or HTML (a bare web address stays as written, so the app you paste into may still link it); samples are labelled, and the made-up one doesn't claim to be verified | `export.test.ts`: "the export leaves out other people's addresses…", "someone the calendar has no name for is counted, never shown by their email", "your notes and the transcript are left out unless you ask for them", "edited action items are marked…", "verification says what the app knows…", "samples are labelled…", "Markdown in model, transcript and your text is escaped…" |
| Delete everything removes only the app's own folder (never through a symlink) and its Keychain items | `wipe.rs` tests |
| NEAR AI errors about the key, credit or rate limit are said plainly; a 5xx that mentions credit isn't called a credit problem | `packages/core/src/errors.test.ts` |

**Run live once:** on 1 Nov 2026 the Mac app made notes from the designer-kickoff sample on live NEAR AI Cloud. All 29 checks passed (one node per model, so 24 before sending and 5 on the reply): the gateway, Whisper and Qwen3.8-27B TEEs (Intel TDX quotes, debug off, key and nonce in the report data, NVIDIA GPU evidence) and the Ed25519 signature over the exact request and response. Qwen3.8-27B accepted the transcript end-to-end encrypted to its attested key, and Whisper transcribed both sample voices. That run used the build from earlier that day, before the token caps and the cost line, and its proof isn't on NEAR (no testnet contract yet), so it can't be re-checked from outside; the run that records a replay for judges is still to do. The notes it made copied the transcript's YOU label into the text, which the prompt now prevents (`pipeline.test.ts`).

**Not proven yet:** the contract on testnet and a wallet-signed change (wait on a testnet account), email through Resend (waits on a key), the mainnet deploy and lock (waits on a mainnet account), a real 1Click payout (1Click is mainnet only), reading a real calendar, a restore in the bundled app, the notice going from the record sheet through `meeting.json` into a real proof (the Rust side is unit-tested; the Tauri command path hasn't run), and a cost estimate from a real run. Gates 1 and 2 below depend on these. From the latest changes, these have not run in the real Mac app: the global ⌘⇧R pressed in another app, the call and mic warnings and "Call ended?" firing on a real call (a real mic stopping when AirPods switch or a mic is unplugged, and the -46 dBFS quiet threshold against real calls; only the watch logic is tested), their macOS notifications, the app finding its bundled MCP server at run time (a release `tauri build` does put it at `Aftercall.app/Contents/Resources/mcp/aftercall-mcp.mjs`), an agent connected to the Mac app itself (Claude Code was run against the MCP server and its test stand-in, [docs/agents-demo.md](docs/agents-demo.md); Codex not at all), the bundle on Node 20 (run on Node 22 and 24), Export's Print or save as PDF through Tauri's print command and the macOS print panel (the printable page was checked only in a browser, in print mode), and the Tauri commands behind action item edits, the agent switches and the activity list (the Verify sheet's "Your edits after signing" row was only typechecked). Quotes in other languages are tested on fixtures; whether Qwen follows the language rules in its prompt, and what Whisper returns for non-English speech, waits on a live run.

## Privacy

Meeting audio and text go only to NEAR AI Cloud's Confidential TEE models, and only after their attestation passes. Aftercall's own servers keep nothing about a meeting after a response returns. What each party sees and keeps, with file:line pointers: [docs/privacy.md](docs/privacy.md).

- **Verified every run.** Each recording gets a fresh nonce. The app checks the gateway TEE and every Whisper and Qwen TEE node: Intel's TDX quote, the signing key and nonce in its report data, the boot event log, the software (compose hash), NVIDIA's GPU evidence through NRAS, and the response signature. The Verify sheet lists each check; the public `/verify` page re-checks what a browser can and labels the rest "as recorded by the app".
- **End-to-end encrypted summaries.** The transcript is encrypted on the Mac to the Qwen TEE's attested key, so the gateway relays ciphertext. It is always end-to-end encrypted, or not sent: if no verified Qwen node offers an attested key, nothing leaves the Mac, audio included, and if NEAR AI turns down the encrypted request, processing stops and the transcript isn't sent again, over TLS or otherwise. When NEAR AI no longer serves the attested model key, the app checks the hardware again and retries encrypted once to a key from the new quotes; if that fails, it stops. Proofs from earlier versions, which could send the transcript over TLS, still say so. Audio isn't end-to-end encrypted (NEAR AI doesn't offer it for transcription); it goes over TLS through the attested gateway, and transcriptions aren't signed per response. The app says so.
- **Encrypted on this Mac.** Audio is sealed about once a second while recording, and deleted right after the notes are saved (if the app quits first or the delete fails, it goes the next time the app opens); transcripts and notes are sealed with a key in your Keychain. This stops other apps, backup and sync tools from reading them; it doesn't protect a compromised user account.
- **Nothing kept server-side.** Draft in Mail, the default, opens the recap in your own mail app. Send through Aftercall holds it in memory for one request and hands it to Resend, which keeps sent mail under its own policy; the backend keeps a count. Claim links store a token hash and an amount; the payee's name and the meeting title travel in the link's `#fragment`. Payments carry a fixed memo, so no meeting title goes on chain.
- **The notice is your statement.** Recording asks you to tick "I've told everyone on the call" every time. The app keeps the time you ticked it, and how you told them if you say (said it, in chat, in the invite), with the recording; it goes into the meeting's proof, so the proof hash covers it. Aftercall can't check it, and the Verify sheet and `/verify` show it as your statement, not as a check. Proofs made before the notice was kept say so rather than "no notice". Connected agents don't get it.
- **The recap footer says only what the app knows:** whether every secure-hardware check passed, that the transcript was end-to-end encrypted (or, for a meeting made by an earlier version, that it went over TLS), how many of the open action items in the recap you changed after the notes were made and that Aftercall didn't check those changes (if there are any), that the audio is deleted once the notes are saved, the notice line if you logged one, and a link to the proof (or to `/handling`). It doesn't say that everyone agreed or what NEAR AI keeps; NEAR AI's own policy sets that, and the Verify page lists it under what isn't proven.
- **Estimated cost, never a bill.** Each run's cost is estimated from the tokens and Whisper seconds NEAR AI reports and its public prices on 1 Nov 2026, shown as "about $0.0042" style and always as estimated. It's kept in `notes.json`, not in the proof. Settings adds up the notes saved on this Mac (runs that failed and Ask aren't counted); Ask shows each answer's estimate. If NEAR AI doesn't report the tokens, the app says so instead of guessing.
- **Agents only when you say so.** Connected agents are off by default and reach meetings through the running app over an owner-only socket with a token. They only read until you also turn on "Let agents claim and complete action items", which is off by default and goes back off whenever you turn agents off; they never send, pay or change your rules. "Recent agent activity" lists each read, claim and completion, and every refused request, from a sealed `agents-activity.json` on the Mac (times, the name each agent gives itself, which request, meeting and item ids; never meeting content; newest 200). The MCP server ships inside the app and runs with your own `node` (20 or later).
- **Your edits are marked, the signed notes stay.** Editing an action item's text, owner or due date changes the meeting's copy in `notes.json`, sealed like the rest; the model's signed notes and the proof hash don't change, so "Notes unchanged since signing" still passes. The item shows "edited", Restore original puts back what the model signed, the Verify sheet lists "Your edits after signing" (or None), and a recap marks each open edited item "(edited by the sender)" with a footer line saying Aftercall didn't check those changes. Agents see edited items with an `edited` field.
- **Warnings say which side, nothing more.** The recorder measures each side's loudness on the Mac to warn when your mic or the call goes silent and to ask "Call ended?". These levels aren't saved; a macOS notification (only when Aftercall isn't the focused window) says which side went silent and that recording goes on.
- **Your notes stay yours.** What you type during a call is sealed in `your-notes.json` beside the recording and goes only to the Qwen TEE, inside the same end-to-end encrypted request as the transcript, marked as context. Evidence for every item must still come from the transcript, so a payment that is only in your notes is dropped. Your notes are never put in a recap and never sent to connected agents. The proof holds only `sha256(salt ‖ notes)`; the salt stays in the encrypted notes file, so the public link can't be used to guess them.
- **Ask your meetings (⌘J).** The question is searched on your Mac first. Only the matching transcript lines go out (at most 8, each cut to 400 characters), end-to-end encrypted to a Qwen TEE whose attestation is checked first. Nothing is sent if no line matches or a check fails. Every answer shows its quotes; a quote that isn't in your meetings is dropped.
- **Exports leave Aftercall's protection.** Export on a meeting copies it as Markdown or prints it (macOS can save the print as a PDF). The copy and the PDF aren't encrypted, Delete everything can't remove them, and copying puts the text on your clipboard; the menu says so. Your notes and the transcript go in only when you tick them; email addresses, NEAR accounts, transaction ids and proof details never do.
- **People** are worked out on the Mac from calendar invites and the notes; lines are credited to someone only from calls where your calendar invited just them. **Privacy and your data** shows where everything lives and lets you delete everything on this Mac.

## Run it

Needs Node 24, pnpm 10, Rust stable. Postgres for claim links (`DATABASE_URL`; kept in memory otherwise).

```bash
pnpm install
./scripts/dev.sh   # backend (Postgres), web pages and the Mac app together
pnpm dev:ui        # the interface in a browser at http://localhost:1420
pnpm verify        # every check
```

macOS grants system-audio capture only to a bundled app, so to record, build it with `pnpm --filter @aftercall/desktop tauri build --debug --bundles app` and open the `.app`. The first run walks through an audio check and the NEAR AI key; Settings connects NEAR (two signatures in your own wallet) and sets autopilot. While Aftercall runs, ⌘⇧R works from any app: it brings Aftercall forward and opens the record sheet (pressed again with the box ticked, it starts recording), or your notes while recording. The trade-off: while it's on, other apps can't use ⌘⇧R (Safari's Reader, for example). Settings → Shortcut turns it off, so ⌘⇧R works only inside Aftercall and other apps keep it; the choice is saved and takes effect at once (test `the_shortcut_works_from_any_app_until_you_turn_it_off` covers the saved choice; the switch itself hasn't been pressed in the Mac app). If another app already holds ⌘⇧R, the shortcut works only inside Aftercall, Settings says so, and onboarding and the live page say "in Aftercall" instead of "from any app". Deploy the contract to testnet with [`contracts/scripts/deploy-testnet.sh`](contracts/README.md). Backend settings: `apps/backend/.env.example`.

| Part | Choice |
| --- | --- |
| Desktop | Tauri v2, React, TypeScript, Tailwind; Rust Core Audio process tap (`cidre`), `cpal` microphone |
| Shared core | TypeScript: notes pipeline, schema (zod), verification, owner actions, recap, autopilot, search |
| Backend | NestJS + Postgres: NEP-413 sign-in, Resend email, claim links |
| Web | Next.js: Verify, How a call is handled, sign and claim pages |
| Contract | Rust, near-sdk 5.29, cargo-near, near-workspaces sandbox tests; Circle USDC |

Repo layout: `apps/desktop`, `apps/backend`, `apps/web`, `apps/mcp`, `packages/core`, `packages/tokens` (design tokens as CSS for the web), `contracts/agent-wallet`, `crates/near-tx`, `scripts/`, `docs/` (rules, design source).

Design: [Aftercall Screens](https://claude.ai/artifact/RXNzkVE5TXbVu2ynPKRScW) · [Design system](https://claude.ai/artifact/96RdBedZXsLxdXixzAdk6x) (private links for the team).

## Built with

Disclosed per the hackathon FAQ (Q-005).

- **AI-written code:** most of this repository was written by Claude Code (Anthropic's coding agent) under Victor's direction, from Victor's own plan and design. Commits carry a `Co-Authored-By: Claude` line.
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
- [ ] Send the recap email with its footer (what was checked, and the notice you logged), through Aftercall or as a draft in your own Mail app
- [ ] Pay a listed payee in USDC under the contract's caps, and block a $5,000 over-cap payment until your wallet approves it
- [ ] Let a new freelancer share where to be paid with a single-use claim link

## Plan

### M1 · Day 1 (2026-11-01): Foundations
- [x] Scaffold the pnpm monorepo (apps/desktop, apps/backend, apps/web, packages/core, contracts/agent-wallet) with a hello-world in each
- [x] Desktop interface from the design on sample data: meeting page, follow-ups with "check before you approve", transcript with evidence links, recording panel with the consent tick, processing stages, light and dark
- [x] Tauri app with menu bar item, consent tick and the Core Audio + mic recorder writing 5-minute 16 kHz WAV chunks (about 9.6 MB each, under NEAR AI's 25 MB limit). Checked on a real call: both stems carry sound, saved recordings reload after a restart
- [x] Agent-wallet contract with daily cap, per-payment cap, payee list, pending approvals and proof registry; sandbox tests in CI (18 tests: 5 unit, 13 on a local NEAR node)
- [x] NestJS backend with NEP-413 NEAR login and a JWT session
- [ ] Silence watchdog: warn when system audio or the mic is exact zeros for 30 s, or the mic sends nothing for 10 s; the pill, the live page and a notification say which side. Built and unit-tested; still to see it fire live (record with System Audio Recording turned off, or switch AirPods mid-call)

### M2 · Day 3 (2026-11-03): Private notes
- [x] Transcribe each chunk with Whisper on NEAR AI, passing payee and project names as the prompt. Tested against a fake NEAR AI; ran live once on the designer-kickoff sample (1 Nov)
- [x] Label "You" (mic) and "Others" (system audio) by transcribing the two stems
- [x] Summarise with Qwen3.8-27B into the zod schema (decisions, action items, follow-ups, evidence quotes); drop items whose quote isn't in the transcript. Tested with a fake model; ran live once (1 Nov): the right decisions, action items and the 40 USDC deposit, each with its quote
- [x] Meeting page and transcript view with quote links, on real notes once a recording is processed
- [ ] Backend mints a spend-limited NEAR AI key per user
- [x] Attestation preflight and response-signature check for the summary call. Signature recovery matches ethers on 20 of 20 messages; all 29 checks passed against live NEAR AI on 1 Nov

### M3 · Day 4 (2026-11-04): Proof anyone can check
- [ ] Deploy the contract to testnet; app adds the limited key (pay, record_proof). The app's key, Connect NEAR screen and `contracts/scripts/deploy-testnet.sh` are built; the app's signer is tested against a local NEAR node; the testnet deploy waits on a testnet account
- [x] Build the proof bundle, hash it and call `record_proof` (proven on a local NEAR node: recorded, duplicate refused, nothing else allowed)
- [x] Processing screen with live stages, in run order: secure hardware checked, transcribed, notes written, signature checked, audio deleted from this Mac, proof recorded on NEAR
- [x] Verify sheet in the app (5 checks plus "notes unchanged since signing", "what this does not prove" and your edits after signing)
- [x] Public Verify page on the web (`/verify#…`), re-running the checks in the browser against NEAR RPC with no meeting content
- [ ] Gate 1: a real call becomes verified notes with a public proof link

### M4 · Day 7 (2026-11-07): It does what the meeting decided
- [x] Recap email card: Approve and send (backend + Resend, app footer required, 50 a day per account) or Draft in Mail (opens your own mail app; nothing leaves the Mac). Sending through Resend waits on a Resend key
- [x] Payment card with the "check before you approve" row (heard words vs parsed amount and payee)
- [x] Agent wallet in the app: balance, spent today, caps, payees, pause, deposit and withdraw, read live from the contract; every change is signed in your own NEAR wallet through the web signing page. The page opens real NEAR wallets; a signed change on testnet waits on a testnet account
- [x] Capped payment after one tap; payment states (sending, paid, failed with refund), sent with this Mac's limited key (pay is proven on a local NEAR node)
- [x] Over-cap $5,000 blocked; approve-in-wallet web page (`/sign`, any NEAR wallet via NEAR Connect); app updates when the wallet signs (polls NEAR; first live check waits on a testnet account)
- [x] Claim link: single-use link (7 days), stored in Postgres with only a hash of the token, phone claim page, owner confirms the payee in their wallet. Tested end to end against the backend; emailing the link waits on Resend
- [x] Autopilot rules (team-domain recaps, listed payees within the per-payment cap and today's allowance), with a 60-second undo. If Aftercall closes during the undo window, the item doesn't run on the next launch: it waits for your approval and says why
- [ ] Gate 2: the full demo works end to end on testnet
- [ ] 5 Nov: public rough build and a video reply in the teaser thread to Illia

### M5 · Day 10 (2026-11-10): Real users and trust
- [x] Onboarding v0: welcome, a real 5-second audio check (triggers the macOS prompts), NEAR AI key, first recording; wallet later in Settings
- [ ] Meeting names and recap recipients from the macOS calendar. Built (EventKit, matching tested in core); first run against a real calendar still to do
- [x] Projects, cross-meeting action items and local search (⌘K: decisions, action items and transcript lines, on the device)
- [ ] Deploy to mainnet with tiny amounts; remove the contract account's full-access keys. `contracts/scripts/deploy-mainnet.sh` (5 USDC a day, 2 a payment, lock as a confirmed last step) and the locked-contract sandbox test are built; the deploy waits on Victor's mainnet account and go-ahead
- [ ] Staking for Inference funds the team org; counts-only stats endpoint. `/stats` (backend, cached 60 s, from the contract's `get_stats` and Postgres) and the web `/stats` page are built; staking is Victor's step, written up in [docs/staking-for-inference.md](docs/staking-for-inference.md)
- [x] Recovery phrase, restore on a new Mac, settings: 12-word phrase derives the app key; restore in onboarding and Settings; encrypted backup of notes, projects and settings. Not yet run in the bundled app
- [x] Record from the call's own app: global ⌘⇧R, "Call ended?" after 2 quiet minutes on both sides (asks, never stops), processing steps in run order (audio deleted before the proof). The watches and the press gate are unit-tested; none of it has run in the Mac app yet
- [x] Meetings in any language: notes in English, quotes copied and checked in the language spoken; amounts from digits in any language, number words only in English, other currencies and the countries' dollars Aftercall knows never read as USDC. Tested on fixtures; no live run yet
- [x] Real meeting dates (stored as ISO times, written out when shown) and editable action items with Restore original, marked in recaps and on Verify, signed notes untouched. Core and Rust tested; the Tauri edit command not yet run in the Mac app
- [ ] Gate 3: 20 outside users, no mocked screens

### M6 · Day 12 (2026-11-12): Stretch and judges
- [x] Agent context: local MCP server (read tools; claim and complete action items only when you allow it), shipped in the app as one file run with `node`; Connected agents screen with the write switch and recent agent activity. A real Claude Code session was run against the bundled server and its test stand-in for the app ([docs/agents-demo.md](docs/agents-demo.md)); not yet against the Mac app, and not yet with Codex
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
