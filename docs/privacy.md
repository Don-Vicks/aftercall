# Privacy: what leaves the Mac, and what anyone keeps

Aftercall's rule: meeting content is processed on the Mac or inside NEAR AI Cloud's secure hardware, and Aftercall's own servers keep nothing about a meeting after a response returns. This page lists every place data goes, what each place keeps and for how long, and the code that enforces it. Line numbers are for this commit.

## Summary

| Data | Goes to | Kept there |
| --- | --- | --- |
| Meeting audio (two WAV stems) | NEAR AI Cloud, Whisper in a TEE | NEAR AI's policy; Aftercall deletes its copy on the Mac once notes are saved |
| Transcript text, project and payee names | NEAR AI Cloud, Qwen in a TEE | NEAR AI's policy |
| Your notes (what you type during the call) | NEAR AI Cloud, Qwen in a TEE, in the same end-to-end encrypted request as the transcript | NEAR AI's policy. Never in a recap, never sent to connected agents; the proof holds only a salted hash |
| A question you ask your meetings, with at most 8 matching transcript lines | NEAR AI Cloud, Qwen in a TEE, end-to-end encrypted | NEAR AI's policy |
| Notes, transcript, your notes, settings | Nowhere. They stay in the app's folder on the Mac | Until you delete the meeting |
| Proof of a meeting | NEAR blockchain (`record_proof`) | Forever, publicly: the recording id (its start time), a sha256 hash and the model name. No content |
| A payment | NEAR blockchain (`pay`) | Forever, publicly: payee account, amount, a memo and a follow-up id (see the note on memos below) |
| Recap you **Draft in Mail** | Your own mail app | Your mail provider. Aftercall's servers never see it |
| Recap you **Send through Aftercall** | Aftercall backend, then Resend | Backend: nothing (in memory for one request). Resend: sent mail under Resend's own retention policy |
| Claim link | Aftercall backend | Token hash, owner, amount, expiry, status, the account the payee shared. The payee's name and the meeting title stay in the link |
| Sign-in | Aftercall backend | A one-time nonce for up to 5 minutes, in memory. Sessions are signed tokens; no session table |
| Usage stats | Aftercall backend | Counts only (`emails_sent`, claim totals), never per account or per meeting |
| A NEAR Intents payment | 1Click API (`1click.chaindefuser.com`) | 1Click's policy: amount, destination address, your refund account |

## On the Mac

- Audio is written by the recorder as `mic-NNN.wav` (you) and `system-NNN.wav` (the others) in the app's data folder, `recordings/<id>/`.
- Only files inside that folder can be uploaded, and only `.wav`: `apps/desktop/src-tauri/src/nearai.rs:105` (`check_audio_path`).
- After the notes are saved, the audio and the cached chunk transcripts are deleted: `apps/desktop/src/RecordingScreen.tsx:106` calls `delete_audio`, `apps/desktop/src-tauri/src/lib.rs:221`.
- The NEAR AI key lives in the macOS Keychain and never reaches the web view: `apps/desktop/src-tauri/src/nearai.rs:29`.
- Calendar lookups (EventKit), search, the People list, the MCP server for agents and backups are all local.
- **Delete everything on this Mac** (Settings → Privacy and your data) removes the app's data folder and its four Keychain items (`data-key`, `near-app-key`, `nearai-api-key`, `backup-key` under `dev.aftercall.app`), after you type "delete": `apps/desktop/src-tauri/src/wipe.rs`, called by `delete_all_data` in `lib.rs`. The folder goes first and the keys only once it's gone. Proofs and payments on NEAR, this Mac's access key on your NEAR account, the agent wallet's balance and backups you exported stay.

## NEAR AI Cloud

