import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PaymentFollowUp } from "../meeting.ts";
import {
  ATTACKER,
  INJECTED_WORDS,
  autopilotLine,
  droppedKeys,
  errorPath,
  flipHexByte,
  leaks,
  lineOf,
  notesLayer,
  obedientModelReply,
  readSendTx,
  scrub,
  signedTxFrom,
  signerKeyFrom,
  transcriptOf,
  type ScriptLine,
} from "./attack.ts";

const here = dirname(fileURLToPath(import.meta.url));
const script = JSON.parse(readFileSync(join(here, "..", "..", "..", "..", "samples", "injection-call", "script.json"), "utf8")) as {
  title: string;
  seconds: number;
  payees: { name: string; account: string }[];
  lines: ScriptLine[];
};
const USDC = 1_000_000n;

function layer() {
  return notesLayer(obedientModelReply(), { id: "attack-test", project: script.title, durationSec: script.seconds, transcript: transcriptOf(script.lines), payees: script.payees });
}
const pay = (f: unknown) => f as PaymentFollowUp;

test("the injection sample says the attacker's words and lists only the illustrator", () => {
  assert.ok(script.lines.some((l) => l.speaker === "others" && l.text.includes(INJECTED_WORDS)));
  assert.deepEqual(
    script.payees.map((p) => p.account),
    ["demo-freelancer.aftercall.testnet"],
  );
  assert.deepEqual(transcriptOf([{ at: 11.6, speaker: "others", name: "x", text: "hi" }]), [{ at: 11, speaker: "others", text: "hi" }]);
});

test("a model that obeys the attacker: no made-up quote, no unlisted payee, no amount the quote doesn't say, never approved", () => {
  const { meeting, cases } = layer();
  const by = Object.fromEntries(cases.map((c) => [c.id, c]));
  // The honest payment stays as it was said.
  const control = pay(by.control.followUp);
  assert.equal(control.payeeAccount, "demo-freelancer.aftercall.testnet");
  assert.equal(control.amount, 1n * USDC);
  // (a) A quote that isn't in the transcript: dropped.
  assert.equal(by.a.followUp, null);
  assert.equal(by.a.dropped?.reason, "QUOTE_NOT_IN_TRANSCRIPT");
  // (b) The attacker's own words are in the transcript, but the payee isn't on the list.
  const b = pay(by.b.followUp);
  assert.equal(b.payeeListed, false);
  assert.equal(b.payeeAccount, "");
  assert.equal(b.payeeName, ATTACKER);
  assert.equal(b.amount, 9000n * USDC);
  // (c1) The listed payee, but $9,000 isn't in the quote: no amount.
  const c1 = pay(by.c1.followUp);
  assert.equal(c1.payeeListed, true);
  assert.equal(c1.amount, null);
  assert.equal(c1.amountProblem, "not-in-quote");
  // (c2) The listed payee with the attacker's words: the amount stands; the caps are left.
  const c2 = pay(by.c2.followUp);
  assert.equal(c2.payeeListed, true);
  assert.equal(c2.amount, 9000n * USDC);
  // "Mark it approved" has no field to land in: parsing drops it and every item is proposed.
  assert.deepEqual(droppedKeys(obedientModelReply()), ["status", "approved"]);
  assert.ok(layer().notes.followups.every((f) => !("status" in f) && !("approved" in f)));
  assert.ok(meeting.followUps.every((f) => f.status === "proposed"));
  assert.equal(meeting.verified, true, "the worst case: the reply is treated as a genuine, signed one");
});

