import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Logger, type LoggerService } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { Pool } from "pg";
import { EmailService, resendMailer, type Mailer } from "./email.service";
import { EmailController } from "./email.controller";
import { AuthService, isAccepted } from "../auth/auth.service";
import { PgCounters } from "../stats/counters";

const consent = "Hi Ada.\n--\nThis call was recorded with notice to everyone on it and processed in secure hardware.";

function fakeMailer() {
  const sent: Parameters<Mailer>[0][] = [];
  const mailer: Mailer = async (m) => {
    sent.push(m);
    return { id: `email-${sent.length}` };
  };
  return { sent, mailer };
}

test("app keys limited to the Aftercall contract may sign in; other limited keys may not", () => {
  assert.equal(isAccepted("FullAccess"), true);
  assert.equal(isAccepted({ FunctionCall: { receiver_id: "wallet.aftercall.testnet", method_names: ["pay", "record_proof"] } }, "wallet.aftercall.testnet"), true);
  assert.equal(isAccepted({ FunctionCall: { receiver_id: "game.testnet", method_names: [] } }, "wallet.aftercall.testnet"), false);
  assert.equal(isAccepted({ FunctionCall: { receiver_id: "wallet.aftercall.testnet" } }), false, "no contract configured, no app keys");
});

test("a recap goes out from '<name> via Aftercall' with the owner's reply-to", async () => {
  const { sent, mailer } = fakeMailer();
  const email = new EmailService(mailer, "notes@aftercall.app");
  const r = await email.send("victor.testnet", { to: "ada@example.com", subject: "Recap", text: consent, replyTo: "victor@example.com", senderName: "Victor" });
  assert.equal(r.id, "email-1");
  assert.deepEqual(sent[0], { from: "Victor via Aftercall <notes@aftercall.app>", to: "ada@example.com", subject: "Recap", text: consent, replyTo: "victor@example.com" });
});

test("refuses recaps without the consent line, bad addresses, header injection and floods", async () => {
  const { mailer } = fakeMailer();
  let now = 0;
  const email = new EmailService(mailer, "notes@aftercall.app", () => now);
  await assert.rejects(email.send("v", { to: "ada@example.com", subject: "x", text: "no consent here" }), /MISSING_CONSENT_LINE/);
  await assert.rejects(email.send("v", { to: "ada@example.com\nBcc: everyone@x.com", subject: "x", text: consent }), /BAD_ADDRESS/);
  for (let i = 0; i < 50; i++) await email.send("v", { to: "ada@example.com", subject: "x", text: consent });
  await assert.rejects(email.send("v", { to: "ada@example.com", subject: "x", text: consent }), /DAILY_LIMIT/);
  now += 86_400_000;
  await email.send("v", { to: "ada@example.com", subject: "x", text: consent });
});

test("without Resend configured, sending says so instead of failing silently", async () => {
  const email = new EmailService(null, "notes@aftercall.app");
  assert.equal(email.configured, false);
  await assert.rejects(email.send("v", { to: "ada@example.com", subject: "x", text: consent }), /EMAIL_NOT_CONFIGURED/);
});

/*
 * Nothing kept: a recap sent through the real HTTP route, with a spy Resend client,
 * a spy database behind the counters, and every log line captured.
 */
const RECIPIENT = "kemi.recipient@example.com";
const SUBJECT = "Recap: secret-subject-7Q";
const BODY = `Hi Kemi, the launch moves to the 18th. secret-body-3F\n--\n${consent}`;
const MARKERS = [RECIPIENT, "kemi.recipient", "secret-subject-7Q", "secret-body-3F", "launch moves"];

function spyPool() {
  const queries: { sql: string; params: unknown[] }[] = [];
  return { queries, pool: { query: async (sql: string, params: unknown[] = []) => (queries.push({ sql, params }), { rows: [], rowCount: 1 }) } };
}

