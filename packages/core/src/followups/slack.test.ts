import { test } from "node:test";
import assert from "node:assert/strict";
import { SLACK_WEBHOOK_MESSAGE, slackRecapText, slackWebhookProblem } from "./slack.ts";
import { buildRecap, recapFooter, type RecapFacts } from "./recap.ts";
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
const facts: RecapFacts = { verified: true, e2ee: true, verifyUrl: "https://aftercall.app/verify#x", handlingUrl: "https://aftercall.app/handling" };

test("a Slack post is buildRecap's text word for word, footer included, under the subject in bold", () => {
  const recap = buildRecap(meeting, f, { sender: "Victor", facts });
  const text = slackRecapText(recap);
  assert.ok(text.startsWith("*Recap: API fix*\n\nHi Ada, thanks for the call."));
  assert.match(text, /^\*DECISIONS\*$/m);
  assert.match(text, /^\*ACTION ITEMS\*$/m);
  assert.match(text, /^1\. Ship the API fix before Friday's demo\.$/m);
  assert.match(text, /^- Ship the API fix · Victor · by Friday$/m);
  assert.doesNotMatch(text, /Old thing/, "done items stay out, as in the email");
  assert.ok(text.endsWith(`--\n${recapFooter(facts)}`), "the footer, unchanged");
  // Only the subject line and the bold marks are added.
  assert.equal(text.replace(/^\*Recap: API fix\*\n\n/, "").replace(/^\*(DECISIONS|ACTION ITEMS)\*$/gm, "$1"), recap.text);
});

test("the agents' heading is bold too, when the recap lists their work", () => {
  const done = { agent: "Claude Code", at: "2026-11-02T10:00:00.000Z", link: "https://github.com/acme/api/pull/42" };
  const m = { ...meeting, actionItems: [...meeting.actionItems, { id: "a3", text: "Fix the login bug", owner: "You", done: true, completed: done }] };
  assert.match(slackRecapText(buildRecap(m, f, { facts, agentWork: true })), /^\*DONE BY CODING AGENTS\*$/m);
});

test("meeting text can't ping the channel, mention someone or hide a link", () => {
  const m = { ...meeting, summary: "Tell <!channel> & <@U123>: see <https://evil.example|the doc>.", decisions: ["Use a > b"] };
  const text = slackRecapText(buildRecap(m, { ...f, subject: "Q&A <!here>" }, { facts }));
  assert.ok(text.startsWith("*Recap: Q&amp;A &lt;!here&gt;*"));
  assert.match(text, /Tell &lt;!channel&gt; &amp; &lt;@U123&gt;: see &lt;https:\/\/evil\.example\|the doc&gt;\./);
  assert.match(text, /1\. Use a &gt; b/);
  assert.doesNotMatch(text, /<[!@#]|<https?:/, "no Slack markup survives from the meeting");
});

test("only a Slack incoming webhook is accepted", () => {
  assert.equal(slackWebhookProblem("https://hooks.slack.com/services/T0001/B0002/abcDEF123"), null);
  assert.equal(slackWebhookProblem("  https://hooks.slack.com/services/T0001/B0002/abcDEF123\n"), null, "spaces around a paste are fine");
  assert.match(slackWebhookProblem("") ?? "", /Paste the webhook URL/);
  for (const bad of [
    "http://hooks.slack.com/services/T0001/B0002/abcDEF123",
    "https://hooks.slack.com.evil.com/services/T0001/B0002/abcDEF123",
    "https://evil.com/hooks.slack.com/services/T0001/B0002/abcDEF123",
    "https://hooks.slack.com@evil.com/services/T0001/B0002/abcDEF123",
    "https://user@hooks.slack.com/services/T0001/B0002/abcDEF123",
    "https://hooks.slack.com:8443/services/T0001/B0002/abcDEF123",
    "https://slack.com/services/T0001/B0002/abcDEF123",
    "https://hooks.slack.com/workflows/T0001/A0002/123/abc",
    "https://hooks.slack.com/services/T0001/B0002",
    "https://hooks.slack.com/services/T0001/B0002/abc/extra",
    "https://hooks.slack.com/services/T0001/B0002/abc?x=1",
    "https://hooks.slack.com/services/T0001/B0002/abc#x",
    "https://hooks.slack.com/services/T0001/B0002/../../x",
    "https://hooks.slack.com/services/T0001/B0002/ab%2Fc",
    "https://hooks.slack.com/services/T0001/B0002/ab c",
    "https://hooks.slack.com/services/T0001//abc",
    "HTTPS://HOOKS.SLACK.COM/services/T0001/B0002/abc",
  ]) {
    assert.equal(slackWebhookProblem(bad), SLACK_WEBHOOK_MESSAGE, bad);
  }
});
