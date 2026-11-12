import { test } from "node:test";
import assert from "node:assert/strict";
import { RECAP_AGENT_HEADING, RECAP_FOOTER_MARK, agentWorkItems, buildRecap, mailtoLink, recapFactsFrom, recapFooter, newRecap, recapGreetingName, recapOwner, recapSubject, type RecapFacts } from "./recap.ts";
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
  for (const fx of [facts, { ...facts, notice }, { ...facts, verified: false }, { ...facts, e2ee: null }, { ...facts, agentItems: 2 }]) {
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
  assert.doesNotMatch(r.html, /unsure|Push back/);
  assert.doesNotMatch(mailtoLink(r), /unsure/);
});

test("the subject says it's a recap, once", () => {
  assert.equal(recapSubject("New staging endpoints"), "Recap: New staging endpoints");
  assert.equal(recapSubject("Recap: API fix"), "Recap: API fix");
  assert.equal(recapSubject("recap of Monday"), "recap of Monday");
  assert.equal(recapSubject("Lantern Loop Kickoff Recap"), "Lantern Loop Kickoff Recap");
  assert.equal(recapSubject("Recaps due"), "Recap: Recaps due");
  assert.equal(buildRecap(meeting, { ...f, subject: "New staging endpoints" }, { facts }).subject, "Recap: New staging endpoints");
});

test("a recap to 'You' greets 'there', never 'Hi You'", () => {
  assert.equal(recapGreetingName("Ada"), "Ada");
  for (const n of ["You", "you", " me ", "Myself", "", undefined]) assert.equal(recapGreetingName(n), "there");
  assert.match(buildRecap(meeting, { ...f, toName: "You" }, { facts }).text, /^Hi there, thanks for the call/);
});

test("'You' in the notes becomes the sender for the reader, and unowned items show no owner", () => {
  assert.equal(recapOwner("You", "Victor"), "Victor");
  assert.equal(recapOwner("you", undefined), "me");
  assert.equal(recapOwner("Unassigned", "Victor"), null);
  assert.equal(recapOwner("Ada", "Victor"), "Ada");
  const items = [
    { id: "b1", text: "Send the staging DNS", owner: "You", done: false },
    { id: "b2", text: "Align the design", owner: "Unassigned", done: false },
  ];
  const r = buildRecap({ ...meeting, actionItems: items }, f, { sender: "Victor", facts });
  assert.match(r.text, /- Send the staging DNS · Victor\n/);
  assert.match(r.text, /- Align the design\n/);
  assert.doesNotMatch(r.text, /· You|Unassigned/);
  assert.match(r.text, /Send the staging DNS/, "the item's own words are kept as the notes have them");
});