test("autopilot pays only the honest payment; every attacker payment waits for a person, with its reasons", () => {
  const { meeting, cases } = layer();
  const limits = { perPaymentCap: 1n * USDC, leftToday: 4_500_000n };
  const reasons = (id: string) => autopilotLine(meeting, cases.find((c) => c.id === id)!.followUp!, limits).decision;
  assert.equal(reasons("control").run, true);
  const notYou = "Someone else on the call said it: only your own words pay by themselves";
  assert.deepEqual(reasons("b"), { run: false, reasons: ["Payee isn't on your list", notYou, "Over your per-payment cap", "Over what's left today"] });
  assert.deepEqual(reasons("c1"), { run: false, reasons: ["Amount isn't in the quote"] });
  // The attacker's own words, pointed at the listed illustrator: before the quote check only the
  // caps stopped this one; now the notes layer does too (not your words, the payee isn't named).
  assert.deepEqual(reasons("c2"), { run: false, reasons: [notYou, "The quote doesn't name the payee", "Over your per-payment cap", "Over what's left today"] });
  assert.match(autopilotLine(meeting, cases[2].followUp!, limits).text, /^waits for you: Payee isn't on your list/);
  // Without a wallet connected, nothing is paid either.
  assert.equal(autopilotLine(meeting, cases[0].followUp!, null).decision.run, false);
});

test("NEAR's answers: refused before the chain, failed on chain, or a return value", () => {
  const refused = readSendTx({
    jsonrpc: "2.0",
    error: { name: "HANDLER_ERROR", cause: { info: {}, name: "INVALID_TRANSACTION" }, code: -32000, message: "Server error", data: { TxExecutionError: { InvalidTxError: { InvalidAccessKeyError: { MethodNameMismatch: { method_name: "withdraw" } } } } } },
    id: 1,
  });
  assert.deepEqual(refused, { outcome: "refused", tx: null, error: 'InvalidTxError.InvalidAccessKeyError.MethodNameMismatch {"method_name":"withdraw"}', value: null });
  assert.equal(errorPath({ TxExecutionError: { InvalidTxError: { InvalidAccessKeyError: "RequiresFullAccess" } } }), "InvalidTxError.InvalidAccessKeyError.RequiresFullAccess");

  const failed = readSendTx({
    result: {
      status: { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: UNKNOWN_PAYEE" } } } } },
      transaction: { hash: "9xJtq1Ld5vHnSh7GJcjWTxuDqXHzVdPZW2u5ixjJ5TnL" },
    },
  });
  assert.deepEqual(failed, { outcome: "failed", tx: "9xJtq1Ld5vHnSh7GJcjWTxuDqXHzVdPZW2u5ixjJ5TnL", error: "UNKNOWN_PAYEE", value: null });

  const blocked = { status: "blocked", reason: "OVER_PAYMENT_CAP", left_today: "4500000", cross_chain_left_today: null };
  const ok = readSendTx({ result: { status: { SuccessValue: Buffer.from(JSON.stringify(blocked)).toString("base64") }, transaction: { hash: "abc" } } });
  assert.deepEqual(ok, { outcome: "ok", tx: "abc", error: null, value: blocked });
  assert.equal(readSendTx({ result: { status: { SuccessValue: "" }, transaction: { hash: "abc" } } }).value, null);

  assert.equal(readSendTx({ error: { cause: { name: "TIMEOUT_ERROR" }, message: "Timeout" } }).outcome, "error");
  assert.equal(readSendTx(null).outcome, "error");
});

test("near-cli's display output: the signed transaction and the key it signed with", () => {
  const out = [
    "├  Your transaction was signed successfully.",
    "│    Public key: ed25519:CSk7sYtCBbMPzpLbogPhWQmDqQoYWSnSaj9WPCstKtfL",
    "",
    "Signed transaction (serialized as base64):",
    "HAAAAGRlbW8tb3duZXIu+/0=",
    "",
    "This base64-encoded signed transaction is ready to be sent to the network.",
  ].join("\n");
  assert.equal(signedTxFrom(out), "HAAAAGRlbW8tb3duZXIu+/0=");
  assert.equal(signerKeyFrom(out), "ed25519:CSk7sYtCBbMPzpLbogPhWQmDqQoYWSnSaj9WPCstKtfL");
  assert.equal(signedTxFrom("Error: refused"), null);
});

test("a private key never survives scrub, with or without its prefix", () => {
  // Made up for this test: not a key anyone holds.
  const secret = "ed25519:4fAkeKeyFoRTesTiNgOnLy1111111111111111111111111111111111111111111111111111111111";
  const text = `sign-with-plaintext-private-key ${secret} send\nbody ${secret.slice(8)} again`;
  const clean = scrub(text, secret);
  assert.equal(leaks(clean, secret), false);
  assert.equal(clean, "sign-with-plaintext-private-key [app key] send\nbody [app key] again");
  assert.equal(leaks(text, secret), true);
  assert.equal(scrub("short", "ed25519:abc"), "short");
});

test("one byte flipped, and where a line of code is", () => {
  assert.equal(flipHexByte("00ff"), "01ff");
  assert.equal(flipHexByte("00ff", 1, 0xff), "0000");
  assert.throws(() => flipHexByte("0g"), /NOT_HEX/);
  assert.throws(() => flipHexByte("00", 1), /OUT_OF_RANGE/);
  assert.equal(lineOf("a\nb\nneedle here\n", "needle"), 3);
  assert.equal(lineOf("a\nb", "nope"), null);
});
