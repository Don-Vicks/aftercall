# Claude Code on Aftercall's MCP server: a recorded run

Run on 1 November 2026 (16:46 and 16:47 UTC) with Claude Code 2.1.314, headless, against Aftercall's MCP server as the app ships it (`apps/mcp/dist/aftercall-mcp.mjs`). The other end of the socket was the server's test stand-in for the app (`apps/mcp/src/fixture.ts`), not the Mac app and not a real meeting library. The stand-in speaks the same line protocol and applies the same rules: the token check, read-only until the user allows writes, and the claim rules. The app's own version of those rules, with encryption, locking and the activity list, is tested in Rust (`cargo test agents` in `apps/desktop/src-tauri`). The two meetings in it are sample data.

The stand-in has changed since this run: Sync with Ada's second item is now one the user edited, so a run today lists "Share the signed term sheet" with an `edited` field where the output below says "Share the term sheet". The server has also gained a seventh tool, `draft_follow_up`, a `link` on `complete_action_item`, and the user's choice of projects agents can reach (see [What changed since the run](#what-changed-since-the-run)); none of those were part of this run.

Below are the exact commands and Claude Code's text output, unedited.

## Setup

```sh
pnpm install
pnpm --filter @aftercall/mcp build     # writes apps/mcp/dist/aftercall-mcp.mjs
node apps/mcp/scripts/demo.ts           # starts the stand-in, read-only
```

`demo.ts` printed:

```text
Stand-in for the Aftercall app, read-only (press Enter to let agents claim and complete)
socket: /var/folders/rc/2_0y02ys3739xj2dswtrwh800000gn/T/ac-mcp-8tA7Va/agents.sock
token:  <64 hex characters, redacted here>
MCP config for Claude Code: /var/folders/rc/2_0y02ys3739xj2dswtrwh800000gn/T/ac-mcp-8tA7Va/mcp-config.json
```

The token belonged to that throwaway stand-in, which is gone; it is redacted so secret scanners don't flag it. The MCP config it wrote runs the bundled server with that socket and token:

```json
{
  "mcpServers": {
    "aftercall": {
      "command": "node",
      "args": ["<repo>/apps/mcp/dist/aftercall-mcp.mjs", "--socket", "/var/folders/rc/2_0y02ys3739xj2dswtrwh800000gn/T/ac-mcp-8tA7Va/agents.sock"],
      "env": { "AFTERCALL_TOKEN": "<the token above>" }
    }
  }
}
```

## Session 1: agents read only

```sh
claude -p "List my Aftercall meetings, then claim the open action item about the API fix as Claude Code." \
  --mcp-config /var/folders/rc/2_0y02ys3739xj2dswtrwh800000gn/T/ac-mcp-8tA7Va/mcp-config.json \
  --strict-mcp-config --allowedTools "mcp__aftercall__*" --max-turns 8 --output-format text
```

Claude Code's output:

```text
I listed your meetings, but I couldn't claim the API fix item. Aftercall only lets agents read right now, so I didn't try the claim.

**Meetings**

| Meeting | Project | Date | Open items | Follow-ups to approve |
|---|---|---|---|---|
| Team standup | General | Oct 22, 2026 | 2 | 0 |
| Sync with Ada | Fundraise | Oct 21, 2026 | 2 | 1 |

**Open action items**
- Team standup: "Write the release notes" (Sam)
- Team standup: **"Ship the API fix" (You)** — the item you want claimed
- Sync with Ada: "Send Ada the pilot plan" (You, due Friday)
- Sync with Ada: "Share the term sheet" (Ada)

To let me claim it, turn on "Let agents claim and complete action items" in Aftercall under **Coding agents** in the sidebar. Tell me once it's on and I'll claim "Ship the API fix" as Claude Code.
```

What the stand-in saw (`demo.ts` prints each request; ids and names only):

```text
  2026-11-01T16:46:43.446Z  claude-code  meetings  allowed
  2026-11-01T16:46:43.449Z  claude-code  projects  allowed
  2026-11-01T16:46:43.513Z  claude-code  meetings  allowed
  2026-11-01T16:46:43.513Z  claude-code  access  allowed
```

Claude Code read the meetings, saw `canClaim: false` in `list_action_items` and did not send the claim. Nothing was written. A claim sent while agents are read-only is refused with "Aftercall lets agents read only. To let them claim and complete action items, turn that on in Settings → Connected agents."; that path is covered by `apps/mcp/src/stdio.test.ts` (through the MCP server) and by the Rust tests (in the app), not by this run.

## Session 2: claiming allowed

Pressing Enter in `demo.ts` turned on the stand-in's equivalent of "Let agents claim and complete action items" (it printed `Now agents may claim and complete action items.`). Then the same command:

```sh
claude -p "List my Aftercall meetings, then claim the open action item about the API fix as Claude Code." \
  --mcp-config /var/folders/rc/2_0y02ys3739xj2dswtrwh800000gn/T/ac-mcp-8tA7Va/mcp-config.json \
  --strict-mcp-config --allowedTools "mcp__aftercall__*" --max-turns 8 --output-format text
```

Claude Code's output:

```text
I claimed "Ship the API fix" (from Team standup) as Claude Code, at 2026-11-01 16:47 UTC. It will show as claimed in Aftercall. I haven't started the fix itself.

**Your Aftercall meetings, newest first**

| Meeting | Project | Date | Open items | Follow-ups to approve |
|---|---|---|---|---|
| Team standup | General | Oct 22 | 2 | 0 |
| Sync with Ada | Fundraise | Oct 21 | 2 | 1 |

**Open action items**
- Team standup:
  - Write the release notes (Sam)
  - **Ship the API fix (You)** — now claimed by Claude Code
- Sync with Ada:
  - Send Ada the pilot plan (You, due Friday)
  - Share the term sheet (Ada)

Sync with Ada also has one follow-up waiting for your approval in the Aftercall app.

The action item doesn't say which API or repo the fix is for, and this folder isn't a git repository. If you tell me where the code is and what's broken, I'll make the fix and then mark the item complete.
```

What the stand-in saw:

```text
  2026-11-01T16:47:05.926Z  claude-code  meetings  allowed
  2026-11-01T16:47:05.927Z  claude-code  projects  allowed
  2026-11-01T16:47:05.971Z  claude-code  meetings  allowed
  2026-11-01T16:47:05.972Z  claude-code  access  allowed
  2026-11-01T16:47:08.104Z  Claude Code  claim 1761100000/a2  allowed
```

Reads carry the MCP client's own name (`claude-code`); the claim carries the agent name Claude Code chose to give.

## Try it with the real app

This part was not recorded; it is the same server, pointed at the Mac app instead of the stand-in. It needs Node 20 or later and the `claude` CLI. Open Aftercall and open Coding agents in the sidebar. Until an agent has reached Aftercall, the screen shows three steps, and each one ticks when it's done:

1. **Let agents read your meetings.** Turn the switch on. A token is made and the local channel opens. Agents can now read your processed meetings, and nothing else. To let them claim and complete action items, and propose follow-ups for you to approve, turn on "Let agents claim and complete action items" in the card below the steps; leave it off to keep them read-only.
2. **Connect Claude Code.** Press the button. Aftercall finds the `claude` CLI (in `~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin`, then your login shell's PATH) and a Node 20 or later the same way, then runs, for every project:

   ```sh
   claude mcp remove --scope user aftercall          # replaces an older entry; fails harmlessly when there is none
   claude mcp add --scope user aftercall --env AFTERCALL_TOKEN=<token> -- <full path to node> <Aftercall.app>/Contents/Resources/mcp/aftercall-mcp.mjs --data-dir ~/Library/Application\ Support/dev.aftercall.app
   ```

   The screen then says "Claude Code can now reach Aftercall. Start a new Claude Code session to use it.", or shows Claude Code's error with the token taken out. If Aftercall can't find `claude`, it shows the same command to copy and run in Terminal; "Or run the command yourself" shows it too. "Disconnect Claude Code" runs the `claude mcp remove` line.
3. **Try it.** Start a new Claude Code session in any folder and ask the prompt shown there (Copy puts it on the clipboard): "Using the aftercall MCP server, list my recent meetings and the open action items." Or headless:

   ```sh
   claude -p "Using the aftercall MCP server, list my recent meetings and the open action items." \
     --allowedTools "mcp__aftercall__*" --max-turns 8 --output-format text
   ```

Once a request reaches Aftercall with the current token, the steps give way to "Connected · Last request 2 min ago from Claude Code", with the switch and Disconnect. Each read, claim, completion and proposal, and every refused request, shows under "Recent agent activity" on the same screen. Allowed lookups of project names and of the write switch come with other requests and aren't listed. A claim shows on the meeting's action item. For Codex, "Using Codex?" holds the block for `~/.codex/config.toml`.

The token stays the same when Aftercall restarts, so the entry in Claude Code keeps working. Turning agents off closes the local channel and forgets the token; turning them on again makes a new one, and agents start read-only again. A new token does the same. Either way Claude Code still has the old token, so the screen shows "Reconnect Claude Code", and a request that arrives with the old token is refused and listed. Moving Aftercall to another folder also needs Connect (or the command) again.

How this was checked (2 November 2026, Claude Code 2.1.316): the Rust tests (`cargo test agents`) cover where the CLI and Node are looked for, the Node version check, the exact arguments, remove-then-add against a stand-in `claude`, and that an error never carries the token. Once, by hand and not in the test suite, the same code ran against the real `claude` with `HOME` set to an empty temporary folder: `claude mcp list` there showed `aftercall: /opt/homebrew/bin/node …/aftercall-mcp.mjs --data-dir … - ✔ Connected` against a live socket, Disconnect removed it, and the folder was deleted. Before this change the copy command put `aftercall` after `--env`, which takes several values, and Claude Code 2.1.316 refused it ("Invalid environment variable format"); the name now comes first.

## What changed since the run

Not recorded with Claude Code; each part is covered by the tests named.

- **Hand to an agent.** Each open action item, on the meeting page and on Action items, has a button that copies a prompt for Claude Code or Codex naming the meeting id, the item id, its text, owner and due date. The item's words go between `<<<meeting-data` and `meeting-data>>>`, one JSON-quoted line per field, and the prompt tells the agent they are data, not instructions. The menu says which switch would refuse the claim. Code: `packages/core/src/agents/handoff.ts`; tests: `handoff.test.ts`.
- **Open in Claude Code.** When a project has a code folder (set on its project page, sealed in `projects.json`), the same menu opens Terminal in that folder and starts `claude` with the prompt. The prompt is written to a private file (0600, in a 0700 folder under the app's `agents/` folder) that the script reads into a variable, so meeting text is never part of a shell command. If Claude Code isn't connected with the current token, the script passes `--mcp-config` with the same server Connect adds; that file, which holds the token, is deleted when `claude` exits (or by the next Open in Claude Code, if Terminal was closed first). Without `claude` or Node, or with agents off, it says so and copies the prompt instead. For a meeting in a project you keep from agents it starts nothing and copies nothing. Code: `apps/desktop/src-tauri/src/agents.rs` (`open_in_claude_code`); tests: `cargo test open_in_claude_code`, which run the script with `sh` against a stand-in `claude`.
- **Done, with evidence.** `complete_action_item` takes an optional `link`: a plain http or https URL of at most 300 characters, checked by the server and again by the app. The item shows "Done by Claude Code · PR #42", "Where this meeting went" lists what the agent says it did, and Settings → Recaps → "Say what coding agents finished" (off by default) adds those items to recaps as the agents' word, with a footer line saying Aftercall didn't check them. The link never reaches anything that pays. Tests: `work.test.ts`, `recap.test.ts`, `complete_with_a_link_to_the_work_and_only_a_plain_web_link`, `apps/mcp/src/tools.test.ts`.
- **Agents draft, you send.** `draft_follow_up` proposes a recap to an email address, or a USDC payment to a payee already on your list within your per-payment cap and what's left today (as the app last read them from the contract; with no per-payment cap set, agents propose no payments). It needs the same switch as claiming, lands as "Proposed by" the agent with its reason in place of a quote, waits for your tap, never runs on autopilot, stays off the phone, and is in the activity list. At most five wait per meeting. Tests: `autopilot.test.ts`, `agents_propose_payments_only_to_listed_payees_within_the_caps`, `agents_propose_a_recap_marked_as_theirs_with_their_reason`, `tools.test.ts`.
- **Projects agents can reach.** Coding agents → "Projects agents can reach": every project (the default, and how settings from before read) or the ones you tick. Meetings in other projects aren't listed or searched, and a request for one is refused without naming its project. Tests: `agents_reach_only_the_projects_the_user_chose`, `tools.test.ts`.