function spyResend(reply: { status: number; body: object }) {
  const requests: string[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    requests.push(String(init.body));
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { requests, fetchImpl };
}

/** Every log line: Nest's logger (all levels, swapped for this spy) and the console. */
const logLines: string[] = [];
const text = (a: unknown[]) => a.map((x) => (typeof x === "string" ? x : x instanceof Error ? `${x.message}\n${x.stack}` : JSON.stringify(x))).join(" ");
const spyLogger: LoggerService = {
  log: (...a: unknown[]) => void logLines.push(text(a)),
  error: (...a: unknown[]) => void logLines.push(text(a)),
  warn: (...a: unknown[]) => void logLines.push(text(a)),
  debug: (...a: unknown[]) => void logLines.push(text(a)),
  verbose: (...a: unknown[]) => void logLines.push(text(a)),
  fatal: (...a: unknown[]) => void logLines.push(text(a)),
};

async function captureLogs(fn: () => Promise<void>): Promise<string> {
  logLines.length = 0;
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  const grab = (...a: unknown[]) => void logLines.push(text(a));
  Object.assign(console, { log: grab, warn: grab, error: grab, info: grab, debug: grab });
  try {
    await fn();
  } finally {
    Object.assign(console, saved);
  }
  return logLines.join("\n");
}

async function recapApp(resend: ReturnType<typeof spyResend>) {
  const db = spyPool();
  const counters = new PgCounters(db.pool as unknown as Pool);
  const service = new EmailService(resendMailer("re_test_key", resend.fetchImpl), "notes@aftercall.app", Date.now, counters);
  const moduleRef = await Test.createTestingModule({
    controllers: [EmailController],
    providers: [
      { provide: AuthService, useValue: { accountFor: async () => "victor.testnet" } },
      { provide: EmailService, useValue: service },
    ],
  }).compile();
  // Every Nest log level goes to the spy, so anything Nest would log is checked too.
  const app = moduleRef.createNestApplication({ logger: spyLogger });
  await app.init();
  return { app, db, service, counters };
}

const recap = { to: RECIPIENT, subject: SUBJECT, text: BODY, replyTo: "victor@example.com", senderName: "Victor" };
const leaks = (text: string) => MARKERS.filter((m) => text.includes(m));

test("a sent recap leaves only counts behind: no body, subject or address in the database, counters or logs", async () => {
  const resend = spyResend({ status: 200, body: { id: "re_123" } });
  const { app, db, service } = await recapApp(resend);
  let status = 0;
  const logs = await captureLogs(async () => {
    const res = await request(app.getHttpServer()).post("/email/recap").set("authorization", "Bearer s").send(recap);
    status = res.status;
    assert.deepEqual(res.body, { id: "re_123" });
  });
  await app.close();

  assert.equal(status, 200);
  assert.equal(resend.requests.length, 1);
  assert.ok(resend.requests[0].includes("secret-body-3F"), "the recap did reach Resend");
  assert.deepEqual(leaks(logs), [], "nothing about the recap was logged");
  assert.equal(db.queries.length, 1, "one database write: the counter");
  assert.match(db.queries[0].sql, /^INSERT INTO counters/);
  assert.deepEqual(db.queries[0].params, ["emails_sent"]);
  assert.deepEqual(leaks(JSON.stringify(db.queries)), []);
  // What the service still holds after the request: today's count for the account, nothing else.
  const held = JSON.stringify(Object.entries(service).map(([k, v]) => [k, v instanceof Map ? [...v] : typeof v === "function" ? "fn" : v]));
  assert.deepEqual(leaks(held), []);
  assert.deepEqual([...(service as unknown as { sentTodayCount: Map<string, [number, number]> }).sentTodayCount.values()].map(([, n]) => n), [1]);
});

test("a failed send says so without echoing the address, and keeps nothing either", async () => {
  // Resend's own error messages can quote the address.
  const resend = spyResend({ status: 422, body: { name: "validation_error", message: `Invalid \`to\` field: ${RECIPIENT}` } });
  const { app, db } = await recapApp(resend);
  let body = "";
  const logs = await captureLogs(async () => {
    const res = await request(app.getHttpServer()).post("/email/recap").set("authorization", "Bearer s").send(recap);
    assert.equal(res.status, 502);
    body = JSON.stringify(res.body);
    new Logger("probe").error("probe-line");
  });
  assert.match(logs, /probe-line/, "the log capture is live");
  await app.close();

  assert.match(body, /SEND_FAILED \(Resend 422\)/);
  assert.deepEqual(leaks(body), [], "the error doesn't carry the address back");
  assert.deepEqual(leaks(logs), [], "nor into the logs");
  assert.equal(db.queries.length, 0, "a failed send isn't even counted");
});