- The only AI endpoint is `https://cloud-api.near.ai/v1` (`apps/desktop/src-tauri/src/nearai.rs:11`), and only the Confidential TEE models in `packages/core/src/notes/pipeline.ts:10`.
- What is sent: each audio chunk (with project and payee names as Whisper's spelling prompt), then the merged transcript with the project name, the payee list and your notes if you typed any (`summaryRequestText`, `packages/core/src/notes/pipeline.ts:83`).
- **Ask your meetings** (`packages/core/src/ask.ts`): the question is searched on the Mac first. Only the transcript lines that match (at most 8, each cut to 400 characters, each labelled with its meeting's title, time and speaker: "You", the one person the calendar invited, or "Others"), today's date and the question go to the Qwen TEE, end-to-end encrypted to a model key that passed the attestation checks moments before. If no line matches, or the gateway or model check fails, nothing is sent; there is no unencrypted fallback. Quotes in the answer that aren't in those lines are dropped.
- The app may also read the attestation report and the response signature, and nothing else: `apps/desktop/src-tauri/src/nearai.rs:156` (`check_get_path`).
- What NEAR AI keeps is set by NEAR AI, not by Aftercall. The attestation proves the models ran in TEEs; it does not prove what NEAR AI's gateway logs.
- `pnpm sample:notes` uses a Node transport with the same three calls and the same path rule: `packages/core/src/node/nearai.ts`.

## Your notes

What you type during a call is yours: it guides the notes, and goes nowhere else.

- Before sending, they are cleaned: `<<<` and `>>>` are removed (so the text can't close the block it is quoted in), then they are trimmed and cut to 8,000 characters (`cleanYourNotes`, `packages/core/src/notes/pipeline.ts:72`).
- They go only to the summary model, inside the request that is end-to-end encrypted to the attested Qwen TEE, as a block headed "YOUR NOTES (typed by YOU during the call; context only)" (`pipeline.ts:83`). Whisper never gets them. If end-to-end encryption isn't available, they travel over TLS to the attested gateway like the transcript, and the Verify sheet says so.
- The model's instructions say evidence must still come from the transcript (`packages/core/src/notes/schema.ts:98`), and `buildMeeting` drops anything whose quote isn't in the transcript, so a payment that appears only in your notes never becomes a follow-up (`build.test.ts`, `pipeline.test.ts`: "your notes go to the model inside the encrypted request…").
- On the Mac they are kept on the meeting in `notes.json`, sealed like the rest, and shown above the AI notes.
- The proof holds `yourNotesHash = sha256(salt ‖ your notes)` (`yourNotesHash`, `packages/core/src/notes/verify.ts:34`). The salt is 32 random bytes made per meeting (`pipeline.ts:327`) and saved only in `notes.json`, so the public proof link reveals nothing about them and short notes can't be guessed by hashing likely phrases. The Verify sheet re-checks "Your notes unchanged since signing" with the saved salt (`packages/core/src/notes/proof.ts:110`); the public page can't, and doesn't try. Proofs without your notes leave the key out and hash exactly as before (`proof.test.ts`: "old proofs hash exactly as before…").
- Never in a recap: `buildRecap` doesn't read them (`packages/core/src/followups/recap.ts:21`; `recap.test.ts`: "a recap never includes your notes").
- Never sent to connected agents: the app's agents socket removes `meeting.yourNotes` and the salt from everything it answers (`for_agents`, `apps/desktop/src-tauri/src/agents.rs:227`; test `your_notes_and_their_salt_never_reach_agents`), and no MCP tool returns or searches them (`apps/mcp/src/tools.test.ts`: "your notes never reach an agent…").
- Nothing about them goes on NEAR except inside the proof hash.

## Aftercall backend (NestJS)

### Recap email: nothing kept

- The recap (recipient, subject, body, reply-to) is held in memory for one request, checked, handed to Resend and dropped: header comment at `apps/backend/src/email/email.service.ts:5`, type `TransientRecap`.
- What stays: today's send count per account, in memory, for the 50-a-day limit (`email.service.ts:52`), and the global `emails_sent` counter (`email.service.ts:89`, table `counters`, `apps/backend/src/stats/counters.ts:3`).
- Errors from Resend can quote the address, so they are turned into a plain `SEND_FAILED (Resend <status>)` and nothing is logged (`email.service.ts:83`).
- Tested: `apps/backend/src/email/email.test.ts:125` sends a recap through the real HTTP route with a spy Resend client, a spy database behind the counters and every Nest and console log captured, and checks that the only database write is `emails_sent`, that no log line, stored value or error contains the recipient, subject or body, and that a failed send is not even counted.
- Honest limits: the backend process does see the recap text in memory while the request runs, and the hosting provider sees the request (TLS ends at the backend). Resend stores sent mail under its own policy. If you don't want either, use **Draft in Mail**, which is the default button (`apps/desktop/src/FollowUps.tsx`, `apps/desktop/src/followUpActions.ts:37`).

### Claim links: only what the link needs

- Stored: a sha256 of the token, the owner, the amount, created and expiry times, the status and the account the payee shared: schema at `apps/backend/src/claims/claims.store.ts:61`; reasoning at `apps/backend/src/claims/claims.service.ts:11`.
- Not stored: the payee's name, a memo and the meeting title. The controller reads only `amount` from the request (`apps/backend/src/claims/claims.controller.ts:17`). The app puts the details in the link's `#fragment` (`packages/core/src/followups/claimLink.ts:27`, called from `apps/desktop/src/followUpActions.ts:163`), which browsers never send to any server; the claim page reads them in the payee's browser (`apps/web/app/claim/ClaimClient.tsx:35`). The amount shown always comes from the server, so editing the fragment can't change it.
- Older databases are migrated on start: the `payee_name`, `memo` and `meeting` columns are dropped with their contents (`claims.store.ts:76`).
- How long: links expire after 7 days (`claims.service.ts:33`). Expired and used rows are kept for the owner's list and the claim totals in `/stats`; they hold no names or meeting text.
- Tested: `apps/backend/src/claims/claims.test.ts:45` (details sent by an older app are not kept, in memory and in Postgres) and `claims.test.ts:106` (the live Postgres table has exactly the allowed columns, including after migrating an old table with data in it).
- Honest limits: the token travels in the URL path of `GET/POST /claims/link/<token>`, so a hosting provider's access log may record it until the link is used or expires.

### Sign-in and stats

- NEP-413 sign-in keeps a single-use nonce in memory until it is checked or expires (`apps/backend/src/auth/auth.service.ts:55`); sessions are signed tokens, not rows.
- `/stats` returns counts only (`apps/backend/src/stats/stats.test.ts:33`).

## NEAR blockchain (public, permanent)

- `record_proof(meeting_id, proof_hash, model)`: `apps/desktop/src-tauri/src/near.rs:130`. The meeting id is the recording's start time in Unix seconds. The hash covers the proof bundle; no transcript or notes are on-chain. The public Verify page reads only this from NEAR RPC (`apps/web/app/verify/VerifyClient.tsx:21`); the bundle itself travels in the proof link's fragment.
- `pay(payee, amount, memo, followup_id)`: `apps/desktop/src-tauri/src/near.rs:158`. The memo is the fixed text `Aftercall payment` (`PAY_MEMO` in `apps/desktop/src/followUpActions.ts`), so nothing about the meeting goes on chain; the follow-up id is `<recording id>-<follow-up id>` (`contractFollowupId`, `apps/desktop/src/near.ts:73`), and the recording id is its start time in Unix seconds, so the chain shows when a paid meeting started.

## Other services

- NEAR Intents 1Click (`packages/core/src/intents/oneclick.ts:13`), only for payees you opted in to paying on Solana or Base: the amount, the destination address and your NEAR account for refunds.
- NEAR RPC (FastNEAR by default) sees the account and contract reads and the transactions the app sends.

## Sample recordings

`samples/` holds two fictional calls made with macOS text-to-speech (`scripts/make-samples.mjs`). Opening one in the app copies it into the recordings folder as a recording labelled "Sample" (`apps/desktop/src-tauri/src/samples.rs:34`); from there it follows exactly the path above.
