import { formatClock, formatUsdc, search as searchMeetings, type ActionItem, type FollowUp, type Meeting } from "@aftercall/core";
import { claimItem, completeItem, readAccess, readMeetings, readNotes, readProjects, type AppChannel, type StoredMeeting } from "./store.ts";

/**
 * The tools behind the MCP server, as plain functions over the channel to the app
 * (store.ts), so they can be tested without an MCP transport. Everything here reads,
 * except claiming and completing an action item, which the app does on that one item,
 * and only when the user has allowed it.
 */

const norm = (s: string) => s.trim().toLowerCase();

/** Accepts a project's name or id. */
async function projectMatcher(app: AppChannel, project?: string): Promise<(m: Meeting) => boolean> {
  if (!project) return () => true;
  const wanted = norm(project);
  const byId = (await readProjects(app)).find((p) => norm(p.id) === wanted);
  const name = norm(byId?.name ?? project);
  return (m) => norm(m.project) === name;
}

const isOpen = (a: ActionItem) => !a.done;

export async function listMeetings(app: AppChannel, args: { project?: string; limit?: number } = {}) {
  const inProject = await projectMatcher(app, args.project);
  const all = (await readMeetings(app)).filter((s) => inProject(s.notes.meeting));
  return {
    projects: (await readProjects(app)).map((p) => p.name),
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

export async function getMeeting(app: AppChannel, args: { id: string; includeTranscript?: boolean }) {
  const notes = await readNotes(app, args.id);
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

export async function search(app: AppChannel, args: { query: string; project?: string }) {
  const inProject = await projectMatcher(app, args.project);
  const meetings = (await readMeetings(app)).map((s) => ({ ...s.notes.meeting, id: s.id })).filter(inProject);
  const r = searchMeetings(meetings, args.query);
  return {
    meetingsMatched: r.meetings,
    decisions: r.decisions,
    actionItems: r.actions,
    transcript: r.transcript.map((h) => (h.kind === "transcript" ? { ...h, at: formatClock(h.at) } : h)),
  };
}

export async function listActionItems(
  app: AppChannel,
  args: { owner?: string; project?: string; includeClaimed?: boolean; includeDone?: boolean } = {},
) {
  const inProject = await projectMatcher(app, args.project);
  const owner = args.owner ? norm(args.owner) : null;
  const items = (await readMeetings(app)).flatMap(({ id, notes }: StoredMeeting) =>
    inProject(notes.meeting)
      ? notes.meeting.actionItems
          .filter((a) => args.includeDone || !a.done)
          .filter((a) => args.includeClaimed || args.includeDone || !a.claimed)
          .filter((a) => !owner || norm(a.owner).includes(owner))
          .map((a) => itemView(id, notes.meeting, a))
      : [],
  );
  const { allowWrites } = await readAccess(app);
  return {
    items,
    total: items.length,
    canClaim: allowWrites,
    ...(allowWrites === true
      ? {}
      : allowWrites === false
        ? { note: "Aftercall lets agents read only right now. The user can allow claiming and completing in Settings → Connected agents." }
        : { note: "Aftercall didn't say whether agents may claim and complete. A claim says so if it is refused." }),
  };
}

export async function claimActionItem(app: AppChannel, args: { meetingId: string; itemId: string; agent: string }) {
  return { claimed: true, item: await claimItem(app, args) };
}

export async function completeActionItem(app: AppChannel, args: { meetingId: string; itemId: string; agent: string; note?: string }) {
  return { completed: true, item: await completeItem(app, args) };
}
