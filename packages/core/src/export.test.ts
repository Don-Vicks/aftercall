import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPORT_EDITED_MARK, LEDGER_COLUMNS, escapeMarkdown, ledgerAmount, ledgerCsv, ledgerTime, meetingExport, meetingMarkdown, type LedgerRow } from "./export.ts";
import type { EmailFollowUp, Meeting, PaymentFollowUp } from "./meeting.ts";

const startedAt = new Date(2026, 10, 1, 14, 2).toISOString();
const now = new Date(2026, 10, 2, 9, 0).getTime();

const meeting: Meeting = {
  id: "m1",
  project: "Fundraise",
  title: "Sync with Ada",
  startedAt,
  durationSec: 192,
  verified: true,
  summary: "The API fix ships before Friday.",
  decisions: ["Ship the API fix before Friday's demo."],
  actionItems: [
    { id: "a1", text: "Ship the API fix", owner: "victor.near", due: "by Friday", done: false },
    { id: "a2", text: "Send the deck", owner: "Ada", done: true, completed: { agent: "Claude Code", at: startedAt } },
    { id: "a3", text: "Book the venue", owner: "Unassigned", done: false },
  ],
  followUps: [
    { id: "f1", kind: "email", status: "proposed", to: "ada@example.com", toName: "Ada", subject: "Recap", evidence: { quote: "send Ada the recap", at: 10 } },
    {
      id: "f2",
      kind: "payment",
      status: "paid",
      doneAt: "14:06",
      ref: "9xTxHash",
      payeeName: "Designer",
      payeeAccount: "designer.near",
      amount: 50_000_000n,
      heard: "fifty USDC",
      payeeListed: true,
      evidence: { quote: "pay the designer fifty", at: 20 },
    },
    {
      id: "f3",
      kind: "payment",
      status: "dismissed",
      payeeName: "Printer",
      payeeAccount: "printer.near",
      amount: 5_000_000n,
      heard: "five",
      payeeListed: true,
      evidence: { quote: "maybe pay the printer", at: 30 },
    },
  ],
  transcript: [
    { at: 10, speaker: "you", text: "I'll send Ada the recap." },
    { at: 20, speaker: "others", text: "And pay the designer fifty." },
  ],
  yourNotes: "Ada seemed unsure about the date.",
  attendees: [{ name: "Ada", email: "ada@example.com" }],
};

