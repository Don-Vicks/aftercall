import { test } from "node:test";
import assert from "node:assert/strict";
import type { ActionItem, FollowUp, Meeting, TranscriptLine } from "./meeting.ts";
import { attendeesOf, buildPeople, firstName, openCount, otherSideName } from "./people-index.ts";

const NOW = new Date(2026, 10, 4, 12).getTime();
/** A recording id: its start in Unix seconds. */
const idAt = (mo: number, d: number, h = 10) => String(new Date(2026, mo - 1, d, h).getTime() / 1000);

let n = 0;
function meeting(over: Partial<Meeting> & { id: string }): Meeting {
  return { project: "Fundraise", title: `Meeting ${++n}`, startedAt: "", durationSec: 600, verified: true, summary: "", decisions: [], actionItems: [], followUps: [], transcript: [], ...over };
}
const item = (id: string, owner: string, text: string, extra: Partial<ActionItem> = {}): ActionItem => ({ id, owner, text, done: false, ...extra });
const line = (at: number, speaker: "you" | "others", text: string): TranscriptLine => ({ at, speaker, text });
const ev = { quote: "words from the call", at: 0 };

const ada = { name: "Ada Lovelace", email: "ada@example.com" };
const ines = { name: "Ines Rocha", email: "ines@example.com" };

const sync = meeting({
  id: idAt(11, 4),
  title: "Sync with Ada",
  invited: [ada],
  decisions: ["Ship the API fix before Friday's demo."],
  actionItems: [
    item("a1", "Victor", "Send Ada the recap", { due: "today", done: true }),
    item("a2", "You", "Ship the API fix", { due: "by Friday" }),
    item("a3", "Ada", "Intro to an investor"),
    item("a4", "Unassigned", "Book the demo room"),
  ],
  followUps: [
    { id: "f1", kind: "email", status: "sent", evidence: ev, to: "ada@example.com", toName: "Ada", subject: "Recap" },
    { id: "f2", kind: "payment", status: "paid", evidence: ev, payeeName: "Designer", payeeAccount: "designer.near", amount: 50_000_000n, heard: "fifty dollar", payeeListed: true, doneAt: "14:21" },
  ] satisfies FollowUp[],
  transcript: [
    line(4, "you", "Hi Ada, thanks for jumping on this afternoon."),
    line(31, "others", "The API fix has to ship before the demo. If it slips, we move the demo."),
    line(40, "others", "Sure."),
    line(60, "others", "Great. I'll look out for the recap. Talk Friday."),
  ],
});

const deck = meeting({
  id: idAt(10, 28),
  title: "Deck review",
  invited: [ada, ines],
  decisions: ["Open the deck with the product demo."],
  actionItems: [
    item("a1", "Ines", "Send three style directions", { due: "by Friday" }),
    item("a2", "you", "Share the deck v2 with Ada"),
    item("a3", "Designer", "Refresh the deck with the new brand"),
    item("a4", "You", "Will send the numbers to the room"),
  ],
  transcript: [line(10, "others", "Lead with the demo. People remember what they saw, not the market slide.")],
});

const intro = meeting({
  id: idAt(10, 14),
  title: "Investor intro call",
  actionItems: [item("a1", "Sam", "Send the data room link to two investors", { due: "28 Oct" })],
  followUps: [{ id: "f1", kind: "payment", status: "proposed", evidence: ev, payeeName: "Sam", payeeAccount: "", amount: null, heard: "a bit", payeeListed: false }],
  transcript: [line(5, "others", "I can send the data room link to two investors this week.")],
});

const me = ["victor.near"];
const index = buildPeople([intro, sync, deck], { me, now: NOW });

test("people come from invites, owners, recap recipients and payees; never you, never 'Unassigned'", () => {
  assert.deepEqual(index.people.map((p) => p.id).sort(), ["email:ada@example.com", "email:ines@example.com", "name:sam", "near:designer.near"]);
  assert.deepEqual(
    index.people.map((p) => p.name),
    ["Ada Lovelace", "Designer", "Ines Rocha", "Sam"],
    "newest first, then by name",
  );
});

