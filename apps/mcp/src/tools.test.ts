import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { startFakeApp, type FakeApp } from "./fixture.ts";
import { claimActionItem, completeActionItem, getMeeting, listActionItems, listMeetings, search } from "./tools.ts";
import { NO_TOKEN, NOT_RUNNING, checkId, connectApp, socketPathFor, type AppChannel } from "./store.ts";

// Every test goes through the real socket client (store.ts) to a stand-in for the app's agents socket.
const T0 = "2026-10-26T12:00:00.000Z";
let fake: FakeApp;
let app: AppChannel;
let clock = T0;
beforeEach(async () => {
  clock = T0;
  fake = await startFakeApp({ now: () => clock });
  app = connectApp({ socketPath: fake.socketPath, token: fake.token });
});
afterEach(() => fake.close());

test("list_meetings: processed meetings only, newest first, with counts", async () => {
  const r = await listMeetings(app);
  assert.deepEqual(r.meetings.map((m) => m.title), ["Team standup", "Sync with Ada"]);
  assert.deepEqual(r.projects, ["General", "Fundraise"]);
  const ada = r.meetings[1];
  assert.equal(ada.openActionItems, 2);
  assert.equal(ada.followUpsToApprove, 1);
  assert.equal(ada.duration, "12:34");
});

test("list_meetings: filters by project name or id", async () => {
  assert.deepEqual((await listMeetings(app, { project: "fundraise" })).meetings.map((m) => m.id), ["1761000000"]);
  assert.deepEqual((await listMeetings(app, { project: "fundraise-k3x" })).meetings.map((m) => m.id), ["1761000000"]);
  assert.equal((await listMeetings(app, { project: "Nope" })).total, 0);
});

test("get_meeting: notes and follow-up status, transcript only on request", async () => {
  const m = await getMeeting(app, { id: "1761000000" });
  assert.equal(m.summary, "Ada will send the term sheet; we agreed on a pilot.");
  assert.deepEqual(m.decisions, ["Run a two-week pilot with Ada's team"]);
  assert.equal(m.actionItems.length, 3);
  assert.equal("transcript" in m, false);
  const pay = m.followUps.find((f) => f.kind === "payment");
  assert.ok(pay && "amountUsdc" in pay);
  assert.equal(pay.amountUsdc, "12.50");
  assert.equal(pay.status, "paid");
  const withText = await getMeeting(app, { id: "1761000000", includeTranscript: true });
  assert.deepEqual(withText.transcript?.[1], "[10:00] Others: Please send me a recap of the pilot plan");
});

test("get_meeting: unknown and path-like ids are refused", async () => {
  await assert.rejects(getMeeting(app, { id: "1761200000" }), /No processed meeting/);
  await assert.rejects(getMeeting(app, { id: "../../etc" }), /No processed meeting/);
  assert.throws(() => checkId("../x"), /No meeting/);
});

test("search: reuses core search across meetings and projects", async () => {
  const r = await search(app, { query: "pilot" });
  assert.equal(r.decisions.length, 1);
  assert.equal(r.actionItems.length, 1);
  assert.equal(r.transcript.length, 2);
  assert.equal(r.transcript[0].kind === "transcript" && r.transcript[0].at, "00:12");
  assert.equal((await search(app, { query: "pilot", project: "General" })).meetingsMatched, 0);
});

test("list_action_items: open, unclaimed items; filter by owner and project", async () => {
  assert.deepEqual((await listActionItems(app)).items.map((i) => i.text), ["Write the release notes", "Send Ada the pilot plan", "Share the term sheet"]);
  assert.deepEqual((await listActionItems(app, { owner: "you" })).items.map((i) => i.itemId), ["a1"]);
  assert.equal((await listActionItems(app, { project: "General" })).total, 1);
  assert.equal((await listActionItems(app, { includeDone: true })).total, 4);
});

