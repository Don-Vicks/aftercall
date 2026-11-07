import { test } from "node:test";
import assert from "node:assert/strict";
import { amountNote, buildMeeting, checkedAmount } from "./build.ts";
import { autopilotDecision } from "../followups/autopilot.ts";
import { NOTES_SYSTEM_PROMPT, notesJsonSchema, notesSchema, type Notes } from "./schema.ts";
import type { PaymentFollowUp, TranscriptLine } from "../meeting.ts";

const transcript: TranscriptLine[] = [
  { at: 31, speaker: "others", text: "The API fix has to ship before the demo." },
  { at: 134, speaker: "you", text: "Send Ada the recap after this call, and pay the designer the fifty dollar deposit today." },
];

const notes: Notes = notesSchema.parse({
  title: "Sync with Ada",
  summary: "The API fix ships before the demo. A 50 USDC deposit goes to the designer.",
  decisions: [
    { text: "Ship the API fix before the demo.", evidence: "The API fix has to ship before the demo" },
    { text: "Hire a second designer.", evidence: "we should hire a second designer" },
  ],
  action_items: [{ text: "Send Ada the recap", owner: "Victor", due: "today", evidence: "Send Ada the recap after this call" }],
  followups: [
    { type: "email", to_name: "Ada", subject: "Recap: API fix before the demo", evidence: "Send Ada the recap after this call" },
    { type: "payment", payee_name: "Designer", amount_words: "fifty dollar", memo: "deposit", evidence: "pay the designer the fifty dollar deposit today" },
    { type: "payment", payee_name: "Designer", amount_words: "five thousand", memo: null, evidence: "and the full five thousand when the deck is done" },
  ],
});

const base = { id: "m1", project: "Fundraise", startedAt: "Today 14:02", durationSec: 192, transcript, verified: true };

test("keeps what the transcript backs up and drops what it doesn't", () => {
  const { meeting, dropped } = buildMeeting({ ...base, notes, payees: [{ name: "Designer", account: "designer.near" }] });
  assert.deepEqual(meeting.decisions, ["Ship the API fix before the demo."]);
  assert.equal(meeting.actionItems.length, 1);
  assert.equal(meeting.followUps.length, 2);
  assert.deepEqual(
    dropped.map((d) => [d.kind, d.text]),
    [
      ["decision", "Hire a second designer."],
      ["follow-up", "Pay Designer five thousand"],
    ],
  );
});

test("decisions and action items keep the quote behind them, as spelled in the transcript, with its time", () => {
  const { meeting } = buildMeeting({ ...base, notes, payees: [] });
  assert.deepEqual(meeting.decisionEvidence, [{ quote: "The API fix has to ship before the demo", at: 31 }]);
  assert.equal(meeting.decisionEvidence?.length, meeting.decisions.length, "one quote per kept decision, in order");
  assert.deepEqual(meeting.actionItems[0].evidence, { quote: "Send Ada the recap after this call", at: 134 });

  // The model's words differ in case and punctuation; the kept quote is the transcript's.
  const loose = notesSchema.parse({ ...notes, decisions: [{ text: "Ship first.", evidence: "the api fix HAS to ship before the demo" }] });
  assert.deepEqual(buildMeeting({ ...base, notes: loose, payees: [] }).meeting.decisionEvidence, [{ quote: "The API fix has to ship before the demo", at: 31 }]);
});

test("payments carry the heard words, the parsed amount and the listed payee", () => {
  const { meeting } = buildMeeting({ ...base, notes, payees: [{ name: "Designer", account: "designer.near" }] });
  const pay = meeting.followUps.find((f) => f.kind === "payment");
  assert.ok(pay && pay.kind === "payment");
  assert.equal(pay.heard, "fifty dollar");
  assert.equal(pay.amount, 50_000_000n);
  assert.equal(pay.payeeAccount, "designer.near");
  assert.equal(pay.payeeListed, true);
  assert.deepEqual(pay.evidence, { quote: "pay the designer the fifty dollar deposit today", at: 134 });
});

