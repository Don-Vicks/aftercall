import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionItem, Meeting } from "@aftercall/core";
import type { NotesFile } from "./store.ts";

/**
 * A stand-in for the Aftercall app's agents socket (apps/desktop/src-tauri/src/agents.rs):
 * the same line protocol, token check and claim rules, over in-memory notes. The real
 * rules, locking and encryption are tested in Rust (`cargo test agents`).
 */
export interface FakeApp {
  dataDir: string;
  socketPath: string;
  token: string;
  /** The notes as the app holds them now. */
  notes: (id: string) => NotesFile;
  /** Stops listening and removes the temp dir. */
  close: () => Promise<void>;
}

/** Two processed meetings and one recorded but not processed (no notes). */
function fixtureMeetings(): Map<string, NotesFile> {

  const ada: Meeting = {
    id: "1761000000",
    project: "Fundraise",
    title: "Sync with Ada",
    startedAt: "2026-10-21T10:00:00.000Z",
    durationSec: 754,
    verified: true,
    summary: "Ada will send the term sheet; we agreed on a pilot.",
    // Your notes are private to the app: no tool may return them (tools.test.ts).
    yourNotes: "Ada sounded unsure about pricing. Push for the pilot.",
    decisions: ["Run a two-week pilot with Ada's team"],
    actionItems: [
      { id: "a1", text: "Send Ada the pilot plan", owner: "You", due: "Friday", done: false },
      { id: "a2", text: "Share the term sheet", owner: "Ada", done: false },
      { id: "a3", text: "Book the follow-up call", owner: "You", done: true },
    ],
    followUps: [
      { id: "f1", kind: "email", status: "proposed", evidence: { quote: "send me a recap", at: 600 }, to: "", toName: "Ada", subject: "Pilot recap" },
      {
        id: "f2",
        kind: "payment",
        status: "paid",
        evidence: { quote: "I'll pay you twelve fifty for the design", at: 640 },
        payeeName: "Ada",
        payeeAccount: "ada.testnet",
        amount: { $bigint: "12500000" } as unknown as bigint,
        heard: "twelve fifty",
        payeeListed: true,
        doneAt: "10:15",
      },
    ],
    transcript: [
      { at: 12, speaker: "you", text: "Thanks for making time for the pilot today" },
      { at: 600, speaker: "others", text: "Please send me a recap of the pilot plan" },
    ],
  };
  const standup: Meeting = {
    ...ada,
    id: "1761100000",
    project: "General",
    title: "Team standup",
    startedAt: "2026-10-22T09:00:00.000Z",
    summary: "Release on Thursday.",
    decisions: ["Ship the release on Thursday"],
    actionItems: [{ id: "a1", text: "Write the release notes", owner: "Sam", done: false }],
    followUps: [],
    transcript: [{ at: 5, speaker: "others", text: "The release goes out Thursday" }],
  };

  const notes = new Map<string, NotesFile>();
  for (const m of [ada, standup]) notes.set(m.id, { meeting: m, processedAt: m.startedAt, notes: { summary: m.summary }, proof: { notesHash: "abc" } });
  notes.get(ada.id)!.yourNotesSalt = "5a".repeat(32);
  return notes;
}

const PROJECTS = [
  { id: "general", name: "General" },
  { id: "fundraise-k3x", name: "Fundraise" },
];

type Req = { token?: string; op?: string; [k: string]: unknown };

function handle(store: Map<string, NotesFile>, req: Req, now: () => string): unknown {
  const missing = (id: unknown) => new Error(`No processed meeting with id "${String(id)}". Use list_meetings to see ids.`);
  const notesOf = (id: unknown) => {
    const n = typeof id === "string" && /^\d{1,20}$/.test(id) ? store.get(id) : undefined;
    if (!n) throw missing(id);
    return n;
  };
  const openItem = (r: Req, otherClaim: (by: string, at: string) => string) => {
    const agent = String(r.agent ?? "").trim();
    if (!agent || agent.length > 60) throw new Error('Give your agent name, 1 to 60 characters (e.g. "Claude Code")');
    const item = notesOf(r.meetingId).meeting.actionItems.find((a) => a.id === r.itemId);
    if (!item) throw new Error(`No action item "${String(r.itemId)}" in this meeting. Use get_meeting to see item ids.`);
    if (item.done) throw new Error("This action item is already done");
    if (item.claimed && item.claimed.agent !== agent) throw new Error(otherClaim(item.claimed.agent, item.claimed.at));
    return { item: item as ActionItem, agent };
  };
  switch (req.op) {
    case "projects":
      return PROJECTS;
    case "meetings":
      return [...store.entries()].sort((a, b) => Number(b[0]) - Number(a[0])).map(([id, notes]) => ({ id, notes }));
    case "notes":
      return notesOf(req.id);
    case "claim": {
      const { item, agent } = openItem(req, (by, at) => `Already claimed by ${by} at ${at}`);
      item.claimed ??= { agent, at: now() };
      return { claimed: true, item };
    }
    case "complete": {
      const { item, agent } = openItem(req, (by) => `Claimed by ${by}; only that agent can complete it`);
      const note = typeof req.note === "string" ? req.note.trim().slice(0, 500) : "";
      const at = now();
      item.claimed ??= { agent, at };
      item.done = true;
      item.completed = { agent, at, ...(note ? { note } : {}) };
      return { completed: true, item };
    }
    default:
      throw new Error("Unknown request");
  }
}

/** Starts the stand-in app on a Unix socket in a new temp data dir. */
export async function startFakeApp(opts: { now?: () => string } = {}): Promise<FakeApp> {
  const dataDir = await mkdtemp(join(tmpdir(), "ac-mcp-"));
  const socketPath = join(dataDir, "agents.sock");
  const token = randomBytes(32).toString("hex");
  const store = fixtureMeetings();
  const now = opts.now ?? (() => new Date().toISOString());
  const server: Server = createServer((sock) => {
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      let reply: unknown;
      try {
        const req = JSON.parse(buf.slice(0, nl)) as Req;
        if (req.token !== token) throw new Error("Aftercall refused the token. Copy the current setup from Settings → Connected agents in Aftercall.");
        reply = { ok: true, result: handle(store, req, now) };
      } catch (e) {
        reply = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      sock.end(JSON.stringify(reply) + "\n");
    });
    sock.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return {
    dataDir,
    socketPath,
    token,
    notes: (id) => structuredClone(store.get(id)!),
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