test("a person's meetings, newest first, and how they came up", () => {
  const a = index.byId["email:ada@example.com"];
  assert.deepEqual(a.meetingIds, [sync.id, deck.id]);
  assert.deepEqual(a.invitedTo, [sync.id, deck.id]);
  assert.deepEqual(a.sources.sort(), ["calendar", "said"]);
  assert.equal(a.lastAt, Number(sync.id) * 1000);
  assert.equal(a.lastInvited, true);

  const d = index.byId["near:designer.near"];
  assert.equal(d.account, "designer.near");
  assert.deepEqual(d.invitedTo, []);
  assert.equal(d.lastInvited, false, "only named");
  assert.deepEqual(d.sources.sort(), ["payee", "said"]);
});

test("they owe you: items they own, resolved through the invite or a NEAR account", () => {
  assert.deepEqual(
    index.byId["email:ada@example.com"].theyOwe.map((i) => i.text),
    ["Intro to an investor"],
  );
  assert.deepEqual(
    index.byId["email:ines@example.com"].theyOwe.map((i) => i.text),
    ["Send three style directions"],
    "'Ines' is Ines Rocha from the invite",
  );
  assert.deepEqual(
    index.byId["near:designer.near"].theyOwe.map((i) => i.text),
    ["Refresh the deck with the new brand"],
  );
  assert.deepEqual(
    index.byId["name:sam"].theyOwe.map((i) => i.due),
    ["28 Oct"],
  );
});

test("you owe them: your items that name them, or from a call with only them", () => {
  const owed = index.byId["email:ada@example.com"].youOwe.map((i) => [i.text, i.why, i.done]);
  assert.deepEqual(owed, [
    ["Send Ada the recap", "named", true],
    ["Ship the API fix", "one-to-one", false],
    ["Share the deck v2 with Ada", "named", false],
  ]);
  assert.equal(openCount(index.byId["email:ada@example.com"].youOwe), 2);
  assert.deepEqual(index.byId["email:ines@example.com"].youOwe, [], "a group call's items aren't owed to everyone in it");
});

test("quotes only from one-to-one calls, and only full sentences", () => {
  const a = index.byId["email:ada@example.com"];
  assert.deepEqual(
    a.quotes.map((q) => q.at),
    [31, 60],
    "'Sure.' is too short; Deck review had two guests",
  );
  assert.equal(otherSideName(index, sync.id), "Ada Lovelace");
  assert.equal(otherSideName(index, deck.id), null);
  assert.equal(otherSideName(index, intro.id), null, "no invite, no name for the other side");
  assert.deepEqual(index.byId["name:sam"].quotes, []);
});

test("payments and decisions", () => {
  assert.deepEqual(
    index.byId["near:designer.near"].payments.map((p) => [p.amount, p.status]),
    [[50_000_000n, "paid"]],
  );
  assert.deepEqual(
    index.byId["name:sam"].payments.map((p) => p.heard),
    ["a bit"],
  );
  assert.deepEqual(
    index.byId["email:ada@example.com"].decisions.map((d) => d.text),
    ["Ship the API fix before Friday's demo.", "Open the deck with the product demo."],
  );
  assert.deepEqual(index.byId["name:sam"].decisions, [], "only meetings they were invited to");
});

test("faces per meeting: everyone invited, else up to two people named; payees only never", () => {
  assert.deepEqual(index.byMeeting[sync.id], ["email:ada@example.com"]);
  assert.deepEqual(index.byMeeting[deck.id], ["email:ada@example.com", "email:ines@example.com"]);
  assert.deepEqual(index.byMeeting[intro.id], ["name:sam"]);
  const paidOnly = buildPeople([meeting({ id: idAt(11, 2), followUps: [sync.followUps[1]] })], { now: NOW });
  assert.deepEqual(Object.values(paidOnly.byMeeting), [[]]);
});

