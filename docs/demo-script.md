# Demo video: the 1:45 script

The hackathon demo for NEAR HACKATHON. It goes on the submission, on the public X post, and in front of the jury, so it has to say why someone would want Aftercall and what the secure hardware, the proof on NEAR and the contract do for them, not only show its screens.

Status (7 Nov 2026): rewritten and approved by Victor; built as a review cut (`DemoReview` in `~/Developer/projects/aftercall-launch-video`). Nothing is posted yet. The X post at the end is a DRAFT for Victor to approve before anything goes out.

## What it has to sell

- **Who it's for:** founders and freelancers who agree work and payments on calls (the landing page's own line, `apps/web/app/landing/Hero.tsx`).
- **The problem, felt:** a call holds private things (pay, a client's numbers, money promised); meeting notes apps send it to servers you can't check, and the follow-ups still wait on you.
- **The one idea:** "Don't trust it. Check it." Private because the hardware is checked first; provable because a fingerprint goes on NEAR; done because the follow-ups run within limits a contract enforces.
- **What to do next:** getaftercall.vercel.app, on screen at the close.

## Rules for this video

- **Every spoken line is true today.** Each one has a footnote pointing to the doc that says it ([Sources](#sources)). Never say the audio is end-to-end encrypted: the transcript is; the audio goes over TLS pinned to the attested gateway.
- **Nothing is shown as live unless it ran live.** Shots that show an event (a payment, the hold, a proof, a phone tap, an agent's work in the app) are **live slots** (L1–L8 below), filled from the live session. Until a slot has its clip, the render is a review cut: the browser demo's footage stands in, a small dot and the slot id sit in the corner, and the cut is not posted.
- **Interface shots that imply no event carry no label** (browsing notes, a quote, the transcript, the checks list). Explainer graphics show how it works, not a recorded run; where one shows real data (the 3 Nov `record_proof`), it says so.
- **Test money says so.** The close carries "Mac test build · NEAR testnet".
- **Waits are cut, not sped up.** NEAR AI, NEAR and the phone's 10-second check all take time; cut the wait and keep the UI at real speed.
- **No numbers we can't source,** no competitor names; "meeting note apps" stays generic.

## At a glance

Voice-over: 222 words in 1:45, about 2.1 a second (the problem beat runs quicker, 3.2). The captions are the voice-over, one idea at a time, so it works muted. `out/vo-script.txt` in the video project has every line with its start time, for recording to picture.

| # | Time | Beat | Words |
| --- | --- | --- | --- |
| 1 | 0:00–0:06 | Hook: what was on your last call | 15 |
| 2 | 0:06–0:16 | Problem: their servers, then the to-dos | 31 |
| 3 | 0:16–0:21 | Promise: don't trust it, check it | 13 |
| 4 | 0:21–0:28 | Record, no bot | 9 |
| 5 | 0:28–0:42 | Why private: the sealed hardware | 37 |
| 6 | 0:42–0:48 | Trust the notes: every item quotes the call | 12 |
| 7 | 0:48–0:58 | Why NEAR: a fingerprint anyone can check | 27 |
| 8 | 0:58–1:14 | Follow-ups, within the contract's limits | 37 |
| 9 | 1:14–1:23 | Approve from your phone | 15 |
| 10 | 1:23–1:33 | Hand a task to Claude Code | 18 |
| 11 | 1:33–1:40 | Private. Provable. Done. | 3 |
| 12 | 1:40–1:45 | Close | 5 |

## The script

### 1. Hook · 0:00–0:06

- **On screen:** a video call, four tiles; three things said on it appear as speech over the tiles and light up: a salary, a client's numbers, a payment promised. Drawn, not any real call.
- **Voice-over:** "Your last call had a salary in it. A client's numbers. A payment you promised."[^stakes]

### 2. Problem · 0:06–0:16

- **On screen:** "Uploading your call…"; the audio flies to a generic server stack labelled "Their servers · “Trust us.”", a question mark on it; then the to-do card going stale, "FRIDAY · STILL OPEN". No brand names.
- **Voice-over:** "Meeting note apps upload all of it to their servers. You're trusting a promise you can't check. And when the call ends, the work starts: the recap, the payment, the to-dos."[^problem]

### 3. Promise · 0:16–0:21

- **On screen:** the icon and "Aftercall", "Private meeting notes that do the follow-ups."; then the big line "Don't trust it. Check it."
- **Voice-over:** "Aftercall: private meeting notes that do the follow-ups.[^tagline] Don't trust it. Check it."[^verify]

### 4. Record · 0:21–0:28 · slot L3

- **On screen:** the app: Record → the sheet with "I've told everyone on the call" ticked → recording, notes typed.
- **Voice-over:** "Record any call on your Mac. No bot joins."[^nobot]

### 5. Why private: the sealed hardware · 0:28–0:42 · slot L4 for the footage

- **On screen:** an explainer that builds with the line: your Mac and a sealed box, "Sealed hardware · TEE · NEAR AI Cloud", chips "Intel TDX" and "NVIDIA GPU"; a dashed line "Attestation: is this hardware genuine?" → the stamp "✓ Attestation checked"; then a locked "Transcript" packet, "encrypted to the attested model's key", into the box, and the notes back. Then the app's own checks ticking to "notes ready".
- **Voice-over:** "The notes are made inside sealed hardware on NEAR AI Cloud. Before a word leaves your Mac, the app checks the hardware is genuine,[^attest] and the transcript is encrypted so only the model inside can read it."[^e2ee]

### 6. Trust the notes · 0:42–0:48 · slot L4b

- **On screen:** hover an item: its quote opens under it; jump to the transcript line, lit.
- **Voice-over:** "Every item quotes the call, word for word. No quote, no item."[^quotes]

### 7. Why NEAR: a fingerprint · 0:48–0:58 · slot L5 for the footage

- **On screen:** an explainer: "Your notes" (they stay on your Mac) → a fingerprint, `8f19a214d417681e…` → "On NEAR": the real 3 Nov `record_proof` (block 276,039,504, its `meeting_id`, `proof_hash` and `model`), and "transcript · notes · audio: never on chain"; labelled "The first proof on NEAR testnet, 3 Nov 2026". Then the Verify sheet's checks, down to "Notes unchanged since signing".
- **Voice-over:** "A fingerprint of the meeting goes on NEAR. Never the meeting itself.[^proof] Share the link, and anyone can check the notes were made privately and weren't changed."[^verify]

### 8. Follow-ups, within the contract's limits · 0:58–1:14 · slots L6, L6b, L1, L6h

- **On screen:** the recap Sent, and the email as Ada receives it (Aftercall's recap template); Approve the deposit → Paying in… → Paid; the wallet's limits with a card "The NEAR contract enforces: Listed payees only · Daily cap · Per-payment cap · Only your own wallet can change them"; the 5,000 "Over your caps" → the wallet's "Waiting for you", with "Over a cap? It waits for your own wallet."
- **Voice-over:** "Then it does what the call agreed.[^tap] The recap goes out.[^recap] Payments go out in USDC from a NEAR contract, within limits you set.[^caps] The app's key can't break them.[^yocto] Anything bigger waits for your own wallet."[^hold]

### 9. Approve from your phone · 1:14–1:23 · slots L7m, L7, L7b

- **On screen:** the Mac's Pair a phone (QR code); the iPhone opens it; the same six digits on both screens (one real pairing through the deployed relay); They match; Pay Kemi → Approve → the Undo; the Mac: "Paid Kemi · Approved on your phone".
- **Voice-over:** "Away from your desk? Approve from your phone, end-to-end encrypted.[^phonee2ee] Your Mac checks every tap."[^phone]

### 10. Hand a task to Claude Code · 1:23–1:33 · slots L8, L8b

- **On screen:** "Ship the API fix" → Hand to an agent; a terminal drawn from a real Claude Code run (7 Nov) on Aftercall's MCP server and its stand-in app: claim, read the code, fix, a refused command and the retry, a local commit, `complete_action_item` with the link, `draft_follow_up`; then the app: "Done by Claude Code" with the link, and the recap it proposed waiting for a tap.
- **Voice-over:** "Hand a task to Claude Code. It does the work and links it.[^agents] Agents never send or pay."[^agentsnever]

### 11. Private. Provable. Done. · 1:33–1:40

- **On screen:** three words, each with its line: "Sealed hardware, checked every run." · "A proof on NEAR anyone can check." · "Follow-ups within limits a contract enforces."
- **Voice-over:** "Private. Provable. Done."[^attest] [^verify] [^caps]

### 12. Close · 1:40–1:45

- **On screen:** the icon and "Aftercall", the tagline, getaftercall.vercel.app, "Built at NEAR HACKATHON · @NEARProtocol", small "Mac test build · NEAR testnet".
- **Voice-over:** "Aftercall. Built at NEAR HACKATHON."[^built]

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
| L1 | 8 | Wallet → limits showing 10 / 20 USDC | Payments set up (step 3) | Today |
| L2 | 7 | nearblocks: the 3 Nov `record_proof` transaction | None | Today |
| L3 | 4 | Home → Record → record sheet with the tick → recording screen beside the call; stop when the call ends | Call app open with [Name] | Today, in session |
| L4 | 5, 6 | Make notes → processing checks → Verified → meeting page; hover a quote | L3's recording; NEAR AI key | **Live** |
| L5 | 7 | Verify sheet (list of checks) → Copy proof link → paste in a browser at `/verify` → checks re-run; then that meeting's `record_proof` on nearblocks | L4's notes and proof | **Live** |
| L6 | 8 | Follow-ups: Send recap (let the Undo run out) → Sent; Approve the 5 USDC deposit → Paid with hash; the 5,000 "Held for your wallet" → `/sign` opens (don't approve) | L4's follow-ups; 20 USDC deposited | **Live** |
| L7 | 9 | Settings → Your phone → Pair a phone (QR) → the iPhone opens it → the same six digits on both → They match; then the iPhone: Needs you → Pay Kemi 5 USDC → Approve → Undo runs out; then the Mac's follow-up flips to Paid | Phone paired; Kemi's payment still waiting | **Live** |
| L8 | 10 | "Ship the API fix" → Hand to an agent → Open in Claude Code → Terminal: Claude Code claims it, makes the fix, completes with the link → the item shows "Done by Claude Code" with the link | Agents on and connected; code folder set | **Live** |

### Fallback shots (record today, as insurance)

| Shot | For beat | What | Label on screen |
| --- | --- | --- | --- |
| F1 | 5, 6 | `/demo`: the sample meeting's processing walk-through and notes, hover a quote | Sample meeting · browser demo · simulated run |
| F2 | 7 | `/demo`: the Verify sheet on the test proof | Browser demo · test proof |
| F3 | 8 | `/demo`: Sync with Ada's follow-ups, the designer's 50 USDC approved, the 5,000 held | Sample meeting · browser demo · simulated payment |
| F4 | 9 | A real iPhone on the `pnpm dev:phone -- --relay …` link: approve, dismiss, the held payment opening `/sign`; the terminal accepting the tap | Phone page · stand-in Mac · sample items |
| F5 | 10 | Claude Code against `node apps/mcp/scripts/demo.ts`: done 7 Nov (`scripts/agents-run.sh` in the video project): claim, fix, local commit, complete with a link, a proposed recap | A real Claude Code run, 7 Nov · Aftercall's MCP server and its stand-in app |

## The 15-second cut for X

The new opening and the three words; it plays muted first, so the text carries it.

| Time | Shot | On-screen text |
| --- | --- | --- |
| 0:00–0:06 | Beat 1, the call and what was said on it | "Your last call had a salary in it." · "A client's numbers." · "A payment you promised." |
| 0:06–0:12 | Beat 11 | "Private." "Sealed hardware, checked every run." · "Provable." "A proof on NEAR anyone can check." · "Done." "Follow-ups within limits a contract enforces." |
| 0:12–0:15 | Close card | "Aftercall · getaftercall.vercel.app · Built at NEAR HACKATHON · @NEARProtocol" |

Voice-over, if sound is on (18 words): "Your last call had a salary in it. A client's numbers. A payment you promised. Private. Provable. Done."

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
[^promise]: README.md, "Aftercall is private meeting notes that do the follow-ups" and "What it does" 2 and 4. "Does what they agreed" happens once you approve (recaps to your own team can also go by autopilot rules you set) (README, "Follow-ups: what leaves, who approves, what's kept").
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
[^stakes]: An illustration of what calls hold, not a claim about any product; the people and numbers are made up.
[^phonee2ee]: README.md, "Claims, code and tests": "The phone sees only what approving needs, sealed so the relay can't read it"; the phone page itself: "What waits for you travels sealed between your Mac and this phone. Aftercall's relay passes the sealed boxes on and can't read them." Design: docs/design/phone-protocol.md.
[^agentsnever]: README.md, "Claims, code and tests": an agent's follow-up "waits for your tap: never autopilot, never the phone"; the app's Coding agents screen: agents can't "Send email or recaps, or approve their own proposals" or "Pay, or touch the agent wallet". The 7 Nov run: `out/agents-run.jsonl` in the video project (claim, complete with a link, a proposed recap that waits for approval).
