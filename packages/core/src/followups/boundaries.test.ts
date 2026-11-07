import { test } from "node:test";
import assert from "node:assert/strict";
import { PAY_MEMO, emailWhatLeaves, participantNotice, paymentWhatLeaves } from "./boundaries.ts";
import { buildRecap, recapFooter, type RecapFacts } from "./recap.ts";
import type { EmailFollowUp, Meeting, PaymentFollowUp } from "../meeting.ts";

const meeting: Meeting = {
  id: "1762000000", project: "Fundraise", title: "Sync with Ada", startedAt: "Today 14:02", durationSec: 192, verified: true,
  summary: "The API fix ships before Friday.",
  decisions: ["Ship the API fix before Friday's demo."],
  actionItems: [
    { id: "a1", text: "Ship the API fix", owner: "Victor", due: "by Friday", done: false },
    { id: "a2", text: "Book the venue", owner: "Ada", done: false },
    { id: "a3", text: "Old thing", owner: "Ada", done: true },
  ],
  followUps: [], transcript: [],
};
const email: EmailFollowUp = { id: "f1", kind: "email", status: "proposed", to: "ada@example.com", toName: "Ada", subject: "Recap", evidence: { quote: "send Ada the recap", at: 0 } };
const payment: PaymentFollowUp = {
  id: "f2", kind: "payment", status: "proposed", payeeName: "Ada", payeeAccount: "ada.near", amount: 50_000_000n, heard: "fifty dollars", payeeListed: true,
  evidence: { quote: "pay Ada fifty dollars", at: 10 },
};

test("a recap's what-leaves counts what buildRecap puts in, and names the address", () => {
  const w = emailWhatLeaves(meeting, email, { backend: true });
  assert.match(w.details[0], /the summary, 1 decision, 2 open action items and a footer on what was checked\. It goes to ada@example\.com\./);
  const facts: RecapFacts = { verified: true, e2ee: true, handlingUrl: "https://x/handling" };
  const text = buildRecap(meeting, email, { facts }).text;
  assert.equal((text.match(/^- /gm) ?? []).length, 2, "the recap has the same open items");
  assert.ok(text.endsWith(recapFooter(facts)));
  assert.equal(emailWhatLeaves(meeting, { to: "" }, { backend: false }).details[0].endsWith("It goes to the address you add."), true);
});

test("a recap that says what agents finished counts those items too, as the recap does", () => {
  const done = { agent: "Claude Code", at: "2026-11-02T10:00:00.000Z", link: "https://github.com/acme/api/pull/42" };
  const m = { ...meeting, actionItems: [...meeting.actionItems, { id: "a4", text: "Fix the login bug", owner: "You", done: true, completed: done }] };
  assert.match(emailWhatLeaves(m, email, { backend: false, agentWork: true }).details[0], /2 open action items, 1 item a coding agent marked done, with its link and a footer/);
  assert.doesNotMatch(emailWhatLeaves(m, email, { backend: false }).details[0], /coding agent/, "off unless the recap includes them");
  const facts: RecapFacts = { verified: true, e2ee: true, handlingUrl: "https://x/handling" };
  assert.equal((buildRecap(m, email, { facts, agentWork: true }).text.match(/^- /gm) ?? []).length, 3);
});

test("Draft in Mail stays off Aftercall's servers; Send through Aftercall names the backend and Resend only when the build has it", () => {
  const withBackend = emailWhatLeaves(meeting, email, { backend: true }).details.join(" ");
  assert.match(withBackend, /Draft in Mail opens it in your own mail app; Aftercall's servers never see it\./);
  assert.match(withBackend, /in memory for this one request, then Resend, which keeps sent mail under its own policy/);
  assert.doesNotMatch(emailWhatLeaves(meeting, email, { backend: false }).details.join(" "), /Resend|backend/);
});

test("a payment's what-leaves lists exactly what goes on NEAR, the fixed memo, and who approves", () => {
  const w = paymentWhatLeaves(payment);
  assert.equal(PAY_MEMO, "Aftercall payment");
  assert.match(w.details[0], /^On NEAR, publicly and for good: ada\.near, 50\.00 USDC, the memo “Aftercall payment” and an id made of the recording's start time and this follow-up's number\. Nothing from the meeting\.$/);
  assert.match(w.details[1], /You approve it.*within your caps\. Over a cap it waits for your own NEAR wallet\./);
  assert.equal(w.details.length, 2, "no 1Click or claim-link line for a plain NEAR payment");
  assert.doesNotMatch(w.details.join(" "), new RegExp(meeting.title), "nothing from the meeting");
  assert.match(paymentWhatLeaves({ ...payment, amount: null }).details[0], /ada\.near, the amount,/);
});

test("a cross-chain payment also says what 1Click sees, and that over a cap it's refused", () => {
  const w = paymentWhatLeaves(payment, { route: { chain: "solana", address: "So1anaAddr" } });
  assert.match(w.details[0], /with NEAR Intents' deposit address and quote id\. Nothing from the meeting\./);
  assert.match(w.details[1], /Over a cap it's refused, not parked\./);
  assert.equal(w.details[2], "NEAR Intents 1Click sees the amount, the Solana address and your NEAR account for refunds.");
});

test("a payee not on the list: no account named yet, and a claim link's line only when the build offers claim links", () => {
  const unlisted = { ...payment, payeeListed: false, payeeAccount: "" };
  assert.match(paymentWhatLeaves(unlisted, { claimLinks: false }).details[0], /the payee's NEAR account/);
  assert.equal(paymentWhatLeaves(unlisted, { claimLinks: false }).details.length, 2);
  const claim = paymentWhatLeaves(unlisted, { claimLinks: true, route: { chain: "base", address: "0xabc" } });
  assert.doesNotMatch(claim.details.join(" "), /1Click/, "a route only counts for a listed payee");
  assert.match(claim.details.at(-1)!, /keeps the amount, your account and a hash of the link's token on Aftercall's backend; Ada's name and the meeting title stay in the link\./);
});

test("the participant notice links what's checked and claims only what the app does", () => {
  const n = participantNotice("https://getaftercall.vercel.app/handling");
  assert.ok(n.endsWith("What's checked: https://getaftercall.vercel.app/handling"));
  assert.match(n, /I'm recording this call with Aftercall/, "it says it's a recording");
  assert.match(n, /secure hardware on NEAR AI Cloud/);
  assert.ok(n.includes("Aftercall deletes the call's audio once the notes are saved."), "the same words as the recap footer");
  assert.ok(recapFooter({ verified: true, e2ee: true, handlingUrl: "x" }).includes("Aftercall deletes the call's audio once the notes are saved."));
  assert.match(n, /You may get a recap\./, "a recap goes only if the sender sends one");
  assert.doesNotMatch(n, /never|guarantee|you'll get|train|private/i);
});