test("a name that fits two people is credited to neither", () => {
  const a1 = meeting({ id: idAt(11, 1), invited: [{ name: "Ada Lovelace", email: "ada@one.com" }] });
  const a2 = meeting({ id: idAt(11, 2), invited: [{ name: "Ada King", email: "ada@two.com" }] });
  const loose = meeting({ id: idAt(11, 3), actionItems: [item("a1", "Ada", "Send the contract")] });
  const ix = buildPeople([a1, a2, loose], { now: NOW });
  assert.deepEqual(ix.byId["email:ada@one.com"].theyOwe, []);
  assert.deepEqual(ix.byId["email:ada@two.com"].theyOwe, []);
  assert.deepEqual(
    ix.byId["name:ada"].theyOwe.map((i) => i.text),
    ["Send the contract"],
  );
});

test("everyday words aren't read as names inside an item", () => {
  const m = meeting({ id: idAt(11, 3), invited: [{ name: "Will", email: "will@example.com" }, ines], actionItems: [item("a1", "You", "Will send the numbers")] });
  assert.deepEqual(buildPeople([m], { now: NOW }).byId["email:will@example.com"].youOwe, []);
});

test("attendees: a newer `attendees` list is read too, guests without an email included", () => {
  const m = meeting({ id: idAt(11, 3), invited: [ines] });
  // Junk on purpose: notes files come from disk, so attendeesOf must tolerate anything.
  (m as unknown as { attendees: unknown }).attendees = [{ name: "Theo Moss", email: "" }, "mara@example.com", { name: "Victor", email: "victor@example.com", self: true }, { name: "Ines Rocha", email: "INES@example.com" }, 42, null];
  assert.deepEqual(attendeesOf(m, me), [
    { name: "Theo Moss", email: "" },
    { name: "", email: "mara@example.com" },
    { name: "Ines Rocha", email: "INES@example.com" },
  ]);
  const ix = buildPeople([m], { me, now: NOW });
  assert.deepEqual(ix.people.map((p) => p.name).sort(), ["Ines Rocha", "Mara", "Theo Moss"]);
  assert.deepEqual(ix.byId["name:theo moss"].sources, ["calendar"]);
  assert.deepEqual(ix.oneToOne, {}, "three guests");
});

test("a one-to-one with a guest who has no email still names the other side", () => {
  const m = meeting({ id: idAt(11, 3), transcript: [line(3, "others", "I will send the brief over by the end of the day.")] }) as Meeting & { attendees: unknown };
  m.attendees = [{ name: "Theo Moss", email: "" }];
  const ix = buildPeople([m], { now: NOW });
  assert.equal(otherSideName(ix, m.id), "Theo Moss");
  assert.equal(ix.byId["name:theo moss"].quotes.length, 1);
});

test("an owner's first name finds the guest without an email who was invited, in that call and later ones", () => {
  const call = meeting({ id: idAt(10, 20), invited: [], actionItems: [item("a1", "Sam", "Send the data room link")] }) as Meeting & { attendees: unknown };
  call.attendees = [{ name: "Sam Obi", email: "" }];
  const later = meeting({ id: idAt(10, 22), actionItems: [item("a1", "Sam", "Share the investor list")] });
  const ix = buildPeople([call, later], { now: NOW });
  assert.deepEqual(
    ix.people.map((p) => p.id),
    ["name:sam obi"],
    "one person, not 'Sam' and 'Sam Obi'",
  );
  assert.deepEqual(
    ix.byId["name:sam obi"].theyOwe.map((i) => i.text),
    ["Share the investor list", "Send the data room link"],
  );
  assert.equal(otherSideName(ix, call.id), "Sam Obi");
});

test("firstName", () => {
  assert.equal(firstName("Ada Lovelace"), "Ada");
  assert.equal(firstName("Designer"), "Designer");
});
