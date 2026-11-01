# Privacy: what leaves the Mac, and what anyone keeps

Aftercall's rule: meeting content is processed on the Mac or inside NEAR AI Cloud's secure hardware, and Aftercall's own servers keep nothing about a meeting after a response returns. This page lists every place data goes, what each place keeps and for how long, and the code that enforces it. Line numbers are for this commit.

## Summary

| Data | Goes to | Kept there |
| --- | --- | --- |
| Meeting audio (two WAV stems) | NEAR AI Cloud, Whisper in a TEE | NEAR AI's policy; Aftercall deletes its copy on the Mac right after the notes are saved, or at the next launch if that didn't happen |
| Transcript text, project and payee names | NEAR AI Cloud, Qwen in a TEE | NEAR AI's policy |
| Your notes (what you type during the call) | NEAR AI Cloud, Qwen in a TEE, in the same end-to-end encrypted request as the transcript | NEAR AI's policy. Never in a recap, never sent to connected agents; the proof holds only a salted hash |
| A question you ask your meetings, with at most 8 matching transcript lines | NEAR AI Cloud, Qwen in a TEE, end-to-end encrypted | NEAR AI's policy |
| Notes, transcript, your notes, your edits to action items, settings, the estimated cost of each run | Nowhere. They stay in the app's folder on the Mac | Until you delete the meeting |
| Agent activity (when, the name the agent gives itself, which request, meeting and item ids, allowed or refused) | Nowhere. On this Mac only | Sealed in `agents-activity.json` in the app's folder, newest 200, until Delete everything. Never meeting content. Each read, claim and completion is listed, and every refused request; allowed lookups of project names and of the write switch aren't (`Activity`, `apps/desktop/src-tauri/src/agents.rs:369`) |
| The notice you log before recording (that you told everyone, when you ticked the box, and how if you say) | Into the meeting's proof, so only its hash goes on NEAR; the proof link carries it to whoever you share it with | With the recording on the Mac. Never sent to connected agents |
| Proof of a meeting | NEAR blockchain (`record_proof`) | Forever, publicly: the recording id (its start time), a sha256 hash and the model name. No content |
| A payment | NEAR blockchain (`pay`) | Forever, publicly: payee account, amount, a memo and a follow-up id (see the note on memos below) |
| Recap you **Draft in Mail** | Your own mail app | Your mail provider. Aftercall's servers never see it |
| Recap you **Send through Aftercall** | Aftercall backend, then Resend | Backend: nothing (in memory for one request). Resend: sent mail under Resend's own retention policy |
| Claim link | Aftercall backend | Token hash, owner, amount, expiry, status, the account the payee shared. The payee's name and the meeting title stay in the link |
| Sign-in | Aftercall backend | A one-time nonce for up to 5 minutes, in memory. Sessions are signed tokens; no session table |
| Usage stats | Aftercall backend | Counts only (`emails_sent`, claim totals), never per account or per meeting |
| A NEAR Intents payment | 1Click API (`1click.chaindefuser.com`) | 1Click's policy: amount, destination address, your refund account |
| A meeting you export (Export → Copy as Markdown, or Print or save as PDF) | Your clipboard, then wherever you paste it; or your printer, or a PDF wherever you save it | Not encrypted, and Delete everything can't reach it. Your notes and the transcript only when you tick them; never email addresses, NEAR accounts, transaction ids or proof details |

## On the Mac

