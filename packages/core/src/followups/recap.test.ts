import { test } from "node:test";
import assert from "node:assert/strict";
import { RECAP_FOOTER_MARK, buildRecap, mailtoLink, recapFactsFrom, recapFooter, type RecapFacts } from "./recap.ts";
import type { EmailFollowUp, Meeting } from "../meeting.ts";
import type { ProofBundleV1, ProofBundleV2 } from "../notes/pipeline.ts";

const meeting: Meeting = {
  id: "m1", project: "Fundraise", title: "Sync with Ada", startedAt: "Today 14:02", durationSec: 192, verified: true,
  summary: "The API fix ships before Friday.",
  decisions: ["Ship the API fix before Friday's demo."],
  actionItems: [
    { id: "a1", text: "Ship the API fix", owner: "Victor", due: "by Friday", done: false },
    { id: "a2", text: "Old thing", owner: "Ada", done: true },
  ],
  followUps: [], transcript: [],
};
const f: EmailFollowUp = { id: "f1", kind: "email", status: "proposed", to: "ada@example.com", toName: "Ada", subject: "Recap: API fix", evidence: { quote: "send Ada the recap", at: 0 } };
const HANDLING = "https://aftercall.app/how-it-works";
const facts: RecapFacts = { verified: true, e2ee: true, verifyUrl: "https://aftercall.app/verify#x", handlingUrl: HANDLING };
const notice = { by: "you" as const, at: "2026-11-01T14:01:30Z", how: "chat" as const };

test("the recap carries the summary, decisions, open action items and the footer", () => {
  const r = buildRecap(meeting, f, { sender: "Victor", facts });
  assert.equal(r.subject, "Recap: API fix");
  assert.match(r.text, /^Hi Ada, thanks for the call/);
  assert.match(r.text, /1\. Ship the API fix before Friday's demo\./);
  assert.match(r.text, /- Ship the API fix · Victor · by Friday/);
  assert.doesNotMatch(r.text, /Old thing/, "done items are left out");
  assert.ok(r.text.endsWith(`--\n${recapFooter(facts)}`));
  assert.ok(r.text.includes(`${RECAP_FOOTER_MARK} https://aftercall.app/verify#x`));
});

test("action items the sender edited are marked, and the footer says the app didn't check those changes", () => {
  const edited = { at: "2026-11-01T15:00:00.000Z", fields: ["text" as const, "owner" as const] };
  const one = { ...meeting, actionItems: [{ ...meeting.actionItems[0], text: "Ada sends the signed term sheet", owner: "Ada", edited }, meeting.actionItems[1]] };
  const r = buildRecap(one, f, { facts });
  assert.match(r.text, /- Ada sends the signed term sheet · Ada · by Friday \(edited by the sender\)/);
  assert.match(r.text, /The sender changed 1 action item after the notes were made, marked \(edited by the sender\)\. Aftercall didn't check that change\./);
  assert.ok(r.text.endsWith(recapFooter({ ...facts, editedItems: 1 })));
  assert.ok(r.text.includes(`${RECAP_FOOTER_MARK} https://aftercall.app/verify#x`));

  const two = { ...one, actionItems: [...one.actionItems, { id: "a3", text: "Book the venue", owner: "You", done: false, edited: { at: edited.at, fields: ["due" as const] } }] };
  assert.match(buildRecap(two, f, { facts }).text, /The sender changed 2 action items after the notes were made, marked \(edited by the sender\)\. Aftercall didn't check those changes\./);

  // An edited item that's done isn't in the recap, so it isn't counted.
  const doneEdited = { ...meeting, actionItems: [meeting.actionItems[0], { ...meeting.actionItems[1], edited }] };
  const plain = buildRecap(doneEdited, f, { facts }).text;
  assert.doesNotMatch(plain, /edited|changed/);
  assert.ok(plain.endsWith(`--\n${recapFooter(facts)}`));
});

test("the footer claims only what the app can check", () => {
  for (const fx of [facts, { ...facts, notice }, { ...facts, verified: false }, { ...facts, e2ee: null }]) {
    const text = recapFooter(fx);
    assert.doesNotMatch(text, /recorded with notice to everyone/i, "the app can't know everyone was told");
    assert.doesNotMatch(text, /train/i, "the app can't check what NEAR AI trains on");
    assert.doesNotMatch(text, /never|guarantee/i);
  }
});

test("verified and end-to-end encrypted", () => {
  assert.equal(
    recapFooter(facts),
    [
      "Notes made by Aftercall in secure hardware on NEAR AI Cloud, checked by the app before anything was sent. The transcript was end-to-end encrypted to that hardware.",
      "Aftercall deletes the call's audio once the notes are saved.",
      "What was and wasn't checked: https://aftercall.app/verify#x",
    ].join("\n"),
  );
});

test("TLS, unknown encryption, not verified and no proof link each say so", () => {
  assert.match(recapFooter({ ...facts, e2ee: false }), /checked by the app before anything was sent\. The transcript went over TLS, not end-to-end encrypted\./);
  assert.doesNotMatch(recapFooter({ ...facts, e2ee: null }), /encrypted|TLS/, "unknown: nothing said either way");
  const failed = recapFooter({ ...facts, verified: false });
  assert.match(failed, /^Notes made by Aftercall on NEAR AI Cloud\. Not every secure-hardware check passed for this meeting\./);
  assert.doesNotMatch(failed, /in secure hardware|end-to-end encrypted to/);
  assert.match(recapFooter({ verified: true, e2ee: true, handlingUrl: HANDLING }), /What was and wasn't checked: https:\/\/aftercall\.app\/how-it-works$/);
});

test("the notice line appears only when the sender logged one", () => {
  assert.match(recapFooter({ ...facts, notice }), /The sender confirmed telling everyone on the call before recording \(Aftercall can't check this\)\./);
  assert.doesNotMatch(recapFooter(facts), /sender confirmed/);
});

test("recapFactsFrom reads the meeting and its proof", () => {
  const v2 = { version: 2, e2ee: { used: false, reason: "refused" }, notice } as unknown as ProofBundleV2;
  assert.deepEqual(recapFactsFrom(meeting, v2, HANDLING, "https://v"), { verified: true, e2ee: false, notice, verifyUrl: "https://v", handlingUrl: HANDLING });
  assert.deepEqual(recapFactsFrom({ ...meeting, verified: false }, { version: 1 } as ProofBundleV1, HANDLING), { verified: false, e2ee: null, handlingUrl: HANDLING });
  assert.deepEqual(recapFactsFrom(meeting, undefined, HANDLING), { verified: true, e2ee: null, handlingUrl: HANDLING });
});

test("mailto links keep the address readable and encode the rest", () => {
  const link = mailtoLink(buildRecap(meeting, f, { facts }));
  assert.ok(link.startsWith("mailto:ada@example.com?subject=Recap%3A%20API%20fix&body=Hi%20Ada"));
  assert.ok(!link.includes("\n"));
});

test("a recap never includes your notes", () => {
  const r = buildRecap({ ...meeting, yourNotes: "Ada seemed unsure about the price. Push back on Friday." }, f, { sender: "Victor", facts });
  assert.doesNotMatch(r.text, /unsure|Push back/);
  assert.doesNotMatch(mailtoLink(r), /unsure/);
});
