import { formatClock, formatUsdc, search as searchMeetings, type ActionItem, type FollowUp, type Meeting } from "@aftercall/core";
import { readMeetings, readNotes, readProjects, updateNotes, type StoredMeeting } from "./store.ts";

/**
 * The tools behind the MCP server, as plain functions over the data dir so they
 * can be tested without a transport. Everything here reads, except claiming and
 * completing an action item, which change only that item in notes.json.
 */

const norm = (s: string) => s.trim().toLowerCase();

/** Accepts a project's name or id. */
async function projectMatcher(dataDir: string, project?: string): Promise<(m: Meeting) => boolean> {
  if (!project) return () => true;
  const wanted = norm(project);
  const byId = (await readProjects(dataDir)).find((p) => norm(p.id) === wanted);
  const name = norm(byId?.name ?? project);
  return (m) => norm(m.project) === name;
}

const isOpen = (a: ActionItem) => !a.done;

export async function listMeetings(dataDir: string, args: { project?: string; limit?: number } = {}) {
  const inProject = await projectMatcher(dataDir, args.project);
  const all = (await readMeetings(dataDir)).filter((s) => inProject(s.notes.meeting));
  return {
    projects: (await readProjects(dataDir)).map((p) => p.name),
    meetings: all.slice(0, args.limit ?? 50).map(({ id, notes }) => {
      const m = notes.meeting;
      return {
        id,
        title: m.title,
        project: m.project,
        startedAt: m.startedAt,
        duration: formatClock(m.durationSec),
        openActionItems: m.actionItems.filter(isOpen).length,
        followUpsToApprove: m.followUps.filter((f) => f.status === "proposed").length,
        proofOnNear: !!notes.onChain,
      };
    }),
    total: all.length,
  };
}

/** `{ "$bigint": "…" }` (how the app stores USDC amounts) or a bigint, as "12.50". */
function usdc(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return formatUsdc(value);
  if (typeof value === "object" && "$bigint" in value) return formatUsdc(BigInt(String((value as { $bigint: string }).$bigint)));
  return null;
}

function followUpView(f: FollowUp) {
  const base = { id: f.id, kind: f.kind, status: f.status, quote: f.evidence.quote, doneAt: f.doneAt, error: f.error };
  return f.kind === "email"
    ? { ...base, toName: f.toName, subject: f.subject }
    : { ...base, payeeName: f.payeeName, amountUsdc: usdc(f.amount), heard: f.heard, payeeListed: f.payeeListed };
}

function itemView(meetingId: string, m: Meeting, a: ActionItem) {
  return {
    meetingId,
    meeting: m.title,
    project: m.project,
    itemId: a.id,
    text: a.text,
    owner: a.owner,
    due: a.due,
    done: a.done,
    claimed: a.claimed,
    completed: a.completed,
  };
}

export async function getMeeting(dataDir: string, args: { id: string; includeTranscript?: boolean }) {
  const notes = await readNotes(dataDir, args.id).catch(() => {
    throw new Error(`No processed meeting with id "${args.id}". Use list_meetings to see ids.`);
  });
  const m = notes.meeting;
  return {
    id: args.id,
    title: m.title,
    project: m.project,
    startedAt: m.startedAt,
    duration: formatClock(m.durationSec),
    summary: m.summary,
    decisions: m.decisions,
    actionItems: m.actionItems.map((a) => itemView(args.id, m, a)),
    followUps: m.followUps.map(followUpView),
    proof: notes.onChain ? { network: notes.onChain.network, contract: notes.onChain.contract, tx: notes.onChain.txHash } : null,
    ...(args.includeTranscript ? { transcript: m.transcript.map((l) => `[${formatClock(l.at)}] ${l.speaker === "you" ? "You" : "Others"}: ${l.text}`) } : {}),
  };
}

export async function search(dataDir: string, args: { query: string; project?: string }) {
  const inProject = await projectMatcher(dataDir, args.project);
  const meetings = (await readMeetings(dataDir)).map((s) => ({ ...s.notes.meeting, id: s.id })).filter(inProject);
  const r = searchMeetings(meetings, args.query);
  return {
    meetingsMatched: r.meetings,
    decisions: r.decisions,
    actionItems: r.actions,
    transcript: r.transcript.map((h) => (h.kind === "transcript" ? { ...h, at: formatClock(h.at) } : h)),
  };
}

export async function listActionItems(
  dataDir: string,
  args: { owner?: string; project?: string; includeClaimed?: boolean; includeDone?: boolean } = {},
) {
  const inProject = await projectMatcher(dataDir, args.project);
  const owner = args.owner ? norm(args.owner) : null;
  const items = (await readMeetings(dataDir)).flatMap(({ id, notes }: StoredMeeting) =>
    inProject(notes.meeting)
      ? notes.meeting.actionItems
          .filter((a) => args.includeDone || !a.done)
          .filter((a) => args.includeClaimed || args.includeDone || !a.claimed)
          .filter((a) => !owner || norm(a.owner).includes(owner))
          .map((a) => itemView(id, notes.meeting, a))
      : [],
  );
  return { items, total: items.length };
}

function checkAgent(agent: string): string {
  const name = agent.trim();
  if (!name || name.length > 60) throw new Error("Give your agent name, 1 to 60 characters (e.g. \"Claude Code\")");
  return name;
}

function findItem(notes: { meeting: Meeting }, itemId: string): ActionItem {
  const item = notes.meeting.actionItems.find((a) => a.id === itemId);
  if (!item) throw new Error(`No action item "${itemId}" in this meeting. Use get_meeting to see item ids.`);
  return item;
}

export async function claimActionItem(dataDir: string, args: { meetingId: string; itemId: string; agent: string }, now = () => new Date()) {
  const agent = checkAgent(args.agent);
  let result: ActionItem | undefined;
  await updateNotes(dataDir, args.meetingId, (notes) => {
    const item = findItem(notes, args.itemId);
    if (item.done) throw new Error("This action item is already done");
    if (item.claimed && item.claimed.agent !== agent) {
      throw new Error(`Already claimed by ${item.claimed.agent} at ${item.claimed.at}`);
    }
    item.claimed ??= { agent, at: now().toISOString() };
    result = item;
  });
  return { claimed: true, item: result };
}

export async function completeActionItem(
  dataDir: string,
  args: { meetingId: string; itemId: string; agent: string; note?: string },
  now = () => new Date(),
) {
  const agent = checkAgent(args.agent);
  const note = args.note?.trim().slice(0, 500) || undefined;
  let result: ActionItem | undefined;
  await updateNotes(dataDir, args.meetingId, (notes) => {
    const item = findItem(notes, args.itemId);
    if (item.done) throw new Error("This action item is already done");
    if (item.claimed && item.claimed.agent !== agent) {
      throw new Error(`Claimed by ${item.claimed.agent}; only that agent can complete it`);
    }
    const at = now().toISOString();
    item.claimed ??= { agent, at };
    item.done = true;
    item.completed = { agent, at, ...(note ? { note } : {}) };
    result = item;
  });
  return { completed: true, item: result };
}
