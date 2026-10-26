import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { EmailService, type Mailer } from "./email.service";
import { isAccepted } from "../auth/auth.service";

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