test("claim then complete: the app records it, visible to the next read", async () => {
  await claimActionItem(app, { meetingId: "1761000000", itemId: "a1", agent: "Claude Code" });
  let item = fake.notes("1761000000").meeting.actionItems[0];
  assert.deepEqual(item.claimed, { agent: "Claude Code", at: T0 });
  assert.equal(item.done, false);
  // Claimed items drop out of the default list.
  assert.deepEqual((await listActionItems(app, { owner: "you" })).items, []);
  assert.equal((await listActionItems(app, { owner: "you", includeClaimed: true })).total, 1);

  // Claiming again as the same agent is harmless; another agent is refused, with the app's reason.
  await claimActionItem(app, { meetingId: "1761000000", itemId: "a1", agent: "Claude Code" });
  await assert.rejects(claimActionItem(app, { meetingId: "1761000000", itemId: "a1", agent: "Codex" }), /Already claimed by Claude Code/);
  await assert.rejects(completeActionItem(app, { meetingId: "1761000000", itemId: "a1", agent: "Codex" }), /Claimed by Claude Code/);

  clock = "2026-10-26T12:05:00.000Z";
  const r = await completeActionItem(app, { meetingId: "1761000000", itemId: "a1", agent: "Claude Code", note: "Sent the plan as a doc" });
  assert.equal(r.item.done, true);
  item = fake.notes("1761000000").meeting.actionItems[0];
  assert.deepEqual(item.completed, { agent: "Claude Code", at: clock, note: "Sent the plan as a doc" });
  await assert.rejects(claimActionItem(app, { meetingId: "1761000000", itemId: "a1", agent: "Claude Code" }), /already done/);
  assert.equal((await getMeeting(app, { id: "1761000000" })).actionItems[0].completed?.agent, "Claude Code");
});

test("bad input: unknown item, missing agent name, unprocessed meeting", async () => {
  await assert.rejects(claimActionItem(app, { meetingId: "1761000000", itemId: "zz", agent: "Codex" }), /No action item "zz"/);
  await assert.rejects(claimActionItem(app, { meetingId: "1761000000", itemId: "a1", agent: "  " }), /agent name/);
  await assert.rejects(claimActionItem(app, { meetingId: "1761200000", itemId: "a1", agent: "Codex" }), /No processed meeting/);
});

test("concurrent claims of one item: exactly one agent wins", async () => {
  const agents = ["A", "B", "C", "D", "E", "F"];
  const results = await Promise.allSettled(agents.map((agent) => claimActionItem(app, { meetingId: "1761100000", itemId: "a1", agent })));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok(agents.includes(fake.notes("1761100000").meeting.actionItems[0].claimed!.agent));
});

test("a wrong token is refused and nothing changes", async () => {
  const stranger = connectApp({ socketPath: fake.socketPath, token: "0".repeat(64) });
  await assert.rejects(listMeetings(stranger), /refused the token/);
  await assert.rejects(claimActionItem(stranger, { meetingId: "1761000000", itemId: "a1", agent: "Codex" }), /refused the token/);
  assert.equal(fake.notes("1761000000").meeting.actionItems[0].claimed, undefined);
});

test("app closed or agents off: every tool says to open Aftercall", async () => {
  // No socket at all: the default path under a data dir that has none.
  const off = connectApp({ socketPath: socketPathFor(join(fake.dataDir, "nowhere")), token: fake.token });
  await assert.rejects(listMeetings(off), (e: Error) => e.message === NOT_RUNNING);
  await assert.rejects(claimActionItem(off, { meetingId: "1761000000", itemId: "a1", agent: "Codex" }), /Open Aftercall and turn on Connected agents/);
  // A plain file where the socket would be.
  const file = join(fake.dataDir, "not-a-socket");
  await writeFile(file, "");
  await assert.rejects(listMeetings(connectApp({ socketPath: file, token: fake.token })), /Open Aftercall/);
});

test("an app that hangs up without answering gives the same clear error", async () => {
  const path = join(fake.dataDir, "hangup.sock");
  const hangUp = createServer((sock) => sock.destroy());
  await new Promise<void>((r) => hangUp.listen(path, r));
  await assert.rejects(listMeetings(connectApp({ socketPath: path, token: fake.token })), /Open Aftercall/);
  await new Promise<void>((r) => hangUp.close(() => r()));
});

test("no token configured: a clear setup error, without connecting", async () => {
  await assert.rejects(listMeetings(connectApp({ socketPath: fake.socketPath, token: undefined })), (e: Error) => e.message === NO_TOKEN);
  await assert.rejects(listMeetings(connectApp({ socketPath: fake.socketPath, token: "" })), /AFTERCALL_TOKEN/);
});

test("your notes never reach an agent, whatever the tool", async () => {
  // The app's socket strips them too (agents.rs); this holds even if it didn't.
  const outputs = [
    await listMeetings(app),
    await getMeeting(app, { id: "1761000000", includeTranscript: true }),
    await search(app, { query: "pricing" }),
    await search(app, { query: "pilot" }),
    await listActionItems(app, { includeDone: true, includeClaimed: true }),
  ];
  for (const out of outputs) {
    const text = JSON.stringify(out);
    assert.doesNotMatch(text, /unsure about pricing|Push for the pilot/);
    assert.doesNotMatch(text, /yourNotes|5a5a5a/);
  }
  assert.equal((await search(app, { query: "unsure about pricing" })).meetingsMatched, 0, "search doesn't look inside them either");
});
