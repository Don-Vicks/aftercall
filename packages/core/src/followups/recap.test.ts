import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRecap, mailtoLink } from "./recap.ts";
import type { EmailFollowUp, Meeting } from "../meeting.ts";

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

test("the recap carries the summary, decisions, open action items and the consent line", () => {
  const r = buildRecap(meeting, f, { sender: "Victor", verifyUrl: "https://aftercall.app/verify#x" });
  assert.equal(r.subject, "Recap: API fix");
  assert.match(r.text, /^Hi Ada, thanks for the call/);
  assert.match(r.text, /1\. Ship the API fix before Friday's demo\./);
  assert.match(r.text, /- Ship the API fix · Victor · by Friday/);
  assert.doesNotMatch(r.text, /Old thing/, "done items are left out");
  assert.match(r.text, /recorded with notice to everyone.*Verify how it was processed: https:\/\/aftercall\.app\/verify#x/s);
});

test("mailto links keep the address readable and encode the rest", () => {
  const link = mailtoLink(buildRecap(meeting, f));
  assert.ok(link.startsWith("mailto:ada@example.com?subject=Recap%3A%20API%20fix&body=Hi%20Ada"));
  assert.ok(!link.includes("\n"));
});

test("a recap never includes your notes", () => {
  const r = buildRecap({ ...meeting, yourNotes: "Ada seemed unsure about the price. Push back on Friday." }, f, { sender: "Victor" });
  assert.doesNotMatch(r.text, /unsure|Push back/);
  assert.doesNotMatch(mailtoLink(r), /unsure/);
});
