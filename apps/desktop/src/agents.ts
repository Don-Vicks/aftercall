import { invoke } from "@tauri-apps/api/core";
import type { AgentWalletSnapshot, ItemFields, Meeting } from "@aftercall/core";

/** Coding agents (MCP) state and paths, from the Mac app (`agents_info`, apps/desktop/src-tauri/src/agents.rs). */
export interface AgentsInfo {
  dataDir: string;
  serverPath: string;
  serverFound: boolean;
  /** The app's agents socket is open. Off by default. */
  enabled: boolean;
  /** Agents may claim and complete action items. Off by default, and off again whenever agents are turned off. */
  allowWrites: boolean;
  /** Agents were on before the write switch existed, so they are read-only now. Until the user chooses. */
  readOnlySinceUpdate: boolean;
  /** What agents must send; only while enabled. */
  token: string | null;
  /** When that token was made; requests before it carried another. Null for an older token. */
  tokenSince: string | null;
  /** Whether "Connect Claude Code" gave Claude Code this token: "stale" means an older one, so reconnect. */
  claudeCode: "none" | "connected" | "stale";
  socketPath: string;
  /** The ids of the projects agents may reach; null for every project (and for settings from before the choice). */
  projects: string[] | null;
}

/** What "Open in Claude Code" did (agents.rs, `OpenOutcome`). */
export interface OpenOutcome {
  ok: boolean;
  /** Why it couldn't open, so the menu copies the prompt instead; "project" (kept from agents) copies nothing. */
  missing?: "folder" | "agents" | "claude" | "node" | "project";
  message: string;
}

/** What "Connect Claude Code" or "Disconnect Claude Code" did (agents.rs, `ClaudeOutcome`). */
export interface ClaudeOutcome {
  ok: boolean;
  /** That tool couldn't be found on this Mac, so the screen offers the copy command. */
  missing?: "claude" | "node";
  message: string;
}

export const agentsApi = {
  info: () => invoke<AgentsInfo>("agents_info"),
  /** Opens or closes the local socket. Turning off forgets the token. */
  setEnabled: (enabled: boolean) => invoke<AgentsInfo>("agents_set_enabled", { enabled }),
  /** A new token; agents set up with the old one stop working. */
  newToken: () => invoke<AgentsInfo>("agents_new_token"),
  /** The projects agents may reach, by id, or null for every project. Applies to the next request. */
  setProjects: (projects: string[] | null) => invoke<AgentsInfo>("agents_set_projects", { projects }),
  /** "Let agents claim and complete action items". Applies to the next request. */
  setAllowWrites: (allow: boolean) => invoke<AgentsInfo>("agents_set_allow_writes", { allow }),
  /**
   * Connect (true) runs `claude mcp add --scope user` for you, replacing an older Aftercall
   * entry; disconnect (false) runs `claude mcp remove`. Agents must be on to connect.
   */
  claude: (connect: boolean) => invoke<ClaudeOutcome>("agents_claude", { connect }),
  /**
   * Opens Terminal in the project's code folder and starts claude with `prompt`, with
   * Aftercall's MCP server. The prompt goes through a private file, never a shell string.
   */
  openClaude: (project: string, prompt: string) => invoke<OpenOutcome>("agents_open_claude", { project, prompt }),
  /**
   * The payee list and caps as just read from the contract (USDC base units), so agents
   * can propose payments only to listed payees within the caps; null clears them, when
   * there's no account or wallet any more. Kept in memory only.
   */
  setWallet: (wallet: AgentWalletSnapshot | null) => invoke<void>("agents_set_wallet", { wallet }),
  /** The newest 20 agent requests, newest first. */
  activity: () => invoke<AgentActivity[]>("agents_activity"),
  /** Ticks or unticks an action item in notes.json; returns the saved notes. */
  setItemDone: (id: string, itemId: string, done: boolean) => invoke<string>("set_action_item_done", { id, itemId, done }),
  /** Saves your edit of one action item in notes.json, or with null puts back what the model signed; returns the saved notes. */
  editItem: (id: string, itemId: string, fields: ItemFields | null) =>
    invoke<string>("edit_action_item", { id, itemId, text: fields?.text ?? "", owner: fields?.owner ?? "", due: fields?.due ?? null, restore: fields === null }),
};

/** Shown in the browser preview, where the app can't read its own paths. */
export const PREVIEW_INFO: AgentsInfo = {
  dataDir: "~/Library/Application Support/dev.aftercall.app",
  serverPath: "/Applications/Aftercall.app/Contents/Resources/mcp/aftercall-mcp.mjs",
  serverFound: false,
  enabled: false,
  allowWrites: false,
  readOnlySinceUpdate: false,
  token: null,
  tokenSince: null,
  claudeCode: "none",
  socketPath: "~/Library/Application Support/dev.aftercall.app/agents/aftercall.sock",
  projects: null,
};

/** Whether agents may reach a meeting in the project with this id (`info.projects` null: every project). */
export const reachesProject = (info: Pick<AgentsInfo, "projects">, projectId: string | undefined) => info.projects === null || (!!projectId && info.projects.includes(projectId));

