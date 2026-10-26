import { strict as assert } from "node:assert";
import { readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { makeDataDir } from "./fixture.ts";
import { claimActionItem, completeActionItem, getMeeting, listActionItems, listMeetings, search } from "./tools.ts";
import { checkId } from "./store.ts";

let dir = "";
const dirs: string[] = [];
beforeEach(async () => {
  dir = await makeDataDir();
  dirs.push(dir);
});
after(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

const notesOf = async (id: string) => JSON.parse(await readFile(join(dir, "recordings", id, "notes.json"), "utf8"));

test("list_meetings: processed meetings only, newest first, with counts", async () => {
  const r = await listMeetings(dir);
  assert.deepEqual(r.meetings.map((m) => m.title), ["Team standup", "Sync with Ada"]);
  assert.deepEqual(r.projects, ["General", "Fundraise"]);
  const ada = r.meetings[1];
  assert.equal(ada.openActionItems, 2);
  assert.equal(ada.followUpsToApprove, 1);
  assert.equal(ada.duration, "12:34");
});

test("list_meetings: filters by project name or id", async () => {
  assert.deepEqual((await listMeetings(dir, { project: "fundraise" })).meetings.map((m) => m.id), ["1761000000"]);
  assert.deepEqual((await listMeetings(dir, { project: "fundraise-k3x" })).meetings.map((m) => m.id), ["1761000000"]);
  assert.equal((await listMeetings(dir, { project: "Nope" })).total, 0);
});

test("list_meetings: an empty or missing data dir is no meetings, not an error", async () => {
  assert.equal((await listMeetings(join(dir, "missing"))).total, 0);
});

test("get_meeting: notes and follow-up status, transcript only on request", async () => {
  const m = await getMeeting(dir, { id: "1761000000" });
  assert.equal(m.summary, "Ada will send the term sheet; we agreed on a pilot.");
  assert.deepEqual(m.decisions, ["Run a two-week pilot with Ada's team"]);
  assert.equal(m.actionItems.length, 3);
  assert.equal("transcript" in m, false);
  const pay = m.followUps.find((f) => f.kind === "payment");
  assert.ok(pay && "amountUsdc" in pay);
  assert.equal(pay.amountUsdc, "12.50");
  assert.equal(pay.status, "paid");
  const withText = await getMeeting(dir, { id: "1761000000", includeTranscript: true });
  assert.deepEqual(withText.transcript?.[1], "[10:00] Others: Please send me a recap of the pilot plan");
});

test("get_meeting: unknown and path-like ids are refused", async () => {
  await assert.rejects(getMeeting(dir, { id: "1761200000" }), /No processed meeting/);
  await assert.rejects(getMeeting(dir, { id: "../../etc" }), /No processed meeting/);
  assert.throws(() => checkId("../x"), /No meeting/);
});

test("search: reuses core search across meetings and projects", async () => {
  const r = await search(dir, { query: "pilot" });
  assert.equal(r.decisions.length, 1);
  assert.equal(r.actionItems.length, 1);
  assert.equal(r.transcript.length, 2);
  assert.equal(r.transcript[0].kind === "transcript" && r.transcript[0].at, "00:12");
  assert.equal((await search(dir, { query: "pilot", project: "General" })).meetingsMatched, 0);
});

test("list_action_items: open, unclaimed items; filter by owner and project", async () => {
  assert.deepEqual((await listActionItems(dir)).items.map((i) => i.text), ["Write the release notes", "Send Ada the pilot plan", "Share the term sheet"]);
  assert.deepEqual((await listActionItems(dir, { owner: "you" })).items.map((i) => i.itemId), ["a1"]);
  assert.equal((await listActionItems(dir, { project: "General" })).total, 1);
  assert.equal((await listActionItems(dir, { includeDone: true })).total, 4);
});

test("claim then complete: round trip on disk, visible to the next read", async () => {
  const t0 = new Date("2026-10-26T12:00:00Z");
  const t1 = new Date("2026-10-26T12:05:00Z");
  await claimActionItem(dir, { meetingId: "1761000000", itemId: "a1", agent: "Claude Code" }, () => t0);

  let item = (await notesOf("1761000000")).meeting.actionItems[0];
  assert.deepEqual(item.claimed, { agent: "Claude Code", at: t0.toISOString() });
  assert.equal(item.done, false);
  // Claimed items drop out of the default list.
  assert.deepEqual((await listActionItems(dir, { owner: "you" })).items, []);
  assert.equal((await listActionItems(dir, { owner: "you", includeClaimed: true })).total, 1);

  // Claiming again as the same agent is harmless; another agent is refused.
  await claimActionItem(dir, { meetingId: "1761000000", itemId: "a1", agent: "Claude Code" });
  await assert.rejects(claimActionItem(dir, { meetingId: "1761000000", itemId: "a1", agent: "Codex" }), /Already claimed by Claude Code/);
  await assert.rejects(completeActionItem(dir, { meetingId: "1761000000", itemId: "a1", agent: "Codex" }), /Claimed by Claude Code/);

  await completeActionItem(dir, { meetingId: "1761000000", itemId: "a1", agent: "Claude Code", note: "Sent the plan as a doc" }, () => t1);
  item = (await notesOf("1761000000")).meeting.actionItems[0];
  assert.equal(item.done, true);
  assert.deepEqual(item.completed, { agent: "Claude Code", at: t1.toISOString(), note: "Sent the plan as a doc" });
  await assert.rejects(claimActionItem(dir, { meetingId: "1761000000", itemId: "a1", agent: "Claude Code" }), /already done/);
  const shown = await getMeeting(dir, { id: "1761000000" });
  assert.equal(shown.actionItems[0].completed?.agent, "Claude Code");
});

test("writes change only the one item and keep the rest of notes.json as it was", async () => {
  const before = await notesOf("1761000000");
  await completeActionItem(dir, { meetingId: "1761000000", itemId: "a2", agent: "Codex" });
  const afterNotes = await notesOf("1761000000");
  afterNotes.meeting.actionItems[1] = before.meeting.actionItems[1];
  assert.deepEqual(afterNotes, before);
  // USDC amounts keep the app's { $bigint } form.
  assert.deepEqual(afterNotes.meeting.followUps[1].amount, { $bigint: "12500000" });
});

test("bad input: unknown item, missing agent name", async () => {
  await assert.rejects(claimActionItem(dir, { meetingId: "1761000000", itemId: "zz", agent: "Codex" }), /No action item "zz"/);
  await assert.rejects(claimActionItem(dir, { meetingId: "1761000000", itemId: "a1", agent: "  " }), /agent name/);
  await assert.rejects(claimActionItem(dir, { meetingId: "1761200000", itemId: "a1", agent: "Codex" }), /No processed meeting/);
});

test("concurrent writes: every change lands, no temp or lock files are left", async () => {
  // Two agents racing on different items of the same file, many times over.
  const jobs = [];
  for (let i = 0; i < 10; i++) {
    jobs.push(claimActionItem(dir, { meetingId: "1761000000", itemId: "a1", agent: "Claude Code" }));
    jobs.push(claimActionItem(dir, { meetingId: "1761000000", itemId: "a2", agent: "Codex" }));
  }
  await Promise.all(jobs);
  const items = (await notesOf("1761000000")).meeting.actionItems;
  assert.equal(items[0].claimed.agent, "Claude Code");
  assert.equal(items[1].claimed.agent, "Codex");
  assert.deepEqual((await readdir(join(dir, "recordings", "1761000000"))).sort(), ["meeting.json", "notes.json"]);
});

test("concurrent claims of one item: exactly one agent wins", async () => {
  const agents = ["A", "B", "C", "D", "E", "F"];
  const results = await Promise.allSettled(agents.map((agent) => claimActionItem(dir, { meetingId: "1761100000", itemId: "a1", agent })));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const winner = (await notesOf("1761100000")).meeting.actionItems[0].claimed.agent;
  assert.ok(agents.includes(winner));
});

test("a lock left by a crashed writer is taken over once stale", async () => {
  const lock = join(dir, "recordings", "1761100000", "notes.json.lock");
  await writeFile(lock, "app 1");
  const old = new Date(Date.now() - 60_000);
  await utimes(lock, old, old);
  await claimActionItem(dir, { meetingId: "1761100000", itemId: "a1", agent: "Codex" });
  assert.equal((await notesOf("1761100000")).meeting.actionItems[0].claimed.agent, "Codex");
});
