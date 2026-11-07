# Design: coding agents and the meeting's follow-ups

Status: a design, not built. What exists today is listed first.

## Today

Coding agents (Claude Code, Codex) reach Aftercall through its MCP server, only through the running app, and only when you turn them on. They have six tools: `list_meetings`, `get_meeting`, `search`, `list_action_items`, `claim_action_item` and `complete_action_item`. Claiming and completing need a second switch. Agents can never send, pay or change your rules, and every request is in a sealed activity list on the Mac.

So an agent can find "Ship the API fix", claim it, do the work, and mark it done with a note. What's missing: you have to tell the agent to look, the "done" carries no proof of the work, the people on the call never hear about it, and the agent can't help with the follow-ups themselves.

## Five additions, smallest first

### 1. Hand an item to an agent

A **Hand to an agent** button on each action item. It copies a ready prompt for Claude Code or Codex: "Using the aftercall MCP server, claim action item a2 in meeting 1761000000 (Ship the API fix, due Friday). When it's done, complete it with a link to the work." The agent starts with the right item and context, without searching. The button says which switches are off, if any.

Size: small, desktop only.

### 2. Done, with evidence

`complete_action_item` takes an optional `link` (a pull request, commit or document) besides the note. The item shows "Done by Claude Code · PR #42", the meeting's "Where this meeting went" lists it, and the recap can say it: "Ship the API fix · done by Claude Code (link)". The link is the agent's statement, labelled as such, like your notice: Aftercall doesn't check what's behind it.

Size: small to medium (the MCP tool, the Rust request, the item view, the recap).

### 3. Agents draft, you send

A new tool, `draft_follow_up`, lets an agent propose a follow-up the meeting didn't produce, for example "Send Olamide the staging DNS" after it finished that item. It lands in the meeting's follow-ups as **Proposed by Codex**, never as if it came from the call:

- it shows the agent's reason in place of a transcript quote, and says so;
- it never runs on autopilot;
- a payment can only go to a payee already on your list, within your caps, and still needs your tap;
- Dismiss removes it, and the activity list keeps that it was proposed.

This keeps the rule that the call is the only source of what Aftercall does on its own, while letting agents help with the paperwork.

Size: medium. Needs care: it's the first time an agent can put something in front of the Approve button.

### 4. Agents only where you say

Access per project: "Let agents read: General, Fundraise" in place of all meetings. An agent asking for another project's meeting is refused by name, like the write switch today. Useful when a client project shouldn't reach a coding agent at all.

Size: medium (settings, the Rust checks, tests).

### 5. Paid work for agents (later)

For agents that work for others: an item can carry a price ("Write the landing copy · 30 USDC"). When the agent completes it with evidence, a payment to the agent's NEAR account is proposed, held for your approval and paid under the same caps. Nothing pays itself. This is where Aftercall meets the agent economy track, but it needs 1 to 3 first and real thought about disputes, so it comes last.

## What doesn't change

- Agents never send, pay or change rules on their own.
- Every agent action is in the sealed activity list, with names, times and ids, never meeting content.
- Your notes and the proof's notice never reach an agent.

## Order

1 and 2 first (a day together, and they make the agent flow visible in the demo). Then 3, then 4. Then 5, after the hackathon.
