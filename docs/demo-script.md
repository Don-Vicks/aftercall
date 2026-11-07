# Demo video: the 90-second script

The hackathon demo for NEAR HACKATHON. It goes on the submission, on the public X post, and in front of the jury, so it has to show why someone would want Aftercall, not only what its screens are.

Status (7 Nov 2026): a draft. Nothing is recorded or posted yet. The X post at the end is a DRAFT for Victor to approve before anything goes out.

## What it has to sell

- **Who it's for:** founders and freelancers who agree work and payments on calls (the landing page's own line, `apps/web/app/landing/Hero.tsx`).
- **The one thing to remember:** you hang up, and the follow-ups are done: the recap sent, the agreed payment made within your caps, anything bigger waiting for you. Privately, with a proof anyone can check.
- **Why believe it, shown not told:** the secure hardware is checked before anything is sent (beat 4); every item quotes the call (beat 4); money moves only within caps a NEAR contract enforces (beat 6).
- **What to do next:** try it in the browser at getaftercall.vercel.app/demo, on screen at the close (beat 10).

Every beat serves one of these. The order is the viewer's day: the problem, the call, the notes, the follow-ups, the payoff.

## Rules for this video

- **Every spoken line is true today.** Each one has a footnote pointing to the doc that says it ([Sources](#sources)).
- **Nothing is shown as live unless it ran live.** Beats marked **Live session** depend on things that haven't run live yet (a payment on testnet, the Mac app with a real phone, the Mac app with a real Claude Code session, a public proof link). If the session doesn't get the shot, use the fallback listed for that beat, with its label on screen.
- **Samples say so.** Any made-up meeting on screen carries a label in the corner: "Sample meeting · browser demo" for `/demo`, "Sample call · made-up people" for the Mac app's samples.
- **Test money says so.** Every shot from the Mac app carries "Mac test build · NEAR testnet · test USDC" in a corner.
- **Waits are cut, not sped up.** NEAR AI, NEAR and the phone's 10-second check all take time; cut the wait and keep the UI at real speed.
- **No numbers we can't source.** No user counts, downloads or traffic.

## At a glance

Voice-over: 193 words in 90 seconds, about 2.1 words a second (budget 2.3).

| # | Time | Beat | Words | Capture |
| --- | --- | --- | --- | --- |
| 1 | 0:00–0:08 | The problem, felt | 18 | Today |
| 2 | 0:08–0:13 | The promise | 10 | Today |
| 3 | 0:13–0:21 | Record, no bot | 18 | Today; shoot in the live session so it's the same call |
| 4 | 0:21–0:33 | Notes in secure hardware, with quotes | 27 | **Live session** |
| 5 | 0:33–0:43 | A proof on NEAR, checked in a browser | 21 | **Live session** (the `/verify` shot) |
| 6 | 0:43–0:59 | The follow-ups: recap, payment, hold | 36 | **Live session** |
| 7 | 0:59–1:07 | Approve from your phone | 18 | **Live session** |
| 8 | 1:07–1:15 | Hand an action item to Claude Code | 15 | **Live session** |
| 9 | 1:15–1:24 | The payoff: hang up, it's done | 18 | Today, or from the live session |
| 10 | 1:24–1:30 | Close | 12 | Today |

## The script

### 1. The problem, felt · 0:00–0:08 (8 s)

- **On screen:** a video call in a grid of four people with an "Uploading your call…" bar filling, then a page of meeting notes whose items stay unticked, stamped "FRIDAY · STILL OPEN". These are the `Hook` and `Stale` scenes in `~/Developer/projects/aftercall-launch-video/src/Launch.tsx`, retimed to 8 s. They're drawn illustrations, not any real app.
- **On-screen text:** "Your calls go to servers you can't check." then "The follow-ups still wait on you."
- **Voice-over (18 words):** "Meeting notes apps send your calls to servers you can't check. Then the follow-ups still wait on you."[^problem]
- **Capture:** today (render from the Remotion project with the new copy).

### 2. The promise · 0:08–0:13 (5 s)

- **On screen:** the Aftercall icon and name on the dark ground, as in the Remotion `Mark` scene.
- **On-screen text:** "Private calls. Follow-ups done."
- **Voice-over (10 words):** "Aftercall keeps your calls private, then does what they agreed."[^promise]
- **Capture:** today.

### 3. Record, no bot · 0:13–0:21 (8 s)

- **On screen:** the Mac app's Home. Click Record; the record sheet with "I've told everyone on the call" ticked; then the recording screen beside the call window (FaceTime, Meet or Zoom), with no extra participant in the call's list.
- **On-screen text:** "Records any call on your Mac. No bot joins."
- **Voice-over (18 words):** "Hit record on any call. No bot joins.[^nobot] The audio is sealed on your Mac as it records."[^sealed]
- **Capture:** today (recording needs no NEAR AI key), but shoot it in the live session (shot L3) so the call recorded here is the one beats 4 to 8 follow.

### 4. Notes in secure hardware, with quotes · 0:21–0:33 (12 s)

- **On screen:** Make notes. The processing screen ticks through its checks (Intel TDX quote, NVIDIA GPU evidence, signatures) and lands on "Verified"; then the meeting page: summary, decisions, action items, each with the quote from the call under it. Hover one quote so the transcript line lights up.
- **On-screen text:** "Hardware checked first. Every item quotes the call."
- **Voice-over (27 words):** "Aftercall checks NEAR AI's secure hardware first.[^attest] The transcript is encrypted to the attested model.[^e2ee] Every item carries an exact quote from the call, or it's dropped."[^quotes]
- **Capture:** **Live session.** Making notes calls live NEAR AI with Victor's own key (it ran live on a real call on 3 Nov[^live3nov]).
- **Fallback:** `/demo` → the sample meeting's processing walk-through and notes. The browser demo simulates the run on sample data, so the label reads "Sample meeting · browser demo · simulated run". Voice-over unchanged: it describes what the app does, not what this shot ran.

### 5. A proof on NEAR, checked in a browser · 0:33–0:43 (10 s)

- **On screen:** the Verify sheet in the Mac app → Copy proof link → a browser at `https://getaftercall.vercel.app/verify` with that link, the checks re-running; then the `record_proof` transaction on `testnet.nearblocks.io`.
- **On-screen text:** "A proof on NEAR. Anyone with the link can re-check it."
- **Voice-over (21 words):** "A proof goes on NEAR, with no meeting content.[^proof] Share the link, and anyone can re-run the checks in a browser."[^verify]
- **Capture:** **Live session** for `/verify`: no public proof link exists yet[^nolink], and this test call can be the first. The nearblocks shot of the 3 Nov `record_proof` can be taken today.
- **Fallback:** the `/demo` Verify sheet re-running the checks on a test proof, labelled "Browser demo · test proof", then the real 3 Nov [`record_proof`](https://testnet.nearblocks.io/txns/2oawJPTmRiNky6EGzpURh79FRDkFcx4bp1kL76DevZro), labelled "First proof on NEAR testnet, 3 Nov 2026".

### 6. The follow-ups · 0:43–0:59 (16 s)

- **On screen:** the meeting's follow-ups. Recap → Send → the 5-second Undo empties → Sent. The designer's 5 USDC deposit → Approve → "Paying in…" → Paid, with the transaction hash. The 5,000 USDC payment shows "Held for your wallet"; click it and `/sign` opens in the browser (don't approve it).
- **On-screen text:** "Recap sent." · "5 USDC paid, within your caps." · "5,000 USDC held for your wallet."
- **Voice-over (36 words):** "It does what the call agreed, once you tap.[^tap] The recap goes out.[^recap] The deposit is paid in USDC, within caps a NEAR contract enforces.[^caps] Five thousand is over the cap: it waits for your wallet."[^hold]
- **Capture:** **Live session.** The recap through Aftercall ran live on 6 Nov[^recap6nov]; a payment from the Mac app and the over-cap hold have never run on testnet[^nopay]. This would be the first.
- **Fallback:** `/demo` → Sync with Ada's follow-ups: the designer's 50 USDC, the 5,000 held. The browser demo simulates the payment under the sample wallet's caps, so the label reads "Sample meeting · browser demo · simulated payment". If only the hold is missing (Qwen may not propose the 5,000), use the fallback for that shot alone.

### 7. Approve from your phone · 0:59–1:07 (8 s)

- **On screen:** an iPhone on `getaftercall.vercel.app/phone`, paired with the Mac: "Needs you" → Pay Kemi, 5 USDC, with the words from the call and "What leaves" → Approve → the 5-second Undo → done. Cut to the Mac: Kemi's payment is Paid.
- **On-screen text:** "Approve from your phone. Your Mac checks every tap."
- **Voice-over (18 words):** "Away from your desk? Approve from your phone. The Mac checks every tap again under the same caps."[^phone]
- **Capture:** **Live session.** The Mac app, the relay and a real phone haven't run together yet[^phonelive].
- **Fallback:** a real iPhone opening the link from `pnpm dev:phone -- --relay https://aftercall-api.vercel.app --web https://getaftercall.vercel.app` (the deployed relay and page, with a stand-in Mac), labelled "Phone page · stand-in Mac · sample items". Cut to the terminal line where the stand-in accepts the tap, not to the Mac app.

### 8. Hand an action item to Claude Code · 1:07–1:15 (8 s)

- **On screen:** the action item "Ship the API fix" → Hand to an agent → Open in Claude Code → Terminal opens in the project's code folder with `claude`, which claims the item; cut to the item showing it claimed, then "Done by Claude Code" with the link to the work.
- **On-screen text:** "Hand a task to Claude Code. Agents never send or pay."
- **Voice-over (15 words):** "Hand an action item to Claude Code. It claims it and links the finished work."[^agents]
- **Capture:** **Live session.** Hand to an agent and Open in Claude Code haven't run with the Mac app and a real Claude Code session[^agentslive].
- **Fallback:** a real Claude Code session against Aftercall's MCP server and its stand-in for the app, as recorded on 1 Nov[^agentsrun]: `node apps/mcp/scripts/demo.ts`, press Enter to allow claims, then `claude -p "List my Aftercall meetings, then claim the open action item about the API fix as Claude Code." --mcp-config <the config it prints> --strict-mcp-config --allowedTools "mcp__aftercall__*"`. Label: "Claude Code on Aftercall's MCP server · stand-in app · sample meetings". Voice-over unchanged.

### 9. The payoff: hang up, it's done · 1:15–1:24 (9 s)

- **On screen:** the meeting's follow-ups at rest: the recap Sent, the deposit Paid, the 5,000 Held for your wallet. Then two quick holds that say why to trust it: the Verify sheet's list of checks, and the Wallet's limits (daily and per-payment cap).
- **On-screen text:** "Recap sent · deposit paid · 5,000 waits for you." then "Attested every run.[^attest] Audio and text go only to the TEE.[^onlytee] The app's key can't change your caps."[^yocto]
- **Voice-over (18 words):** "Hang up, and it's done: recap sent, deposit paid, the big one waiting for you.[^payoff] Private, and provable."[^verify]
- **Capture:** the follow-ups from L6 if the live session got them, otherwise F3 with its label. The Verify sheet from this session's meeting if it was captured, otherwise the `/demo` Verify sheet labelled "Browser demo · test proof". Wallet from the Mac app on the testnet wallet set up on 3 Nov.

### 10. Close · 1:24–1:30 (6 s)

- **On screen:** the icon and "Aftercall"; under it the tagline, the link, and the credit line.
- **On-screen text:** "Aftercall" · "Private meeting notes that do the follow-ups." · "Try it in your browser: getaftercall.vercel.app/demo" · "Built at NEAR HACKATHON · @NEARProtocol" · small: "Mac test build · NEAR testnet"
- **Voice-over (12 words):** "Aftercall. Private meeting notes that do the follow-ups.[^tagline] Built at NEAR HACKATHON."[^built]
- **Capture:** today (the Remotion `Mark` scene with this copy; it currently reads "Built on NEAR AI · runs on NEAR testnet").

## Shot list for the recording session

### Before the session

Set up once, in this order. None of it is done by this doc.

1. **Mac:** the 7 Nov test build installed, dark mode, Do Not Disturb on, a clean desktop, screen recording at 2560×1440 (or 1920×1080). Only test accounts and test addresses on screen.
2. **NEAR AI:** Victor's own key in Settings → NEAR AI. Making notes is a live, paid NEAR AI run on that key, so it needs Victor's go-ahead.
3. **Payments on testnet** (README, "Full: a payment on testnet"): the testnet wallet from 3 Nov, with a per-payment cap of 10 USDC and a daily cap of 20 USDC set in the wallet on `/sign`; 20 test USDC from Circle's faucet, deposited; two payees on NEAR testnet, both accounts Victor holds, named "Designer" and "Kemi". (Kemi is on NEAR here, not Solana: 1Click has no testnet.)
4. **Project:** a project for the call, its brief listing the words "Kemi", "designer", "API fix" so Whisper spells them.
5. **Recap:** signed in with NEAR for Send through Aftercall; the recap goes to the other person on the call, with their OK.
6. **Phone:** an iPhone paired in Settings → Your phone (QR code, then the six-digit code). Its screen recorded with iOS screen recording.
7. **Claude Code:** Coding agents on, "Let agents claim and complete action items" on, Connect Claude Code. The project's code folder set to a throwaway git repo that has a small "API fix" to make, pushed somewhere public, so "done" can carry a real link.
8. **The other person:** someone who agrees to be recorded and to appear in a public video. Use their real first name in the call.

### The test call (about 90 s spoken)

Adapted from the sample meeting (`apps/desktop/src/sample.ts`), with amounts that fit the test caps. `[Name]` is the other person.

> **[Name]:** The API fix has to ship before the demo. If it slips, we move the demo, not the fix.
> **Victor:** Agreed. I'll send you the recap after this call.
> **Victor:** And I'll pay the designer the five dollar deposit today, and the full five thousand when the deck is done.
> **Victor:** Oh, and send Kemi the five dollars for the icons.
> **[Name]:** Great. I'll look out for the recap. Talk Friday.

Expect from the notes: an action item "Ship the API fix", a recap to [Name], a 5 USDC payment to Designer (within both caps), 5,000 USDC to Designer (over the per-payment cap, so held), 5 USDC to Kemi (left for the phone). The model decides what it proposes; if one is missing, use that beat's fallback.

### Shots, in order

| Shot | Beat | What to capture | App state needed | Live? |
| --- | --- | --- | --- | --- |
| L1 | 9 | Wallet → limits showing 10 / 20 USDC | Payments set up (step 3) | Today |
| L2 | 5 | nearblocks: the 3 Nov `record_proof` transaction | None | Today |
| L3 | 3 | Home → Record → record sheet with the tick → recording screen beside the call; stop when the call ends | Call app open with [Name] | Today, in session |
| L4 | 4 | Make notes → processing checks → Verified → meeting page; hover a quote | L3's recording; NEAR AI key | **Live** |
| L5 | 5, 9 | Verify sheet (list of checks) → Copy proof link → paste in a browser at `/verify` → checks re-run; then that meeting's `record_proof` on nearblocks | L4's notes and proof | **Live** |
| L6 | 6 | Follow-ups: Send recap (let the Undo run out) → Sent; Approve the 5 USDC deposit → Paid with hash; the 5,000 "Held for your wallet" → `/sign` opens (don't approve) | L4's follow-ups; 20 USDC deposited | **Live** |
| L7 | 7 | iPhone: Needs you → Pay Kemi 5 USDC → Approve → Undo runs out; then the Mac's follow-up flips to Paid | Phone paired; Kemi's payment still waiting | **Live** |
| L8 | 8 | "Ship the API fix" → Hand to an agent → Open in Claude Code → Terminal: Claude Code claims it, makes the fix, completes with the link → the item shows "Done by Claude Code" with the link | Agents on and connected; code folder set | **Live** |

### Fallback shots (record today, as insurance)

| Shot | For beat | What | Label on screen |
| --- | --- | --- | --- |
| F1 | 4 | `/demo`: the sample meeting's processing walk-through and notes, hover a quote | Sample meeting · browser demo · simulated run |
| F2 | 5, 9 | `/demo`: the Verify sheet on the test proof | Browser demo · test proof |
| F3 | 6 | `/demo`: Sync with Ada's follow-ups, the designer's 50 USDC approved, the 5,000 held | Sample meeting · browser demo · simulated payment |
| F4 | 7 | A real iPhone on the `pnpm dev:phone -- --relay …` link: approve, dismiss, the held payment opening `/sign`; the terminal accepting the tap | Phone page · stand-in Mac · sample items |
| F5 | 8 | Claude Code against `node apps/mcp/scripts/demo.ts`: read-only refusal, then the claim | Claude Code on Aftercall's MCP server · stand-in app · sample meetings |

## The 15-second cut for X

Made from the same shots; it plays muted first, so the text carries it.

| Time | Shot | On-screen text |
| --- | --- | --- |
| 0:00–0:03 | Beat 1, the upload bar | "Your calls go to servers you can't check." |
| 0:03–0:06 | L4 (or F1): Verified, then a quote under an item | "Notes made in NEAR AI's secure hardware. Every item quotes the call." |
| 0:06–0:10 | L6 (or F3): Paid, then Held for your wallet | "Recap sent. USDC paid within your caps. Over the cap, it waits for you." |
| 0:10–0:13 | L7 (or F4): Approve on the phone | "Approve from your phone." |
| 0:13–0:15 | Close card | "Aftercall · getaftercall.vercel.app · Built at NEAR HACKATHON" |

Voice-over, if sound is on (25 words): "Meeting notes, made in NEAR AI's secure hardware. Then the follow-ups: recap sent, USDC paid within your caps, anything over held for your wallet. Aftercall."

## X post (DRAFT, for Victor to approve)

Not posted. 278 characters with the full link (X counts any link as 23, so 270).

> Aftercall: private meeting notes that do the follow-ups.
>
> Notes made in NEAR AI's secure hardware, a proof on @NEARProtocol, then the recap sent and USDC paid within your caps. Mac test build, NEAR testnet.
>
> Built at NEAR HACKATHON #NEARHackathon
> https://getaftercall.vercel.app

If the testnet payment wasn't captured live, the video shows the labelled browser demo for it; the post still describes what the app does, which is tested on a local NEAR node[^nopay], so post it only once Victor is happy with that.

## Sources

Every spoken claim, and where the repo says it.

[^problem]: README.md, the first line; docs/judging.md, the first paragraph. Said of meeting notes apps in general; no product is named.
[^promise]: README.md, "Aftercall is private meeting notes that do the follow-ups" and "What it does" 2 and 4. "Does what they agreed" happens once you approve, or under autopilot rules you set (README, "Follow-ups: what leaves, who approves, what's kept").
[^nobot]: README.md, "What it does" 1: "Your mic and the call's audio, from any app. No bot joins the call."
[^sealed]: docs/how-it-works.md, "Encrypted on this Mac": "Audio is sealed about once a second while recording." The audio later goes to NEAR AI's Whisper TEE over TLS pinned to the gateway's attested key, and is deleted once the notes are saved (same section, and "End-to-end encrypted summaries").
[^attest]: docs/judging.md, "Claims, code and tests", row 1: nothing leaves the Mac unless the gateway and model TEEs pass attestation; README.md, "What it does" 2: "checked on every run". Code: `packages/core/src/tee/checks.ts`, `packages/core/src/notes/pipeline.ts`.
[^e2ee]: README.md, "Built on NEAR's newest", the E2EE row: "the transcript encrypted to the attested model's key, or not sent"; docs/judging.md, row 2. Audio isn't end-to-end encrypted (docs/judging.md, "Known limits"), which is why the line says "transcript".
[^quotes]: README.md, "What it does" 2: "Any item without an exact quote from the call is dropped"; docs/judging.md, row 4. Code: `packages/core/src/notes/build.ts`.
[^live3nov]: README.md, "Live today": notes from a real call on live NEAR AI, proof on NEAR, done 3 Nov (a private meeting).
[^proof]: README.md, "Follow-ups: what leaves…", last paragraph: the proof on NEAR holds "the recording's start time, a hash and the model name, never the meeting itself".
[^verify]: README.md, "What it does" 3: "anyone you share the proof link with can re-run the checks in a browser at `/verify`". docs/how-it-works.md: `/verify` re-checks what a browser can and labels the rest "as recorded by the app".
[^nolink]: README.md, "How to test", 1 minute, and "Live today": a sample meeting's public proof link is "Not yet".
[^tap]: README.md, "What it does" 4: "An agreed USDC payment is made after one tap"; the recap and payment rows of "Follow-ups: what leaves…" ("You tap Send", "You tap Approve").
[^recap]: README.md, "Follow-ups: what leaves…", the Send through Aftercall row.
[^recap6nov]: README.md, "Live today": recap email sent through Aftercall (Resend), done 6 Nov; docs/proven.md.
[^caps]: docs/judging.md, row "Payments go only to listed payees within a daily and a per-payment cap…". Code: `contracts/agent-wallet/src/lib.rs`; sandbox tests `over_cap_is_blocked_then_owner_approves`, `per_payment_cap_parks_big_single_payments`.
[^hold]: README.md, "What it does" 4: "anything over a cap waits for your own wallet"; the "Payment over a cap" row: only your own NEAR wallet, on `/sign`, can approve or decline it.
[^nopay]: README.md, "Live today": "A payment, and the $5,000 hold, on testnet · Not yet"; docs/judging.md, "Known limits", first item: tested on a local NEAR node.
[^phone]: README.md, "Follow-ups: what leaves…", the Approving from your phone row: "The Mac checks each tap again and runs its own button under the same rules and caps." Tests: `mac.test.ts` (docs/judging.md, last row).
[^phonelive]: README.md, "Live today", the phone row; docs/design/phone.md, Status; docs/proven.md, "Built since, not yet run live (7 Nov)".
[^agents]: README.md, "What it does" 5: Claude Code "claims an item, marks it done with a link to the work". The link is the agent's own word; Aftercall keeps only a plain http or https link (docs/judging.md, the "Done" row).
[^agentslive]: README.md, "Live today", the coding agents row; docs/judging.md, "Known limits"; docs/proven.md, "Built since, not yet run live (7 Nov)".
[^agentsrun]: docs/agents-demo.md: Claude Code 2.1.314 against the MCP server and its stand-in for the app, 1 Nov 2026.
[^onlytee]: docs/how-it-works.md, "Privacy in detail": "Meeting audio and text go only to NEAR AI Cloud's Confidential TEE models, and only after their attestation passes." What you choose to send yourself (a recap, a payment, an export, what connected coding agents read) is listed in README.md, "Follow-ups: what leaves…", and docs/privacy.md.
[^payoff]: The outcomes of beat 6, with the same sources: the recap, the deposit paid within the caps, and the over-cap hold. If beat 6 used the fallback, so does this shot, with its label.
[^yocto]: docs/judging.md, row "The app's NEAR key can only call `pay`, `record_proof`, `open_escrow` and `release_escrow`; rule changes need 1 yoctoNEAR, which that key can't attach". Sandbox tests `limited_key_cannot_change_rules`, `one_yocto_rule_holds_even_if_key_lists_owner_methods`.
[^tagline]: README.md, the bold line under the title.
[^built]: README.md says "Built for NEAR HACKATHON (1–14 Nov 2026)". Planning docs start on 24 Oct and code on 26 Oct, after the 19 Oct announcement; the FAQ counts code from then (Q-001; README.md, "Built with"). Victor to confirm "Built at" before recording.