test("an unlisted payee is shown but marked, and can't be paid", () => {
  const { meeting } = buildMeeting({ ...base, notes, payees: [] });
  const pay = meeting.followUps.find((f) => f.kind === "payment");
  assert.ok(pay && pay.kind === "payment");
  assert.equal(pay.payeeListed, false);
  assert.equal(pay.payeeAccount, "");
});

test("the model's reply is checked against the schema", () => {
  assert.throws(() => notesSchema.parse({ title: "x", summary: "y", decisions: [], action_items: [], followups: [{ type: "transfer" }] }));
});

test("your notes ride along on the meeting but are never evidence", () => {
  const withNotes = { ...notes, followups: [...notes.followups, { type: "payment" as const, payee_name: "Designer", amount_words: "three hundred", memo: null, evidence: "pay the designer three hundred" }] };
  const { meeting, dropped } = buildMeeting({ ...base, notes: withNotes, payees: [{ name: "Designer", account: "designer.near" }], yourNotes: "pay the designer three hundred" });
  assert.equal(meeting.yourNotes, "pay the designer three hundred");
  assert.ok(!meeting.followUps.some((f) => f.kind === "payment" && f.heard === "three hundred"), "a payment only in your notes is dropped");
  assert.ok(dropped.some((d) => d.text === "Pay Designer three hundred"));
  assert.equal("yourNotes" in buildMeeting({ ...base, notes, payees: [] }).meeting, false);
});

// ---------- the amount must be in the quote ----------

const usdc = (n: number) => BigInt(Math.round(n * 100)) * 10_000n;
const designer = [{ name: "Designer", account: "designer.near" }];

/** One payment the model proposed, against a one-line transcript. */
function pay(line: string, amountWords: string, evidence: string): PaymentFollowUp {
  const n = notesSchema.parse({
    title: "t",
    summary: "s",
    decisions: [],
    action_items: [],
    followups: [{ type: "payment", payee_name: "Designer", amount_words: amountWords, memo: null, evidence }],
  });
  const { meeting } = buildMeeting({ ...base, notes: n, payees: designer, transcript: [{ at: 60, speaker: "you", text: line }] });
  const f = meeting.followUps[0];
  assert.ok(f && f.kind === "payment", "the payment's quote is in the transcript, so it is kept");
  return f;
}

test("the amount is kept when the quote says the same value in other words: $40 vs forty dollars", () => {
  const f = pay("Okay, pay the designer $40 for the icons.", "forty dollars", "pay the designer $40 for the icons");
  assert.equal(f.amount, usdc(40));
  assert.equal(f.amountProblem, undefined);
  assert.equal(amountNote(f), null);
  const g = pay("Okay, pay the designer forty dollars for the icons.", "$40", "pay the designer forty dollars for the icons");
  assert.equal(g.amount, usdc(40), "and the other way round");
});

