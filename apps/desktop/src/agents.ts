import { invoke } from "@tauri-apps/api/core";
import type { Meeting } from "@aftercall/core";

/** Where the MCP server and the app's data live; from the Mac app (`agents_info`). */
export interface AgentsInfo {
  dataDir: string;
  serverPath: string;
  serverFound: boolean;
}

export const agentsApi = {
  info: () => invoke<AgentsInfo>("agents_info"),
  /** Ticks or unticks an action item in notes.json; returns the saved notes. */
  setItemDone: (id: string, itemId: string, done: boolean) => invoke<string>("set_action_item_done", { id, itemId, done }),
};

/** Shown in the browser preview, where the app can't read its own paths. */
export const PREVIEW_INFO: AgentsInfo = {
  dataDir: "~/Library/Application Support/dev.aftercall.app",
  serverPath: "<aftercall checkout>/apps/mcp/src/main.ts",
  serverFound: false,
};

/** A word-safe single-quoted shell argument. */
export function shellQuote(s: string): string {
  return /^[\w./:@-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** `claude mcp add`, available in every project (user scope). */
export function claudeCommand(info: AgentsInfo): string {
  return `claude mcp add --scope user aftercall -- node ${shellQuote(info.serverPath)} --data-dir ${shellQuote(info.dataDir)}`;
}

/** The block for ~/.codex/config.toml. JSON strings are valid TOML basic strings. */
export function codexConfig(info: AgentsInfo): string {
  return `[mcp_servers.aftercall]\ncommand = "node"\nargs = [${JSON.stringify(info.serverPath)}, "--data-dir", ${JSON.stringify(info.dataDir)}]`;
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
