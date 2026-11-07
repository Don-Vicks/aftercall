import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { WORK_LINK_MAX, workLink } from "@aftercall/core";
import type { AppChannel } from "./store.ts";
import { claimActionItem, completeActionItem, draftFollowUp, getMeeting, listActionItems, listMeetings, search } from "./tools.ts";

const READ_ONLY =
  "Aftercall's MCP server only reads meetings, plus claiming and completing action items and proposing follow-ups for the user to approve, when the user has allowed that. It can't send emails, make payments, record proofs on NEAR, or change notes, decisions or existing follow-ups: those stay in the app, with the user. It works only while the Aftercall app is open with Coding agents turned on.";

const WRITES =
  'Claiming, completing and proposing need the user\'s switch "Let agents claim and complete action items" in Aftercall; it is off by default, and while it is off the app refuses these calls and says so. list_action_items reports whether it is on.';

export const INSTRUCTIONS = `Aftercall keeps private meeting notes on this Mac: summary, decisions, action items with owners, and follow-ups. Use list_action_items to find work, claim_action_item before you start one (with your agent name), and complete_action_item with a link to the work when it's done. draft_follow_up proposes a recap or a payment for the user to approve. ${WRITES} ${READ_ONLY}`;

export const TOOL_NAMES = ["list_meetings", "get_meeting", "search", "list_action_items", "claim_action_item", "complete_action_item", "draft_follow_up"] as const;

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

/** Runs a tool and turns a thrown error into an MCP tool error the agent can read. */
async function run(fn: () => Promise<unknown>) {
  try {
    return json(await fn());
  } catch (e) {
    return { content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }], isError: true };
  }
}

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const itemWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const agentArg = z.string().min(1).max(60).describe('Your name as an agent, shown to the user in Aftercall, e.g. "Claude Code" or "Codex"');

