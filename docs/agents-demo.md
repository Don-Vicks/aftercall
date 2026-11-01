# Claude Code on Aftercall's MCP server: a recorded run

Run on 1 November 2026 (16:46 and 16:47 UTC) with Claude Code 2.1.314, headless, against Aftercall's MCP server as the app ships it (`apps/mcp/dist/aftercall-mcp.mjs`). The other end of the socket was the server's test stand-in for the app (`apps/mcp/src/fixture.ts`), not the Mac app and not a real meeting library. The stand-in speaks the same line protocol and applies the same rules: the token check, read-only until the user allows writes, and the claim rules. The app's own version of those rules, with encryption, locking and the activity list, is tested in Rust (`cargo test agents` in `apps/desktop/src-tauri`). The two meetings in it are sample data.

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
token:  41312bd6777207fafd178ca724da1ffb043ef115d3ca440ddf86f94519b6e898
MCP config for Claude Code: /var/folders/rc/2_0y02ys3739xj2dswtrwh800000gn/T/ac-mcp-8tA7Va/mcp-config.json
```

The token belongs to that throwaway stand-in, which is gone. The MCP config it wrote runs the bundled server with that socket and token:

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

To let me claim it, turn on "Let agents claim and complete action items" in Aftercall under **Settings → Connected agents**. Tell me once it's on and I'll claim "Ship the API fix" as Claude Code.
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

This part was not recorded; it is the same server and setup, pointed at the Mac app instead of the stand-in. It needs Node 20 or later and the `claude` CLI.

1. Open Aftercall and go to Settings → Connected agents.
2. Turn on "Let agents reach my meetings". A token appears. Agents can now read your processed meetings, and nothing else.
3. To let agents claim and complete action items, also turn on "Let agents claim and complete action items". Leave it off to keep them read-only.
4. Under Claude Code, press Copy and run the command in Terminal. It registers the server for every project (`claude mcp add --scope user …`), running the `aftercall-mcp.mjs` that ships inside Aftercall with your token.
5. In any folder, run:

   ```sh
   claude -p "List my Aftercall meetings, then claim the open action item about the API fix as Claude Code." \
     --allowedTools "mcp__aftercall__*" --max-turns 8 --output-format text
   ```

   or start `claude` and ask in your own words.
6. Each read, claim and completion, and every refused request, shows under "Recent agent activity" on the same screen. Allowed lookups of project names and of the write switch come with other requests and aren't listed. A claim shows on the meeting's action item.

Turning agents off closes the local channel and forgets the token; turning them on again needs the new setup command, and agents start read-only again. A new token, or moving Aftercall to another folder, also needs the command run again.
