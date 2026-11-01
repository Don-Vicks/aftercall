import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ActionItem, Meeting } from "@aftercall/core";

/**
 * Talks to the running Aftercall app. Meetings are encrypted on disk with a key in
 * the macOS Keychain, so this server can't read them as files. While the user has
 * Settings → Connected agents turned on, the app listens on a Unix socket,
 * `<data dir>/agents/aftercall.sock` (owner-only), and answers one JSON request per
 * line, each carrying the token shown on that screen
 * (apps/desktop/src-tauri/src/agents.rs):
 *
 *   → {"token":"…","op":"projects"|"meetings"|"notes"|"access"|"claim"|"complete", ...args}
 *   ← {"ok":true,"result":…} or {"ok":false,"error":"…"}
 *
 * Agents only read unless the user turns on "Let agents claim and complete action
 * items" on that screen; until then the app refuses claim and complete. When it is
 * on, the app does every write itself, under the same lock as its own saves, and only
 * lets an agent claim or complete one action item.
 */

/** Where the app keeps its data: Tauri's app data dir for `dev.aftercall.app`. */
export function defaultDataDir(): string {
  return process.env.AFTERCALL_DATA_DIR || join(homedir(), "Library", "Application Support", "dev.aftercall.app");
}

export function socketPathFor(dataDir: string): string {
  return join(dataDir, "agents", "aftercall.sock");
}

export const NOT_RUNNING = "Aftercall isn't reachable. Open Aftercall and turn on Connected agents (Settings → Connected agents).";
export const NO_TOKEN =
  "This MCP server has no Aftercall token. Open Aftercall, turn on Connected agents and run the setup command it shows (it sets AFTERCALL_TOKEN).";

export interface Project {
  id: string;
  name: string;
}

/** notes.json as stored. USDC amounts are `{ "$bigint": "…" }`; other fields are kept as they are. */
export interface NotesFile {
  meeting: Meeting;
  processedAt?: string;
  /** Set once the proof is recorded on NEAR. */
  onChain?: { network: string; contract: string; owner: string; txHash: string; proofHash: string };
  [k: string]: unknown;
}

export interface StoredMeeting {
  id: string;
  notes: NotesFile;
}

/** One request to the app; resolves with its result or rejects with its error. */
export type AppChannel = (op: string, args?: Record<string, unknown>) => Promise<unknown>;

/** A channel over the app's Unix socket. Each call is one short connection. */
export function connectApp(opts: { socketPath: string; token: string | undefined; timeoutMs?: number }): AppChannel {
  return (op, args = {}) =>
    new Promise((resolve, reject) => {
      if (!opts.token) return reject(new Error(NO_TOKEN));
      const sock = createConnection(opts.socketPath);
      let buf = "";
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        sock.destroy();
        fn();
      };
      sock.setTimeout(opts.timeoutMs ?? 10_000, () => done(() => reject(new Error("Aftercall didn't answer in time. Is it still open?"))));
      sock.on("connect", () => sock.write(JSON.stringify({ ...args, token: opts.token, op }) + "\n"));
      sock.on("data", (d) => {
        buf += d.toString("utf8");
        const nl = buf.indexOf("\n");
        if (nl < 0) return;
        done(() => {
          try {
            const reply = JSON.parse(buf.slice(0, nl)) as { ok: boolean; result?: unknown; error?: string };
            if (reply.ok) resolve(reply.result);
            else reject(new Error(reply.error || "Aftercall refused the request"));
          } catch {
            reject(new Error("Aftercall sent a reply this server can't read"));
          }
        });
      });
      // No socket (agents off, app closed) or one left by a crash: nobody is listening.
      sock.on("error", (e: NodeJS.ErrnoException) =>
        done(() => reject(new Error(["ENOENT", "ECONNREFUSED", "ENOTSOCK"].includes(e.code ?? "") ? NOT_RUNNING : `${NOT_RUNNING} (${e.message})`))),
      );
      sock.on("end", () => done(() => reject(new Error(NOT_RUNNING))));
    });
}

/** Recording ids are the Unix second they started. */
export function checkId(id: string): string {
  if (!/^\d{1,20}$/.test(id)) throw new Error(`No meeting with id "${id}"`);
  return id;
}

export async function readProjects(app: AppChannel): Promise<Project[]> {
  return (await app("projects")) as Project[];
}

/** Every processed meeting, newest first. */
export async function readMeetings(app: AppChannel): Promise<StoredMeeting[]> {
  return (await app("meetings")) as StoredMeeting[];
}

export async function readNotes(app: AppChannel, id: string): Promise<NotesFile> {
  return (await app("notes", { id })) as NotesFile;
}

/**
 * Whether the user lets agents claim and complete action items right now. null when
 * the app can't say, for example a version from before the switch, so reads still work.
 */
export async function readAccess(app: AppChannel): Promise<{ allowWrites: boolean | null }> {
  try {
    return (await app("access")) as { allowWrites: boolean };
  } catch {
    return { allowWrites: null };
  }
}

/** Claims one action item for `agent`; the app stamps the time. */
export async function claimItem(app: AppChannel, args: { meetingId: string; itemId: string; agent: string }): Promise<ActionItem> {
  return ((await app("claim", args)) as { item: ActionItem }).item;
}

/** Completes one action item for `agent`, with an optional note; the app stamps the time. */
export async function completeItem(app: AppChannel, args: { meetingId: string; itemId: string; agent: string; note?: string }): Promise<ActionItem> {
  return ((await app("complete", args)) as { item: ActionItem }).item;
}