const TOKEN_PLACEHOLDER = "<turn on Coding agents>";

/** A word-safe single-quoted shell argument. */
export function shellQuote(s: string): string {
  return /^[\w./:@-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * `claude mcp add`, available in every project (user scope), with this session's token.
 * "Connect Claude Code" runs the same arguments (agents.rs, `claude_add_args`), with node's
 * full path. The name goes before `--env`, which takes several values and would swallow it.
 */
export function claudeCommand(info: AgentsInfo): string {
  const token = info.token ?? TOKEN_PLACEHOLDER;
  // Removing first replaces a setup made with an older token; it's harmless when there is none.
  return `claude mcp remove --scope user aftercall 2>/dev/null; claude mcp add --scope user aftercall --env AFTERCALL_TOKEN=${shellQuote(token)} -- node ${shellQuote(info.serverPath)} --data-dir ${shellQuote(info.dataDir)}`;
}

/** Undoes `claudeCommand`, for when the app can't find the claude command itself. */
export const CLAUDE_REMOVE_COMMAND = "claude mcp remove --scope user aftercall";

/** Step 3 on the Coding agents screen: something to ask in a new Claude Code session. */
export const TRY_PROMPT = "Using the aftercall MCP server, list my recent meetings and the open action items.";

/** An agent's own name as people say it: Claude Code's MCP client calls itself "claude-code". */
export function agentLabel(name: string): string {
  return /^claude[-_ ]?code$/i.test(name) ? "Claude Code" : /^codex/i.test(name) ? "Codex" : name;
}

/**
 * The newest request that reached Aftercall with the current token, or none: proof an
 * agent is connected. One refused for its token doesn't count, nor one from before the token.
 */
export function lastHeard(log: AgentActivity[], info: AgentsInfo): AgentActivity | undefined {
  if (!info.enabled) return undefined;
  const since = info.tokenSince ? Date.parse(info.tokenSince) : Number.NEGATIVE_INFINITY;
  return log.find((a) => a.refused !== "token" && Date.parse(a.at) >= since);
}

/** "just now", "2 min ago", "3 h ago", else the date. */
export function ago(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const min = Math.floor((now - t) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`;
  return `on ${new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

/** The block for ~/.codex/config.toml. JSON strings are valid TOML basic strings. */
export function codexConfig(info: AgentsInfo): string {
  const token = info.token ?? TOKEN_PLACEHOLDER;
  return `[mcp_servers.aftercall]\ncommand = "node"\nargs = [${JSON.stringify(info.serverPath)}, "--data-dir", ${JSON.stringify(info.dataDir)}]\nenv = { AFTERCALL_TOKEN = ${JSON.stringify(token)} }`;
}

/**
 * One agent request from the app's activity list (agents.rs, `Activity`). Ids and names
 * only; the screen looks up titles and item text in the meetings it already has.
 */
export interface AgentActivity {
  at: string;
  /** What the agent calls itself. */
  agent: string;
  /** "projects" and "access" are listed only when refused. "draft" is a proposed follow-up. */
  op: "meetings" | "notes" | "claim" | "complete" | "draft" | "projects" | "access" | "other";
  meetingId?: string;
  itemId?: string;
  allowed: boolean;
  refused?: "token" | "read-only" | "project" | "unknown" | "rules";
}

export interface ActivityView {
  /** The first line: the item, or what was read. */
  what: string;
  /** The meeting, when it is one this screen knows. */
  meeting?: Meeting;
  /** Why it was refused, for the second line. */
  detail?: string;
  status: "claimed" | "done" | "proposed" | "read" | "refused";
}

const REFUSED: Record<NonNullable<AgentActivity["refused"]>, string> = {
  "read-only": "Agents are read-only",
  project: "A project agents can't reach",
  token: "Old or wrong token",
  unknown: "Not a request Aftercall knows",
  rules: "Refused by Aftercall's rules",
};

/** What a request other than a claim or completion reads as. */
const OP_WORDS: Record<Exclude<AgentActivity["op"], "claim" | "complete">, string> = {
  draft: "Propose a follow-up",
  meetings: "Read your meetings",
  notes: "Read a meeting",
  projects: "Read your projects",
  access: "Check what agents may do",
  other: "Unknown request",
};

/** How one activity entry reads on the screen. */
export function describeActivity(a: AgentActivity, meetings: Meeting[]): ActivityView {
  const meeting = a.meetingId ? meetings.find((m) => m.id === a.meetingId) : undefined;
  const item = a.itemId ? meeting?.actionItems.find((i) => i.id === a.itemId) : undefined;
  const what = a.op === "claim" || a.op === "complete" ? (item?.text ?? (a.op === "claim" ? "Claim an action item" : "Complete an action item")) : OP_WORDS[a.op];
  const status = !a.allowed ? "refused" : a.op === "claim" ? "claimed" : a.op === "complete" ? "done" : a.op === "draft" ? "proposed" : "read";
  return { what, meeting, detail: a.refused ? REFUSED[a.refused] : undefined, status };
}