test("the export carries the title, date, project, people, summary, decisions, items, follow-ups and verification", () => {
  const md = meetingMarkdown(meeting, { me: ["victor.near"], now });
  assert.match(md, /^# Sync with Ada\n/);
  assert.match(md, /- Date: Sunday 1 Nov 2026, 14:02/);
  assert.match(md, /- Length: 3 min 12 s/);
  assert.match(md, /- Project: Fundraise/);
  assert.match(md, /- People: You and Ada/);
  assert.match(md, /## Summary\n\nThe API fix ships before Friday\./);
  assert.match(md, /## Decisions\n\n1\. Ship the API fix before Friday's demo\./);
  assert.match(md, /- \[ \] Ship the API fix · You · by Friday\n/);
  assert.match(md, /- \[x\] Send the deck · Ada \(Done by Claude Code\)\n/);
  assert.match(md, /- \[ \] Book the venue\n/, "Unassigned isn't shown as an owner");
  assert.match(md, /- Recap to Ada: Proposed, not sent/);
  assert.match(md, /- Pay Designer 50\.00 USDC: Paid at 14:06/);
  assert.match(md, /## Verification\n\nVerified\. .*\n\nTo see the checks, open this meeting in Aftercall and choose Verified\./);
  assert.match(md, /_Exported from Aftercall on Monday 2 Nov 2026\._\n$/);
});

test("the export leaves out other people's addresses, accounts, transaction ids and dismissed follow-ups", () => {
  const md = meetingMarkdown(meeting, { now });
  assert.doesNotMatch(md, /ada@example\.com/);
  assert.doesNotMatch(md, /designer\.near/);
  assert.doesNotMatch(md, /9xTxHash/);
  assert.doesNotMatch(md, /Printer/, "dismissed follow-ups aren't on the page, so they aren't exported");
});

test("your notes and the transcript are left out unless you ask for them", () => {
  const plain = meetingMarkdown(meeting, { now });
  assert.doesNotMatch(plain, /Your notes|unsure about the date/);
  assert.doesNotMatch(plain, /Transcript|I'll send Ada the recap/);

  const full = meetingMarkdown(meeting, { now, yourNotes: true, transcript: true });
  assert.match(full, /## Your notes\n\n_Typed during the call\._\n\nAda seemed unsure about the date\./);
  assert.match(full, /## Transcript\n\n\*\*00:10 You:\*\* I'll send Ada the recap\.\n\n\*\*00:20 Ada:\*\* And pay the designer fifty\./);
  assert.ok(full.indexOf("## Your notes") < full.indexOf("## Decisions"), "your notes sit above the AI notes, as on the page");
  assert.ok(full.indexOf("## Transcript") > full.indexOf("## Verification"));

  // Asking for notes the meeting doesn't have adds no empty section.
  assert.doesNotMatch(meetingMarkdown({ ...meeting, yourNotes: "  " }, { now, yourNotes: true }), /Your notes/);
  assert.match(meetingMarkdown({ ...meeting, transcript: [] }, { now, transcript: true }), /## Transcript\n\nThis meeting has no transcript\./);
});

test("someone the calendar has no name for is counted, never shown by their email", () => {
  const alone = { ...meeting, attendees: [{ name: "", email: "theo@example.com" }] };
  const md = meetingMarkdown(alone, { now, transcript: true });
  assert.match(md, /- People: You and 1 other person\n/);
  assert.match(md, /\*\*00:20 Others:\*\* And pay the designer fifty\./);
  assert.doesNotMatch(md, /theo@example\.com/);

  const mixed = { ...meeting, attendees: [{ name: "Ada", email: "ada@example.com" }, { name: " ", email: "theo@example.com" }, { name: "", email: "mo@example.com" }] };
  const both = meetingMarkdown(mixed, { now, transcript: true });
  assert.match(both, /- People: You, Ada and 2 others\n/);
  assert.doesNotMatch(both, /@example\.com/);
  assert.match(meetingMarkdown({ ...meeting, attendees: [{ name: "Ada", email: "" }, { name: "", email: "theo@example.com" }] }, { now }), /- People: You, Ada and 1 other\n/);

  // Notes saved before `attendees` existed keep only the people with an email.
  const old = { ...meeting, attendees: undefined, invited: [{ name: "", email: "theo@example.com" }] };
  assert.doesNotMatch(meetingMarkdown(old, { now, transcript: true }), /theo@example\.com/);
});

test("with two or more people on the other side, transcript lines say Others, as on the page", () => {
  const two = { ...meeting, attendees: [{ name: "Ada", email: "" }, { name: "Theo Moss", email: "" }] };
  const md = meetingMarkdown(two, { now, transcript: true });
  assert.match(md, /- People: You, Ada and Theo Moss/);
  assert.match(md, /\*\*00:20 Others:\*\*/);
});

test("edited action items are marked, and the verification says the changes weren't checked", () => {
  const edited = { at: startedAt, fields: ["text" as const] };
  const one = { ...meeting, actionItems: [{ ...meeting.actionItems[0], edited }, meeting.actionItems[1]] };
  const md = meetingMarkdown(one, { now });
  assert.match(md, new RegExp(`- \\[ \\] Ship the API fix · victor\\.near · by Friday \\(edited by you\\)`));
  assert.equal(EXPORT_EDITED_MARK, "(edited by you)");
  assert.match(md, /You changed 1 action item after the notes were made, marked \(edited by you\)\. That change isn't part of what was checked\./);

  const two = { ...one, actionItems: [...one.actionItems, { ...meeting.actionItems[2], edited }] };
  assert.match(meetingMarkdown(two, { now }), /You changed 2 action items .* Those changes aren't part of what was checked\./);
  assert.doesNotMatch(meetingMarkdown(meeting, { now }), /edited|You changed/);
});

test("follow-up statuses read in plain words", () => {
  const email = meeting.followUps[0] as EmailFollowUp;
  const pay = meeting.followUps[1] as PaymentFollowUp;
  const status = (f: Meeting["followUps"][number]) => meetingExport({ ...meeting, followUps: [f] }, { now }).followUps[0];
  assert.equal(status({ ...email, status: "sent", doneAt: "14:10" }).status, "Sent at 14:10");
  assert.equal(status({ ...email, status: "sent", doneAt: "14:10", byAutopilot: true }).status, "Sent at 14:10 by autopilot");
  assert.equal(status({ ...email, status: "sent", doneAt: "14:10", byPhone: true }).status, "Sent at 14:10, approved on your phone");
  assert.equal(status({ ...email, status: "failed" }).status, "Didn't send");
  assert.match(status({ ...email, draftedAt: "14:08" }).status, /Opened as a draft in Mail at 14:08\. Aftercall can't tell whether it was sent/);
  assert.equal(status({ ...email, slackPostedAt: "14:09" }).status, "Posted to Slack at 14:09");
  assert.equal(status({ ...email, draftedAt: "14:08", slackPostedAt: "14:09" }).status, "Posted to Slack at 14:09", "a post is known to have gone; a draft isn't");
  assert.equal(status({ ...email, status: "sent", doneAt: "14:10", slackPostedAt: "14:12" }).status, "Sent at 14:10. Posted to Slack at 14:12");
  assert.equal(status({ ...email, toName: "" }).title, "Recap to someone");
  assert.equal(status({ ...pay, status: "proposed" }).status, "Proposed, not paid");
  assert.equal(status({ ...pay, status: "blocked" }).status, "Over your caps, waiting for your wallet");
  assert.equal(status({ ...pay, status: "failed" }).status, "Didn't go through");
  assert.equal(status({ ...pay, status: "proposed", autopilotAt: now }).status, "Waiting for autopilot to pay it");
  assert.match(status({ ...pay, status: "proposed", payeeListed: false }).status, /Not on your payee list yet/);
  assert.equal(status({ ...pay, amount: null }).title, "Pay Designer (amount unclear)");
});

test("verification says what the app knows and nothing about the proof's internals", () => {
  const unverified = meetingMarkdown({ ...meeting, verified: false }, { now });
  assert.match(unverified, /Not verified\. Not every secure-hardware check passed for this meeting\./);
  assert.match(unverified, /choose Not verified\./);
  assert.match(meetingMarkdown({ ...meeting, verified: false }, { now, onNear: true }), /choose Not verified\.\n\nThe proof is also recorded on NEAR, and that sheet can copy a link/);
  assert.match(meetingMarkdown(meeting, { now, onNear: true }), /The proof is also recorded on NEAR/);
  assert.doesNotMatch(meetingMarkdown(meeting, { now }), /recorded on NEAR/);
  for (const md of [unverified, meetingMarkdown(meeting, { now, onNear: true })]) {
    assert.doesNotMatch(md, /hash|attestation|nonce|signature:|https?:\/\//i);
  }
});

test("samples are labelled, and the made-up sample doesn't claim to be verified", () => {
  const madeUp = meetingMarkdown(meeting, { now, sample: "made-up" });
  assert.match(madeUp, /^# Sync with Ada\n\n\*\*Sample\. A made-up meeting/);
  assert.match(madeUp, /## Verification\n\nThis sample was written by hand, so there is no proof to check\./);
  assert.doesNotMatch(madeUp, /^Verified\./m);

  const fictional = meetingMarkdown(meeting, { now, sample: "fictional" });
  assert.match(fictional, /\*\*Sample\. A fictional call/);
  assert.match(fictional, /^Verified\./m, "a fictional call processed on NEAR AI has real checks");
  assert.doesNotMatch(meetingMarkdown(meeting, { now }), /Sample/);
});

test("a meeting with no real time keeps its stored label as the date", () => {
  assert.match(meetingMarkdown({ ...meeting, id: "sample", startedAt: "Last spring" }, { now }), /- Date: Last spring/);
});

test("Markdown in model, transcript and your text is escaped, so it reads as the same words", () => {
  assert.equal(escapeMarkdown("*bold* _it_ `code` [link](x) <b>hi</b> a|b ~x~ back\\slash"), "\\*bold\\* \\_it\\_ \\`code\\` \\[link\\](x) \\<b\\>hi\\</b\\> a\\|b \\~x\\~ back\\\\slash");
  assert.equal(escapeMarkdown("# not a heading"), "\\# not a heading");
  assert.equal(escapeMarkdown("> not a quote"), "\\> not a quote");
  assert.equal(escapeMarkdown("- not a list"), "\\- not a list");
  assert.equal(escapeMarkdown("+ not a list"), "\\+ not a list");
  assert.equal(escapeMarkdown("1. not a list"), "1\\. not a list");
  assert.equal(escapeMarkdown("    not code"), "not code");
  assert.equal(escapeMarkdown("&amp; stays &amp;"), "\\&amp; stays \\&amp;");
  assert.equal(escapeMarkdown("R&D and 50 USDC - 10 #3"), "R&D and 50 USDC - 10 #3", "ordinary text is left alone");
  assert.equal(escapeMarkdown("see https://example.com/a"), "see https://example.com/a", "a bare address is left as written; the app you paste into may link it");

  const nasty: Meeting = {
    ...meeting,
    title: "Q3 plan ##",
    summary: "Line one *really*\n# Line two\n\n[click](javascript:alert(1))",
    decisions: ["1. Use <script>alert(1)</script>"],
    actionItems: [{ id: "a1", text: "Fix `rm -rf` docs\nnow", owner: "Ada_B", due: "[Friday]", done: false }],
    followUps: [{ ...(meeting.followUps[0] as EmailFollowUp), toName: "Ada*" }],
    transcript: [{ at: 5, speaker: "you", text: "## shouting\n- and a list" }],
    yourNotes: "> quoted\n- dash",
  };
  const md = meetingMarkdown(nasty, { now, transcript: true, yourNotes: true });
  assert.match(md, /^# Q3 plan \\#\\#\n/);
  assert.match(md, /Line one \\\*really\\\*  \n\\# Line two\n\n\\\[click\\\]\(javascript:alert\(1\)\)/);
  assert.match(md, /1\. 1\\\. Use \\<script\\>alert\(1\)\\<\/script\\>/);
  assert.match(md, /- \[ \] Fix \\`rm -rf\\` docs now · Ada\\_B · \\\[Friday\\\]\n/);
  assert.match(md, /- Recap to Ada\\\*: Proposed, not sent/);
  assert.match(md, /\*\*00:05 You:\*\* \\## shouting - and a list\n/, "a line break inside one line becomes a space, so only the start needs escaping");
  assert.match(md, /\\> quoted  \n\\- dash/);
  assert.doesNotMatch(md, /<script>/);
});

// ---------- The money trail as CSV ----------

const row: LedgerRow = {
  date: "2026-11-12T09:49:31Z",
  meeting: "Illustrator Payment for Bike Icon",
  payee: "Illustrator",
  payeeAccount: "demo-freelancer.aftercall.testnet",
  amount: 1_000_000n,
  status: "paid",
  approvedBy: "you or autopilot",
  network: "testnet",
  tx: "Ay4Yte5eqPX5MYg676jfAjiBcCQgnyoXnSG1faFVcPDP",
  proofTx: "Af4cs3PnouGWKhciSgbHmmE1kgqD1rsggXT4GdtLJZzi",
  note: "Paid from your agent wallet within your caps.",
};

/** A small RFC 4180 reader for the tests: every field quoted, doubled quotes, CRLF records. */
function parseCsv(text: string): string[][] {
  assert.ok(text.endsWith("\r\n"), "every record ends with CRLF");
  return text
    .slice(0, -2)
    .split("\r\n")
    .map((line) => {
      const fields = [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)];
      assert.equal(fields.map((m) => m[0]).join(""), line, `every field of ${line} is quoted`);
      return fields.map((m) => m[1].replace(/""/g, '"'));
    });
}

test("the ledger CSV has a header row, every field quoted, CRLF line ends and explorer links", () => {
  const csv = ledgerCsv([row]);
  assert.equal(csv.split("\r\n")[0], '"Date (UTC)","Meeting","Payee","Payee account","Amount","Currency","Status","Approved by","Transaction","Meeting proof","Note"');
  const [header, line, ...rest] = parseCsv(csv);
  assert.deepEqual(header, [...LEDGER_COLUMNS]);
  assert.equal(rest.length, 0);
  assert.deepEqual(line, [
    "2026-11-12T09:49:31Z",
    "Illustrator Payment for Bike Icon",
    "Illustrator",
    "demo-freelancer.aftercall.testnet",
    "1.00",
    "USDC",
    "paid",
    "you or autopilot",
    "https://testnet.nearblocks.io/txns/Ay4Yte5eqPX5MYg676jfAjiBcCQgnyoXnSG1faFVcPDP",
    "https://testnet.nearblocks.io/txns/Af4cs3PnouGWKhciSgbHmmE1kgqD1rsggXT4GdtLJZzi",
    "Paid from your agent wallet within your caps.",
  ]);
  assert.equal(csv.match(/\n/g)?.length, 2, "one line per record: no bare LF anywhere");
  assert.equal(ledgerCsv([]), `${csv.split("\r\n")[0]}\r\n`, "no rows is just the header");
});

test("mainnet rows link to the mainnet explorer, and the date column can say it holds the meeting's start", () => {
  const [, line] = parseCsv(ledgerCsv([{ ...row, network: "mainnet" }]));
  assert.equal(line[8], "https://nearblocks.io/txns/Ay4Yte5eqPX5MYg676jfAjiBcCQgnyoXnSG1faFVcPDP");
  assert.equal(parseCsv(ledgerCsv([row], { dates: "meeting" }))[0][0], "Meeting date (UTC)");
  const [, bare] = parseCsv(ledgerCsv([{ ...row, tx: "", proofTx: "", amount: null, payee: "", approvedBy: "" }]));
  assert.deepEqual([bare[2], bare[4], bare[7], bare[8], bare[9]], ["demo-freelancer.aftercall.testnet", "", "", "", ""], "no label shows the account; nothing known stays empty");
});

test("amounts have two decimals and no separators, and are never rounded", () => {
  assert.equal(ledgerAmount(5_000_000_000n), "5000.00");
  assert.equal(ledgerAmount(500_000n), "0.50");
  assert.equal(ledgerAmount(1n), "0.000001", "a sub-cent amount keeps its digits rather than reading 0.00");
  assert.equal(ledgerAmount(1_234_560n), "1.23456");
  assert.equal(ledgerAmount(0n), "0.00");
});

test("times are UTC to the second", () => {
  assert.equal(ledgerTime(Date.UTC(2026, 10, 12, 9, 49, 31, 999)), "2026-11-12T09:49:31Z");
  assert.equal(ledgerTime(Number.NaN), "");
});

test("quotes, commas, line breaks and would-be formulas in text from a call stay plain text", () => {
  const nasty = { ...row, meeting: 'Sync, "Q3"\r\nplan', payee: '=HYPERLINK("http://evil","x")', note: "+1 then -2 @all" };
  const [, line] = parseCsv(ledgerCsv([nasty]));
  assert.equal(line[1], 'Sync, "Q3" plan');
  assert.equal(line[2], `'=HYPERLINK("http://evil","x")`);
  assert.equal(line[10], "'+1 then -2 @all");
  assert.equal(parseCsv(ledgerCsv([{ ...row, payee: "-5" }]))[1][2], "'-5");
  assert.equal(parseCsv(ledgerCsv([{ ...row, payee: " @ada" }]))[1][2], "'@ada", "checked after trimming");
  assert.equal(parseCsv(ledgerCsv([{ ...row, payee: "Ada = Designer" }]))[1][2], "Ada = Designer", "only a leading mark is defused");
});
