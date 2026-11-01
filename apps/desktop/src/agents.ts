import { invoke } from "@tauri-apps/api/core";
import type { ItemFields, Meeting } from "@aftercall/core";

/** Connected agents state and paths, from the Mac app (`agents_info`, apps/desktop/src-tauri/src/agents.rs). */
export interface AgentsInfo {
  dataDir: string;
  serverPath: string;
  serverFound: boolean;
  /** The app's agents socket is open. Off by default. */
  enabled: boolean;
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
  /** Ticks or unticks an action item in notes.json; returns the saved notes. */
  setItemDone: (id: string, itemId: string, done: boolean) => invoke<string>("set_action_item_done", { id, itemId, done }),
  /** Saves your edit of one action item in notes.json, or with null puts back what the model signed; returns the saved notes. */
  editItem: (id: string, itemId: string, fields: ItemFields | null) =>
    invoke<string>("edit_action_item", { id, itemId, text: fields?.text ?? "", owner: fields?.owner ?? "", due: fields?.due ?? null, restore: fields === null }),
};

/** Shown in the browser preview, where the app can't read its own paths. */
export const PREVIEW_INFO: AgentsInfo = {
  dataDir: "~/Library/Application Support/dev.aftercall.app",
  serverPath: "<aftercall checkout>/apps/mcp/src/main.ts",
  serverFound: false,
  enabled: false,
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

export interface AgentEvent {
  kind: "claimed" | "completed";
  agent: string;
  at: string;
  meetingId: string;
  meeting: string;
  item: string;
  note?: string;
}

/** Claims and completions by agents, newest first, read from the meetings' notes. */
export function agentActivity(meetings: Meeting[], limit = 20): AgentEvent[] {
  const events = meetings.flatMap((m) =>
    m.actionItems.flatMap((a) => {
      const base = { meetingId: m.id, meeting: m.title, item: a.text };
      return [
        ...(a.claimed ? [{ kind: "claimed" as const, ...a.claimed, ...base }] : []),
        ...(a.completed ? [{ kind: "completed" as const, ...base, ...a.completed }] : []),
      ];
    }),
  );
  return events.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0)).slice(0, limit);
}