export function createServer(channel: AppChannel): McpServer {
  const server = new McpServer({ name: "aftercall", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  // Every request names the MCP client (e.g. "claude-code"), as it introduced itself, so
  // the app's activity list can say who read what. Claims and completions also carry the
  // agent name the agent gives.
  const app: AppChannel = (op, args = {}) => channel(op, { client: server.server.getClientVersion()?.name, ...args });

  server.registerTool(
    "list_meetings",
    {
      title: "List meetings",
      description: `Processed meetings on this Mac that the user lets agents reach (every project, or only the ones they chose), newest first, with open action items and follow-ups waiting for approval in the app (a payment on NEAR over a cap waits for the owner's NEAR wallet instead, and shows as "blocked" in get_meeting). Read-only. ${READ_ONLY}`,
      inputSchema: {
        project: z.string().optional().describe("Only meetings in this project (name or id)"),
        limit: z.number().int().min(1).max(500).optional().describe("Most meetings to return (default 50)"),
      },
      annotations: readOnly,
    },
    (args) => run(() => listMeetings(app, args)),
  );

  server.registerTool(
    "get_meeting",
    {
      title: "Get a meeting",
      description: `One meeting's summary, decisions, action items (with any agent claims) and follow-up status. The transcript is left out unless includeTranscript is true. Read-only. ${READ_ONLY}`,
      inputSchema: {
        id: z.string().describe("Meeting id from list_meetings"),
        includeTranscript: z.boolean().optional().describe("Also return the transcript, one line per utterance"),
      },
      annotations: readOnly,
    },
    (args) => run(() => getMeeting(app, args)),
  );

  server.registerTool(
    "search",
    {
      title: "Search meetings",
      description: `Searches decisions, action items and transcripts across meetings, on this Mac. Read-only. ${READ_ONLY}`,
      inputSchema: {
        query: z.string().min(2).describe("Words to look for (at least 2 characters)"),
        project: z.string().optional().describe("Only meetings in this project (name or id)"),
      },
      annotations: readOnly,
    },
    (args) => run(() => search(app, args)),
  );

  server.registerTool(
    "list_action_items",
    {
      title: "List action items",
      description: `Open, unclaimed action items across meetings, and whether the user lets agents claim and complete them (canClaim). Filter by owner (as written in the notes, e.g. "You") or project. Read-only. ${READ_ONLY}`,
      inputSchema: {
        owner: z.string().optional().describe("Only items whose owner contains this text"),
        project: z.string().optional().describe("Only items from meetings in this project (name or id)"),
        includeClaimed: z.boolean().optional().describe("Also show open items an agent has claimed"),
        includeDone: z.boolean().optional().describe("Also show done items"),
      },
      annotations: readOnly,
    },
    (args) => run(() => listActionItems(app, args)),
  );

  server.registerTool(
    "claim_action_item",
    {
      title: "Claim an action item",
      description: `Marks one open action item as being worked on by you, with your agent name and the time; the user sees this in Aftercall. Fails if another agent has claimed it or it's done. Changes only that item. ${WRITES} ${READ_ONLY}`,
      inputSchema: {
        meetingId: z.string().describe("Meeting id"),
        itemId: z.string().describe("Action item id from get_meeting or list_action_items"),
        agent: agentArg,
      },
      annotations: itemWrite,
    },
    (args) => run(() => claimActionItem(app, args)),
  );

  server.registerTool(
    "complete_action_item",
    {
      title: "Complete an action item",
      description: `Marks one action item done, recording your agent name, the time, an optional note on what you did and an optional link to the work (a pull request, commit or document). The user sees the note and link as your statement; Aftercall doesn't open or check the link. Only the agent that claimed it can complete it. Changes only that item. ${WRITES} ${READ_ONLY}`,
      inputSchema: {
        meetingId: z.string().describe("Meeting id"),
        itemId: z.string().describe("Action item id"),
        agent: agentArg,
        note: z.string().max(500).optional().describe("One line on what was done, shown to the user"),
        link: z
          .string()
          .max(WORK_LINK_MAX)
          .refine((l) => workLink(l) !== null, "A plain http or https URL, with no user name or password")
          .optional()
          .describe(`A link to the work: a pull request, commit or document. http or https only, at most ${WORK_LINK_MAX} characters`),
      },
      annotations: { ...itemWrite, idempotentHint: false },
    },
    (args) => run(() => completeActionItem(app, args)),
  );

  server.registerTool(
    "draft_follow_up",
    {
      title: "Propose a follow-up",
      description: `Proposes one follow-up for a meeting: a recap email to an address (kind "email"), or a USDC payment (kind "payment") to a payee already on the user's list, within their per-payment cap and what's left today. It lands in Aftercall marked "Proposed by" your agent name, with your reason in place of a quote from the call, and waits for the user to approve or dismiss it: it never runs on autopilot, and this tool sends and pays nothing. At most 5 proposals wait per meeting. ${WRITES} ${READ_ONLY}`,
      inputSchema: {
        meetingId: z.string().describe("Meeting id"),
        agent: agentArg,
        kind: z.enum(["email", "payment"]).describe('"email" for a recap of the meeting, "payment" for USDC to a listed payee'),
        reason: z.string().min(1).max(300).describe("Why, in one line. The user sees it in place of a quote from the call"),
        to: z.string().max(254).optional().describe("For a recap: the email address it goes to"),
        toName: z.string().max(80).optional().describe("For a recap: the person's name"),
        subject: z.string().max(200).optional().describe("For a recap: the subject (defaults to the meeting's title)"),
        payee: z.string().max(80).optional().describe("For a payment: the payee's name or NEAR account, as on the user's list"),
        amount: z
          .string()
          .regex(/^\d{1,12}(\.\d{1,6})?$/, 'USDC, like "12.50"')
          .optional()
          .describe('For a payment: the amount in USDC, like "12.50"'),
      },
      annotations: { ...itemWrite, idempotentHint: false },
    },
    (args) => run(() => draftFollowUp(app, args)),
  );

  return server;
}
