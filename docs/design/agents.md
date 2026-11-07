# Design: coding agents and the meeting's follow-ups

Status: 1 to 4 are built, and so is Open in Claude Code, which grew out of 1; each section below says where the built version differs from this design. What they do and the tests for them are in [agents-demo.md](../agents-demo.md#what-changed-since-the-run), the claims with exact test names in [proven.md](../proven.md). 5 is not built. None of 1 to 4 has run with the Mac app and a real Claude Code or Codex session yet. "Today" below is what existed before them.

## Today

Coding agents (Claude Code, Codex) reach Aftercall through its MCP server, only through the running app, and only when you turn them on. They have six tools: `list_meetings`, `get_meeting`, `search`, `list_action_items`, `claim_action_item` and `complete_action_item`. Claiming and completing need a second switch. Agents can never send, pay or change your rules, and every request is in a sealed activity list on the Mac.

So an agent can find "Ship the API fix", claim it, do the work, and mark it done with a note. What's missing: you have to tell the agent to look, the "done" carries no proof of the work, the people on the call never hear about it, and the agent can't help with the follow-ups themselves.

## Five additions, smallest first

### 1. Hand an item to an agent (built)

A **Hand to an agent** button on each action item. It copies a ready prompt for Claude Code or Codex: "Using the aftercall MCP server, claim action item a2 in meeting 1761000000 (Ship the API fix, due Friday). When it's done, complete it with a link to the work." The agent starts with the right item and context, without searching. The button says which switches are off, if any.

Size: small, desktop only.

Built: on each open action item, on the meeting page and on Action items, for Claude Code or Codex (`packages/core/src/agents/handoff.ts`). The prompt quotes the item's words between `<<<meeting-data` and `meeting-data>>>`, one JSON-quoted line each, and tells the agent they are data, not instructions. Added: **Open in Claude Code**, for a project with a code folder, opens Terminal there and starts `claude` with the prompt, read from a private file so meeting text is never part of a shell command (`open_in_claude_code`, `apps/desktop/src-tauri/src/agents.rs`).

### 2. Done, with evidence (built)

`complete_action_item` takes an optional `link` (a pull request, commit or document) besides the note. The item shows "Done by Claude Code · PR #42", the meeting's "Where this meeting went" lists it, and the recap can say it: "Ship the API fix · done by Claude Code (link)". The link is the agent's statement, labelled as such, like your notice: Aftercall doesn't check what's behind it.

Size: small to medium (the MCP tool, the Rust request, the item view, the recap).

Built as designed, with a plain http or https link of at most 300 characters (`packages/core/src/agents/work.ts`). A recap says what agents finished only when Settings → Recaps → "Say what coding agents finished" is on; it is off by default.

### 3. Agents draft, you send (built)

A new tool, `draft_follow_up`, lets an agent propose a follow-up the meeting didn't produce, for example "Send Olamide the staging DNS" after it finished that item. It lands in the meeting's follow-ups as **Proposed by Codex**, never as if it came from the call:

- it shows the agent's reason in place of a transcript quote, and says so;
- it never runs on autopilot;
- a payment can only go to a payee already on your list, within your caps, and still needs your tap;
- Dismiss removes it, and the activity list keeps that it was proposed.

This keeps the rule that the call is the only source of what Aftercall does on its own, while letting agents help with the paperwork.

Size: medium. Needs care: it's the first time an agent can put something in front of the Approve button.

Built with the same switch as claiming, at most five proposals waiting per meeting, and at most 20 from agents in a meeting in all. Differences: a payment must also fit your per-payment cap and what's left today as the app last read them from the contract, and with no per-payment cap set agents propose no payments; a proposal never reaches the phone; Dismiss hides it but keeps it in `notes.json`, marked dismissed, and the five-waiting limit counts only the ones still waiting, while the limit of 20 counts dismissed ones too, so an agent can't keep adding them.

### 4. Agents only where you say (built)

Access per project: "Let agents read: General, Fundraise" in place of all meetings. An agent asking for another project's meeting is refused by name, like the write switch today. Useful when a client project shouldn't reach a coding agent at all.

Size: medium (settings, the Rust checks, tests).

Built as Coding agents → "Projects agents can reach": every project (the default) or the ones you tick. One difference: a request for a meeting in another project is refused without naming its project, so the refusal doesn't tell an agent what exists. Open in Claude Code starts nothing for such a meeting, and Hand to an agent offers no prompt for it.

### 5. Paid work for agents (later; not built)

For agents that work for others: an item can carry a price ("Write the landing copy · 30 USDC"). When the agent completes it with evidence, a payment to the agent's NEAR account is proposed, held for your approval and paid under the same caps. Nothing pays itself. This is where Aftercall meets the agent economy track, but it needs 1 to 3 first and real thought about disputes, so it comes last.

## What doesn't change

- Agents never send, pay or change rules on their own.
- Every agent action is in the sealed activity list, with names, times and ids, never meeting content.
- Your notes and the proof's notice never reach an agent.

## Order

1 and 2 first (a day together, and they make the agent flow visible in the demo). Then 3, then 4. Then 5, after the hackathon.