- Audio is written by the recorder as `mic-NNN.wav` (you) and `system-NNN.wav` (the others) in the app's data folder, `recordings/<id>/`.
- Only files inside that folder can be uploaded, and only `.wav`: `apps/desktop/src-tauri/src/nearai.rs:111` (`check_audio_path`).
- Right after the notes are saved, before the proof goes to NEAR, the audio and the cached chunk transcripts are deleted: `apps/desktop/src/RecordingScreen.tsx:137` calls `delete_audio`, `apps/desktop/src-tauri/src/lib.rs:662`. The processing page shows the steps in that order: "Audio deleted from this Mac" comes before "Proof recorded on NEAR". If the app quits before that, or the delete fails, `sweep_audio` (`lib.rs:686`, run at launch) deletes the audio of every recording that has notes; recordings without notes keep theirs so they can be processed or retried (test `audio_left_beside_saved_notes_is_swept_and_unprocessed_audio_stays`).
- The notice: ticking "I've told everyone on the call" records the time you ticked it, and how you told them if you pick one (`apps/desktop/src/recording/RecordSheet.tsx`). It is saved in `meeting.json` with the recording (`NoticeLog`, `lib.rs:120`, which accepts only `by: "you"` and the known ways), and copied into the proof as your statement (`ProcessInput.notice`, `packages/core/src/notes/pipeline.ts`). The proof hash covers it; nothing checks it. Samples get none.
- Editing an action item (text, owner or due date) changes only the meeting's copy in `notes.json`, sealed like the rest, under the same file lock as ticks and agent claims (`edit_item`, `apps/desktop/src-tauri/src/notes_file.rs:180`). The model's signed notes and the proof hash never change; Restore original puts back the signed item. A recap marks each open edited item "(edited by the sender)" and its footer says Aftercall didn't check those changes (`packages/core/src/followups/recap.ts`).
- Export (the meeting page's share button, `apps/desktop/src/ExportMenu.tsx`) copies the meeting as Markdown or opens the print panel, where macOS can save a PDF. Both read `meetingExport` (`packages/core/src/export.ts`): title, date, project, people, summary, decisions, action items (edited ones marked "(edited by you)"), follow-ups by name, amount and status, and whether the notes were verified and where to see the checks. Your notes and the transcript go in only when you tick them in the menu, and the ticks reset each time the page opens. Email addresses, NEAR accounts, transaction ids, claim links and proof details stay out; someone the calendar has no name for is counted ("You, Ada and 1 other") and their transcript lines read "Others". The menu says that copying uses the clipboard, and that copies and PDFs aren't encrypted and Delete everything can't remove them. Nothing is sent anywhere.
- The estimated cost of a run (tokens and Whisper seconds NEAR AI reported, times its public prices on 1 Nov 2026, `packages/core/src/cost.ts`) is saved in `notes.json`, not in the proof.
- The NEAR AI key lives in the macOS Keychain and never reaches the web view: `apps/desktop/src-tauri/src/nearai.rs:29`.
- Calendar lookups (EventKit), search, the People list, the MCP server for agents (shipped inside the app as `mcp/aftercall-mcp.mjs` and run with your own `node`) and backups are all local.
- To warn when your mic or the call goes silent, and to ask "Call ended?", the recorder measures each side's loudness over each second (`apps/desktop/src-tauri/src/recorder.rs`). The levels aren't saved. A warning notification goes out only when Aftercall's window isn't focused, and says only which side went silent and that recording goes on (`warningText`, `apps/desktop/src/recording/notify.tsx`).
- **Delete everything on this Mac** (Settings → Privacy and your data) removes the app's data folder (with the agent settings and the agent activity list) and its four Keychain items (`data-key`, `near-app-key`, `nearai-api-key`, `backup-key` under `dev.aftercall.app`), after you type "delete": `apps/desktop/src-tauri/src/wipe.rs`, called by `delete_all_data` in `lib.rs`. The folder goes first and the keys only once it's gone. Proofs and payments on NEAR, this Mac's access key on your NEAR account, the agent wallet's balance, backups you exported and meetings you copied or printed stay.

## NEAR AI Cloud

- The only AI endpoint is `https://cloud-api.near.ai/v1` (`apps/desktop/src-tauri/src/nearai.rs:11`), and only the Confidential TEE models in `packages/core/src/notes/pipeline.ts:12`.
- Every call is capped: the notes request at 12,288 output tokens (`SUMMARY_MAX_TOKENS`, `pipeline.ts:22`) and Ask at 6,144 (`ASK_MAX_TOKENS`, `packages/core/src/ask.ts:32`). A reply cut off at the cap stops the run before anything is parsed, saved or shown.
- What is sent: each audio chunk (with project and payee names as Whisper's spelling prompt), then the merged transcript with the project name, the payee list and your notes if you typed any (`summaryRequestText`, `packages/core/src/notes/pipeline.ts:94`). The transcript is end-to-end encrypted to a verified summary node's attested key. When that isn't available (no verified node offers an attested key, or NEAR AI refuses an encryption header it was sent; `e2eeRefusal`, `packages/core/src/errors.ts`), it goes over TLS only if every summary node passed, and the proof records which happened. When NEAR AI answers that the attested model key is no longer one it serves (`e2eeStaleKey`), the app checks the summary hardware again and retries end-to-end encrypted once, to a key from the new quotes; if that fails, it stops, and the transcript never goes over TLS. Any other error stops processing, and the transcript isn't sent again. Payee and project names come from your agent wallet on NEAR; the sample payee is used only for sample recordings.
- **Ask your meetings** (`packages/core/src/ask.ts`): the question is searched on the Mac first. Only the transcript lines that match (at most 8, each cut to 400 characters, each labelled with its meeting's title, time and speaker: "You", the one person the calendar invited, or "Others"), today's date and the question go to the Qwen TEE, end-to-end encrypted to a model key that passed the attestation checks moments before. If no line matches, or the gateway or model check fails, nothing is sent; there is no unencrypted fallback. Quotes in the answer that aren't in those lines are dropped.
- The notes prompt asks the model to write the title, summary, decisions and action items in English whatever language was spoken, and to copy evidence quotes and the words said about amounts in the language spoken, never translated (`NOTES_SYSTEM_PROMPT`, `packages/core/src/notes/schema.ts:89`). The quotes are then checked against the transcript on the Mac, so a translated quote is dropped.
- The app may also read the attestation report and the response signature, and nothing else: `apps/desktop/src-tauri/src/nearai.rs:193` (`check_get_path`).
- What NEAR AI keeps, and whether it trains on anything, is set by NEAR AI's own policy, not by Aftercall. The attestation proves the models ran in TEEs; it does not prove what NEAR AI's gateway logs. The Verify page lists this under what isn't proven, and the recap footer makes no claim about it.
- `pnpm sample:notes` uses a Node transport with the same three calls and the same path rule: `packages/core/src/node/nearai.ts`.

## Your notes

What you type during a call is yours: it guides the notes, and goes nowhere else.

- Make notes uses exactly what you last typed on the recording's page: an edit still waiting to be saved is saved to `your-notes.json` first, and if that save fails nothing is sent (`YourNotesDrafts`, `packages/core/src/notes/yourNotesDrafts.ts`; `yourNotesDrafts.test.ts`). So the file holds exactly what you last typed, and the model and the proof's salted hash get the cleaned version of that same text (next point).
- Before sending, they are cleaned: `<<<` and `>>>` are removed (so the text can't close the block it is quoted in), then they are trimmed and cut to 8,000 characters (`cleanYourNotes`, `packages/core/src/notes/pipeline.ts:83`).
- They go only to the summary model, inside the request that is end-to-end encrypted to the attested Qwen TEE, as a block headed "YOUR NOTES (typed by YOU during the call; context only)" (`pipeline.ts:94`). Whisper never gets them. If end-to-end encryption isn't available, they travel over TLS to the attested gateway like the transcript, and the Verify sheet says so.
- The model's instructions say evidence must still come from the transcript (`packages/core/src/notes/schema.ts:100`), and `buildMeeting` drops anything whose quote isn't in the transcript, so a payment that appears only in your notes never becomes a follow-up (`build.test.ts`, `pipeline.test.ts`: "your notes go to the model inside the encrypted request…").
- On the Mac they are kept on the meeting in `notes.json`, sealed like the rest, and shown above the AI notes.
- The proof holds `yourNotesHash = sha256(salt ‖ your notes)` (`yourNotesHash`, `packages/core/src/notes/verify.ts:34`). The salt is 32 random bytes made per meeting (`pipeline.ts:430`) and saved only in `notes.json`, so the public proof link reveals nothing about them and short notes can't be guessed by hashing likely phrases. The Verify sheet re-checks "Your notes unchanged since signing" with the saved salt (`packages/core/src/notes/proof.ts:111`); the public page can't, and doesn't try. Proofs without your notes leave the key out and hash exactly as before (`proof.test.ts`: "old proofs hash exactly as before…").
- Never in a recap: `buildRecap` doesn't read them (`packages/core/src/followups/recap.ts:71`; `recap.test.ts`: "a recap never includes your notes").
- Never sent to connected agents: the app's agents socket removes `meeting.yourNotes` and the salt from everything it answers, along with the proof's notice and the cost estimate (`for_agents`, `apps/desktop/src-tauri/src/agents.rs:286`; test `your_notes_and_their_salt_never_reach_agents`), and no MCP tool returns or searches them (`apps/mcp/src/tools.test.ts`: "your notes never reach an agent…").
- Nothing about them goes on NEAR except inside the proof hash.

## Connected agents

Off by default. While on, agents reach meetings only through the running app's owner-only socket with a token (`apps/desktop/src-tauri/src/agents.rs`).

- Agents only read unless you also turn on "Let agents claim and complete action items", which is off by default and goes back off whenever you turn agents off. While it is off, the socket refuses claim and complete with a message naming that switch (`dispatch`, `agents.rs:224`; test `agents_read_only_by_default_and_are_told_which_switch_to_turn_on`). An `agents.json` saved before the switch existed reads as off. Turning agents off closes the socket and ends connections that are still open (test `turning_agents_off_ends_connections_that_are_still_open`).
- Even with the switch on, an agent can only claim an action item or mark it done with a note; it can't send email, pay, record proofs, or change or delete notes.
- Agents see action items as you edited them, with an `edited` field (`apps/mcp/src/tools.ts:74`), and meeting start times as ISO times. They never get your notes, their salt, the notice or the cost estimate (`for_agents`, above).
- The activity list (`agents-activity.json`, sealed) records each read, claim and completion, and every refused request: the time, the name the agent gives itself (not checked), the request, well-formed meeting and item ids, and whether it was allowed. Never error text or meeting content; the screen looks up titles and item text in the meetings the app already has. The newest 200 are kept (tests `the_activity_list_holds_ids_and_names_never_meeting_content`, `the_activity_list_keeps_the_newest_200`).
- Honest limits: the token sits in the agent's own config file (for example `~/.claude.json`), so other software running as you that can read that file can reach your meetings too.

## Aftercall backend (NestJS)

### Recap email: nothing kept

- The recap (recipient, subject, body, reply-to) is held in memory for one request, checked, handed to Resend and dropped: header comment at `apps/backend/src/email/email.service.ts:5`, type `TransientRecap`.
- A recap is accepted only if it ends with the footer the app writes, found by its line "What was and wasn't checked:" (`RECAP_FOOTER_MARK`, `email.service.ts:77`; the same constant as `packages/core/src/followups/recap.ts`, checked in `email.test.ts`). The footer says only what the app knows: whether every secure-hardware check passed, whether the transcript was end-to-end encrypted, how many of the open action items in the recap the sender changed after the notes were made (marked "(edited by the sender)") and that Aftercall didn't check those changes, if there are any, that the audio is deleted once the notes are saved, the sender's notice if they logged one (as their statement), and a link to the proof or to the web page `/handling`.
- What stays: today's send count per account, in memory, for the 50-a-day limit (`email.service.ts:58`), and the global `emails_sent` counter (`email.service.ts:95`, table `counters`, `apps/backend/src/stats/counters.ts:3`).
- Errors from Resend can quote the address, so they are turned into a plain `SEND_FAILED (Resend <status>)` and nothing is logged (`email.service.ts:91`).
- Tested: `apps/backend/src/email/email.test.ts:155` sends a recap through the real HTTP route with a spy Resend client, a spy database behind the counters and every Nest and console log captured, and checks that the only database write is `emails_sent`, that no log line, stored value or error contains the recipient, subject or body, and that a failed send is not even counted.
- Honest limits: the backend process does see the recap text in memory while the request runs, and the hosting provider sees the request (TLS ends at the backend). Resend stores sent mail under its own policy. If you don't want either, use **Draft in Mail**, which is the default button (`apps/desktop/src/FollowUps.tsx`, `apps/desktop/src/followUpActions.ts:47`).

### Claim links: only what the link needs

- Stored: a sha256 of the token, the owner, the amount, created and expiry times, the status and the account the payee shared: schema at `apps/backend/src/claims/claims.store.ts:61`; reasoning at `apps/backend/src/claims/claims.service.ts:11`.
- Not stored: the payee's name, a memo and the meeting title. The controller reads only `amount` from the request (`apps/backend/src/claims/claims.controller.ts:17`). The app puts the details in the link's `#fragment` (`packages/core/src/followups/claimLink.ts:27`, called from `apps/desktop/src/followUpActions.ts:177`), which browsers never send to any server; the claim page reads them in the payee's browser (`apps/web/app/claim/ClaimClient.tsx:38`). The amount shown always comes from the server, so editing the fragment can't change it.
- Older databases are migrated on start: the `payee_name`, `memo` and `meeting` columns are dropped with their contents (`claims.store.ts:76`).
- How long: links expire after 7 days (`claims.service.ts:33`). Expired and used rows are kept for the owner's list and the claim totals in `/stats`; they hold no names or meeting text.
- Tested: `apps/backend/src/claims/claims.test.ts:45` (details sent by an older app are not kept, in memory and in Postgres) and `claims.test.ts:106` (the live Postgres table has exactly the allowed columns, including after migrating an old table with data in it).
- Honest limits: the token travels in the URL path of `GET/POST /claims/link/<token>`, so a hosting provider's access log may record it until the link is used or expires.

### Sign-in and stats

- NEP-413 sign-in keeps a single-use nonce in memory until it is checked or expires (`apps/backend/src/auth/auth.service.ts:55`); sessions are signed tokens, not rows.
- `/stats` returns counts only (`apps/backend/src/stats/stats.test.ts:33`).

## NEAR blockchain (public, permanent)

- `record_proof(meeting_id, proof_hash, model)`: `apps/desktop/src-tauri/src/near.rs:130`. The meeting id is the recording's start time in Unix seconds. The hash covers the proof bundle; no transcript or notes are on-chain. The public Verify page reads only this from NEAR RPC (`apps/web/app/verify/VerifyClient.tsx:44`); the bundle itself travels in the proof link's fragment.
- `pay(payee, amount, memo, followup_id)`: `apps/desktop/src-tauri/src/near.rs:158`. The memo is the fixed text `Aftercall payment` (`PAY_MEMO` in `apps/desktop/src/followUpActions.ts`), so nothing about the meeting goes on chain; the follow-up id is `<recording id>-<follow-up id>` (`contractFollowupId`, `apps/desktop/src/near.ts:73`), and the recording id is its start time in Unix seconds, so the chain shows when a paid meeting started.

## Other services

- NEAR Intents 1Click (`packages/core/src/intents/oneclick.ts:13`), only for payees you opted in to paying on Solana or Base: the amount, the destination address and your NEAR account for refunds.
- NEAR RPC (FastNEAR by default) sees the account and contract reads and the transactions the app sends.

## Sample recordings

`samples/` holds two fictional calls made with macOS text-to-speech (`scripts/make-samples.mjs`). Opening one in the app copies it into the recordings folder as a recording labelled "Sample" (`apps/desktop/src-tauri/src/samples.rs:34`); from there it follows exactly the path above.