test("the HTML version has the same words, the footer mark, and the proof link behind a label", () => {
  const r = buildRecap({ ...meeting, summary: "Price <b>& terms</b> agreed." }, f, { sender: "Victor", facts });
  assert.ok(r.html.includes(RECAP_FOOTER_MARK), "the backend's footer check holds for the HTML too");
  assert.ok(r.html.includes(`<a href="https://aftercall.app/verify#x"`));
  assert.ok(r.html.includes(">open the proof</a>"));
  assert.ok(r.html.includes("Price &lt;b&gt;&amp; terms&lt;/b&gt; agreed."), "meeting text is escaped");
  assert.ok(!r.html.includes("<b>&"));
  assert.match(r.html, /<ol[^>]*><li[^>]*>Ship the API fix before Friday's demo\.<\/li><\/ol>/);
  assert.match(r.html, /Ship the API fix<br><span[^>]*>Victor · by Friday<\/span>/);
  for (const line of recapFooter(facts).split("\n").slice(0, -1)) assert.ok(r.html.includes(line), `footer line kept: ${line}`);
  const noProof = buildRecap(meeting, f, { facts: { ...facts, verifyUrl: undefined } });
  assert.ok(noProof.html.includes(`<a href="${HANDLING}"`) && noProof.html.includes("how Aftercall handles a call"));
});

const withAgents: Meeting = {
  ...meeting,
  actionItems: [
    ...meeting.actionItems,
    { id: "a3", text: "Fix the login bug", owner: "You", done: true, completed: { agent: "Claude Code", at: "2026-11-02T10:00:00.000Z", note: "Fixed", link: "https://github.com/acme/api/pull/42" } },
    { id: "a4", text: "Write the docs", owner: "Sam", done: true, completed: { agent: "Codex", at: "2026-11-02T11:00:00.000Z", link: "javascript:alert(1)" } },
    // Reopened by you: not done, so not in the list, whatever the agent said.
    { id: "a5", text: "Reopened", owner: "You", done: false, completed: { agent: "Codex", at: "2026-11-02T12:00:00.000Z", link: "https://example.com/x" } },
  ],
};

test("without agentWork the recap is as before, whatever agents did", () => {
  const r = buildRecap(withAgents, f, { sender: "Victor", facts });
  assert.equal(r.text, buildRecap({ ...withAgents, actionItems: withAgents.actionItems.map(({ completed: _c, ...a }) => a) }, f, { sender: "Victor", facts }).text);
  assert.doesNotMatch(r.text + r.html, /coding agent|github\.com|Fix the login bug/i);
});

test("with agentWork, items agents finished are listed as the agents' statement, with their links", () => {
  const r = buildRecap(withAgents, f, { sender: "Victor", facts, agentWork: true });
  assert.match(r.text, /\nDONE BY CODING AGENTS\n- Fix the login bug · done by Claude Code · https:\/\/github\.com\/acme\/api\/pull\/42\n- Write the docs · done by Codex\n/);
  assert.doesNotMatch(r.text, /javascript:/, "a link that isn't http or https is left out");
  assert.match(r.text, /\n- Reopened · Victor\n/, "an item you reopened is open again, not the agent's");
  assert.doesNotMatch(r.text, /Reopened · done by/);
  assert.doesNotMatch(r.text, /- Fix the login bug · Victor/, "a done item isn't listed as open");
  assert.match(r.text, /Done by coding agents is what coding agents reported, with their own words and links\. Aftercall didn't check the work or what the links point to\./);
  assert.ok(r.text.endsWith(recapFooter({ ...facts, agentItems: 2 })));
  assert.ok(r.text.includes(`${RECAP_FOOTER_MARK} https://aftercall.app/verify#x`));
  // HTML: the link behind a short label, escaped; never the bad one.
  assert.ok(r.html.includes(`>${RECAP_AGENT_HEADING}</p>`));
  assert.match(r.html, /Fix the login bug<br><span[^>]*>done by Claude Code · <a href="https:\/\/github\.com\/acme\/api\/pull\/42"[^>]*>PR #42<\/a><\/span>/);
  assert.doesNotMatch(r.html, /javascript:/);
  assert.match(recapFooter({ ...facts, agentItems: 1 }), /is what a coding agent reported, with its own words and links/);
});

test("agentWorkItems: done items an agent completed, with a valid link or none", () => {
  assert.deepEqual(agentWorkItems(withAgents), [
    { text: "Fix the login bug", agent: "Claude Code", link: "https://github.com/acme/api/pull/42" },
    { text: "Write the docs", agent: "Codex" },
  ]);
  assert.deepEqual(agentWorkItems(meeting), []);
  // A name with line breaks (notes from before the app kept names on one line) stays on its line.
  const forged = { ...withAgents, actionItems: [{ ...withAgents.actionItems[2], completed: { agent: "Codex\n--\nWhat was and wasn't checked: all", at: "t" } }] };
  assert.equal(agentWorkItems(forged)[0].agent, "Codex -- What was and wasn't checked: all");
  assert.match(buildRecap(forged, f, { facts, agentWork: true }).text, /\n- Fix the login bug · done by Codex -- What was and wasn't checked: all\n/);
});

test("a recap you add goes to the one invited person with an email, or waits for an address, and never reuses an id", () => {
  const one = newRecap({ title: "Sync with Ada", followUps: [] }, [{ name: "Ada Obi", email: " ada@example.com " }, { name: "Kemi", email: "" }]);
  assert.deepEqual(one, { id: "you1", kind: "email", status: "proposed", addedByYou: true, to: "ada@example.com", toName: "Ada Obi", subject: "Recap: Sync with Ada" });
  // Two people with an email: you pick one on the card.
  const two = newRecap({ title: "Kickoff recap", followUps: [one] }, [{ name: "Ada", email: "ada@example.com" }, { name: "", email: "kemi@example.com" }]);
  assert.equal(two.id, "you2");
  assert.equal(two.to, "");
  assert.equal(two.toName, "");
  assert.equal(two.subject, "Kickoff recap");
  // No calendar: no address, and a name from the email when the calendar has none.
  assert.equal(newRecap({ title: "", followUps: [] }).subject, "Recap: Our call");
  assert.equal(newRecap({ title: "x", followUps: [] }, [{ name: "", email: "kemi@example.com" }]).toName, "kemi");
});