test("an amount that isn't in the quote is dropped to null, with the reason, and autopilot waits", () => {
  const f = pay("Okay, pay the designer for the icons when they're done.", "four hundred dollars", "pay the designer for the icons when they're done");
  assert.equal(f.amount, null);
  assert.equal(f.amountProblem, "not-in-quote");
  assert.equal(f.heard, "four hundred dollars", "the heard words are still shown");
  assert.match(amountNote(f)!, /isn't in the quote from the transcript/);
  assert.deepEqual(autopilotDecision(f, { payments: true, recapDomains: [] }, { leftToday: usdc(1_000), perPaymentCap: usdc(1_000) }).reasons, ["Amount isn't in the quote"]);
});

test("a different number in the quote doesn't count: forty is not four hundred", () => {
  const f = pay("Okay, pay the designer forty dollars for the icons.", "four hundred dollars", "pay the designer forty dollars for the icons");
  assert.equal(f.amount, null);
  assert.equal(f.amountProblem, "not-in-quote");
});

test("partial-span trap: two hundred in the words, two hundred and fifty in the quote", () => {
  const f = pay("Right, pay the designer two hundred and fifty for the logo.", "two hundred", "pay the designer two hundred and fifty for the logo");
  assert.equal(f.amount, null, "200 is only part of 250, so it isn't in the quote");
  assert.equal(f.amountProblem, "not-in-quote");
  const g = pay("Right, pay the designer two hundred and fifty for the logo.", "two hundred and fifty", "pay the designer two hundred and fifty for the logo");
  assert.equal(g.amount, usdc(250));
});

test("naira is not USDC: no amount, the reason names the currency, autopilot waits", () => {
  const f = pay("Pay the designer fifty thousand naira for the deck.", "fifty thousand naira", "Pay the designer fifty thousand naira for the deck");
  assert.equal(f.amount, null, "never 50,000.00 USDC");
  assert.equal(f.amountProblem, "not-usdc");
  assert.equal(amountNote(f), "“fifty thousand naira” is in naira, not US dollars. Aftercall doesn't convert currencies, so the amount wasn't filled in.");
  assert.deepEqual(autopilotDecision(f, { payments: true, recapDomains: [] }, { leftToday: usdc(1_000), perPaymentCap: usdc(1_000) }).reasons, ["Amount isn't in US dollars"]);
});

test("unclear words give no amount and say so", () => {
  const f = pay("Pay the designer twelve fifty for the icons.", "twelve fifty", "Pay the designer twelve fifty for the icons");
  assert.equal(f.amount, null);
  assert.equal(f.amountProblem, "unclear");
  assert.equal(amountNote(f), "“twelve fifty” doesn't read as one amount, so it wasn't filled in.");
});

test("checkedAmount: cents and digits in the quote", () => {
  assert.deepEqual(checkedAmount("fifty cents", "it's fifty cents a page"), { amount: usdc(0.5) });
  assert.deepEqual(checkedAmount("fifty dollars", "it's fifty cents a page"), { amount: null, amountProblem: "not-in-quote" });
  assert.deepEqual(checkedAmount("five thousand", "send the $5,000 deposit"), { amount: usdc(5_000) });
});

/** One payment, with its quote cut by the model, against one transcript line. */
function payFrom(line: string, amountWords: string, evidence: string) {
  const n = notesSchema.parse({
    title: "t",
    summary: "s",
    decisions: [],
    action_items: [],
    followups: [{ type: "payment", payee_name: "Designer", amount_words: amountWords, memo: null, evidence }],
  });
  return buildMeeting({ ...base, notes: n, payees: [], transcript: [{ at: 60, speaker: "you", text: line }] });
}

test("a quote that starts or ends inside a number isn't in the transcript", () => {
  const a = payFrom("It's $1.50 per user, okay with you Ada?", "fifty dollars", "50 per user, okay with you");
  assert.deepEqual(a.meeting.followUps, [], "never $50 from $1.50");
  assert.equal(a.dropped[0]?.reason, "QUOTE_NOT_IN_TRANSCRIPT");
  const b = payFrom("We owe Ada 15,000 dollars total for the build.", "five thousand dollars", "5,000 dollars total for the build");
  assert.deepEqual(b.meeting.followUps, [], "never $5,000 from 15,000");
});

test("a value the quote gives in another currency or as a percentage is not a dollar amount", () => {
  const euros = payFrom("Send Ada 2,500 euros for the design work.", "2,500 dollars", "Send Ada 2,500 euros for the design work");
  assert.deepEqual(euros.meeting.followUps.map((f) => f.kind === "payment" && [f.amount, f.amountProblem]), [[null, "not-usdc"]]);
  const card = euros.meeting.followUps[0];
  assert.equal(card?.kind === "payment" && amountNote(card), "The quote gives this amount in euros, not US dollars. Aftercall doesn't convert currencies, so the amount wasn't filled in.");
  const pct = payFrom("Ada gets the 50 percent deposit on 4,000 dollars.", "fifty dollars", "Ada gets the 50 percent deposit on 4,000 dollars");
  assert.deepEqual(pct.meeting.followUps.map((f) => f.kind === "payment" && [f.amount, f.amountProblem]), [[null, "not-in-quote"]]);
  assert.deepEqual(checkedAmount("$500", "Send 500 naira"), { amount: null, amountProblem: "not-usdc" });
});

test("one fifty is not fifty, and two amounts aren't joined into one", () => {
  const f = payFrom("Pay Ada one fifty for the logo work.", "fifty dollars", "Pay Ada one fifty for the logo work");
  assert.deepEqual(f.meeting.followUps.map((p) => p.kind === "payment" && [p.amount, p.amountProblem]), [[null, "not-in-quote"]]);
  assert.deepEqual(checkedAmount("fifty dollars", "Ada gets fifty. Two hundred goes to Ben."), { amount: usdc(50) });
  assert.deepEqual(checkedAmount("ninety dollars", "Pay Ada forty, fifty dollars for it"), { amount: null, amountProblem: "not-in-quote" });
});

// ---------- meetings in other languages ----------

const rules = { payments: true, recapDomains: [] };
const limits = { leftToday: usdc(1_000), perPaymentCap: usdc(1_000) };

/** A meeting in another language: notes in English, evidence copied in the language spoken. */
function meetingIn(lines: string[], n: Omit<Notes, "title" | "summary">) {
  const transcript = lines.map((text, i): TranscriptLine => ({ at: i * 30, speaker: i % 2 ? "others" : "you", text }));
  return buildMeeting({ ...base, transcript, notes: { title: "t", summary: "s", ...n }, payees: designer });
}

test("a Japanese meeting keeps its notes: quotes match with no spaces between words", () => {
  const { meeting, dropped } = meetingIn(["APIの修正はデモの前に出します。", "デザイナーに500ドルを今日払ってください。", "来週、デザイナーに五百ドルを払います。"], {
    decisions: [{ text: "Ship the API fix before the demo.", evidence: "APIの修正はデモの前に出します" }],
    action_items: [{ text: "Pay the designer", owner: null, due: "today", evidence: "デザイナーに500ドルを今日払って" }],
    followups: [
      { type: "payment", payee_name: "Designer", amount_words: "500ドル", memo: null, evidence: "デザイナーに500ドルを今日払ってください" },
      { type: "payment", payee_name: "Designer", amount_words: "五百ドル", memo: null, evidence: "来週、デザイナーに五百ドルを払います" },
      { type: "payment", payee_name: "Designer", amount_words: "500 dollars", memo: null, evidence: "pay the designer 500 dollars today" },
    ],
  });
  assert.deepEqual(meeting.decisions, ["Ship the API fix before the demo."]);
  assert.equal(meeting.actionItems.length, 1);
  const [digits, words] = meeting.followUps.filter((f) => f.kind === "payment");
  assert.ok(digits?.kind === "payment" && words?.kind === "payment");
  assert.deepEqual([digits.amount, digits.evidence?.quote], [usdc(500), "デザイナーに500ドルを今日払ってください"], "digits in the quote still match");
  assert.deepEqual([words.amount, words.amountProblem], [null, "unclear"], "五百 is a number word Aftercall doesn't read");
  assert.deepEqual(autopilotDecision(words, rules, limits).reasons, ["Amount unclear"], "the card says Amount unclear: enter it, and autopilot waits");
  assert.deepEqual(dropped.map((d) => d.text), ["Pay Designer 500 dollars"], "a translated quote isn't in the transcript");
});

test("Russian and Arabic meetings: number words give no amount, digits do, another currency is named", () => {
  const ru = meetingIn(["Хорошо, заплати дизайнеру пятьсот долларов до пятницы.", "И ещё 500 евро за иконки, ладно?"], {
    decisions: [],
    action_items: [],
    followups: [
      { type: "payment", payee_name: "Designer", amount_words: "пятьсот долларов", memo: null, evidence: "заплати дизайнеру пятьсот долларов до пятницы" },
      { type: "payment", payee_name: "Designer", amount_words: "$500", memo: null, evidence: "И ещё 500 евро за иконки" },
    ],
  });
  assert.deepEqual(ru.meeting.followUps.map((f) => f.kind === "payment" && [f.amount, f.amountProblem]), [[null, "unclear"], [null, "not-usdc"]]);
  const euros = ru.meeting.followUps[1];
  assert.equal(euros?.kind === "payment" && amountNote(euros), "The quote gives this amount in euros, not US dollars. Aftercall doesn't convert currencies, so the amount wasn't filled in.");
  const ar = meetingIn(["اتفقنا، سندفع للمصمم 500 دولار يوم الجمعة."], {
    decisions: [{ text: "Pay the designer on Friday.", evidence: "سندفع للمصمم 500 دولار يوم الجمعة" }],
    action_items: [],
    followups: [{ type: "payment", payee_name: "Designer", amount_words: "500 دولار", memo: null, evidence: "سندفع للمصمم 500 دولار يوم الجمعة" }],
  });
  assert.deepEqual(ar.meeting.decisions, ["Pay the designer on Friday."]);
  assert.deepEqual(ar.meeting.followUps.map((f) => f.kind === "payment" && f.amount), [usdc(500)]);
});

test("Hindi, French and Spanish meetings keep quotes with their own spelling", () => {
  const { meeting, dropped } = meetingIn(["सोमवार तक डिज़ाइनर को 500 डॉलर दे देना।", "On a déjà décidé : le déploiement se fait vendredi.", "¿Podemos pagar al diseñador quinientos dólares mañana?"], {
    decisions: [{ text: "Deploy on Friday.", evidence: "déjà décidé : le déploiement se fait vendredi" }],
    action_items: [{ text: "Pay the designer by Monday", owner: "You", due: "Monday", evidence: "सोमवार तक डिज़ाइनर को 500 डॉलर" }],
    followups: [
      { type: "payment", payee_name: "Designer", amount_words: "500 डॉलर", memo: null, evidence: "डिज़ाइनर को 500 डॉलर दे देना" },
      { type: "payment", payee_name: "Designer", amount_words: "quinientos dólares", memo: null, evidence: "pagar al diseñador quinientos dólares mañana" },
    ],
  });
  assert.deepEqual(dropped, []);
  assert.deepEqual(meeting.decisions, ["Deploy on Friday."]);
  assert.deepEqual(
    meeting.followUps.map((f) => f.kind === "payment" && [f.evidence?.quote, f.amount, f.amountProblem]),
    [
      ["डिज़ाइनर को 500 डॉलर दे देना", usdc(500), undefined],
      ["pagar al diseñador quinientos dólares mañana", null, "unclear"],
    ],
  );
});

test("a payment's condition is kept only with its own quote from the transcript", () => {
  const lines: TranscriptLine[] = [{ at: 40, speaker: "you", text: "I'll pay Kemi five hundred dollars once the icons are delivered on Friday." }];
  const pay = (extra: Record<string, unknown>) =>
    notesSchema.parse({ ...notes, decisions: [], action_items: [], followups: [{ type: "payment", payee_name: "Kemi", amount_words: "five hundred dollars", memo: null, evidence: "I'll pay Kemi five hundred dollars", ...extra }] });
  const build = (n: Notes) => buildMeeting({ ...base, transcript: lines, notes: n, payees: [{ name: "Kemi", account: "kemi.testnet" }] }).meeting.followUps[0] as PaymentFollowUp;

  const kept = build(pay({ condition: "when the icons are delivered", condition_evidence: "once the icons are delivered on Friday" }));
  assert.deepEqual(kept.condition, { text: "when the icons are delivered", evidence: { quote: "once the icons are delivered on Friday", at: 40 } });
  assert.equal(kept.conditionDropped, undefined);
  assert.equal(kept.amount, 500_000_000n, "the amount is checked as before");

  // A condition whose words aren't in the transcript is dropped, and the payment says so.
  const invented = build(pay({ condition: "after the invoice", condition_evidence: "after you send the invoice" }));
  assert.equal(invented.condition, undefined);
  assert.equal(invented.conditionDropped, true);
  const unquoted = build(pay({ condition: "after the invoice", condition_evidence: null }));
  assert.equal(unquoted.conditionDropped, true);

  // No condition: neither field, as for notes made before conditions were read.
  for (const extra of [{ condition: null, condition_evidence: null }, {}]) {
    const plain = build(pay(extra));
    assert.equal(plain.condition, undefined);
    assert.equal(plain.conditionDropped, undefined);
  }
});

test("the model is asked for a condition and its quote on every payment", () => {
  const paymentSchema = notesJsonSchema.properties.followups.items.anyOf[1];
  assert.deepEqual(paymentSchema.required.slice(-2), ["condition", "condition_evidence"]);
  assert.match(NOTES_SYSTEM_PROMPT, /copy the exact words where it was said into condition_evidence/);
  assert.match(NOTES_SYSTEM_PROMPT, /Never invent a condition/);
});
