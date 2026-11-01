import { invoke } from "@tauri-apps/api/core";
import type { Meeting } from "@aftercall/core";

/** Connected agents state and paths, from the Mac app (`agents_info`, apps/desktop/src-tauri/src/agents.rs). */
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
  socketPath: string;
}

export const agentsApi = {
  info: () => invoke<AgentsInfo>("agents_info"),
  /** Opens or closes the local socket. Turning off forgets the token. */
  setEnabled: (enabled: boolean) => invoke<AgentsInfo>("agents_set_enabled", { enabled }),
  /** A new token; agents set up with the old one stop working. */
  newToken: () => invoke<AgentsInfo>("agents_new_token"),
  /** "Let agents claim and complete action items". Applies to the next request. */
  setAllowWrites: (allow: boolean) => invoke<AgentsInfo>("agents_set_allow_writes", { allow }),
  /** The newest 20 agent requests, newest first. */
  activity: () => invoke<AgentActivity[]>("agents_activity"),
  /** Ticks or unticks an action item in notes.json; returns the saved notes. */
  setItemDone: (id: string, itemId: string, done: boolean) => invoke<string>("set_action_item_done", { id, itemId, done }),
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
  socketPath: "~/Library/Application Support/dev.aftercall.app/agents/aftercall.sock",
};

const TOKEN_PLACEHOLDER = "<turn on Connected agents>";

/** A word-safe single-quoted shell argument. */
export function shellQuote(s: string): string {
  return /^[\w./:@-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** `claude mcp add`, available in every project (user scope), with this session's token. */
export function claudeCommand(info: AgentsInfo): string {
  const token = info.token ?? TOKEN_PLACEHOLDER;
  // Removing first replaces a setup made with an older token; it's harmless when there is none.
  return `claude mcp remove --scope user aftercall 2>/dev/null; claude mcp add --scope user --env AFTERCALL_TOKEN=${shellQuote(token)} aftercall -- node ${shellQuote(info.serverPath)} --data-dir ${shellQuote(info.dataDir)}`;
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
  /** "projects" and "access" are listed only when refused. */
  op: "meetings" | "notes" | "claim" | "complete" | "projects" | "access" | "other";
  meetingId?: string;
  itemId?: string;
  allowed: boolean;
  refused?: "token" | "read-only" | "unknown" | "rules";
}

export interface ActivityView {
  /** The first line: the item, or what was read. */
  what: string;
  /** The meeting, when it is one this screen knows. */
  meeting?: Meeting;
  /** Why it was refused, for the second line. */
  detail?: string;
  status: "claimed" | "done" | "read" | "refused";
}

const REFUSED: Record<NonNullable<AgentActivity["refused"]>, string> = {
  "read-only": "Agents are read-only",
  token: "Old or wrong token",
  unknown: "Not a request Aftercall knows",
  rules: "Refused by Aftercall's rules",
};

/** How one activity entry reads on the screen. */
export function describeActivity(a: AgentActivity, meetings: Meeting[]): ActivityView {
  const meeting = a.meetingId ? meetings.find((m) => m.id === a.meetingId) : undefined;
  const item = a.itemId ? meeting?.actionItems.find((i) => i.id === a.itemId) : undefined;
  const what =
    a.op === "claim" || a.op === "complete"
      ? (item?.text ?? (a.op === "claim" ? "Claim an action item" : "Complete an action item"))
      : a.op === "meetings"
        ? "Read your meetings"
        : a.op === "notes"
          ? "Read a meeting"
          : a.op === "projects"
            ? "Read your projects"
            : a.op === "access"
              ? "Check what agents may do"
              : "Unknown request";
  const status = !a.allowed ? "refused" : a.op === "claim" ? "claimed" : a.op === "complete" ? "done" : "read";
  return { what, meeting, detail: a.refused ? REFUSED[a.refused] : undefined, status };
}
