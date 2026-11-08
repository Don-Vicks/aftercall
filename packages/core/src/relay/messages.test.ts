import { test } from "node:test";
import assert from "node:assert/strict";
import type { EmailFollowUp, Meeting, PaymentFollowUp } from "../meeting.ts";
import { encodeSignRequest } from "../wallet/actions.ts";
import { RELAY_LIMITS, RelayError, deriveSession, newRelayKeys } from "./crypto.ts";
import {
  ACTION_TTL_MS,
  MAX_SNAPSHOT_ITEMS,
  checkPhoneAction,
  fitSnapshot,
  itemDigest,
  openAction,
  openSnapshot,
  sealAction,
  sealSnapshot,
  signUrlsMatch,
  toDoneItem,
  toPendingItem,
  type PaymentItem,
  type PendingItem,
  type PhoneAction,
  type Snapshot,
} from "./messages.ts";

const meeting: Meeting = {
  id: "1762000000", project: "Fundraise", title: "Sync with Ada", startedAt: "2026-11-06T14:02:00Z", durationSec: 192, verified: true,
  summary: "SECRET SUMMARY: the API fix ships before Friday.",
  decisions: ["Ship the API fix before Friday's demo."],
  actionItems: [{ id: "a1", text: "Ship the API fix", owner: "Victor", done: false }],
  followUps: [],
  transcript: [{ at: 3, speaker: "others", text: "SECRET TRANSCRIPT line" }],
  yourNotes: "SECRET NOTES",
};
const email: EmailFollowUp = { id: "f1", kind: "email", status: "proposed", to: "ada@example.com", toName: "Ada", subject: "Recap: Sync with Ada", evidence: { quote: "send Ada the recap", at: 0 } };
const payment: PaymentFollowUp = {
  id: "f2", kind: "payment", status: "proposed", payeeName: "Kemi", payeeAccount: "kemi.testnet", amount: 20_000_000n, heard: "the twenty dollars", payeeListed: true,
  evidence: { quote: "send Kemi the twenty dollars for the icons", at: 155 },
};
const opts = { backend: true };
const NOW = 1_762_440_000_000;

function session() {
  const mac = newRelayKeys();
  const phone = newRelayKeys();
  const pairingId = new Uint8Array(32).fill(7);
  const common = { pairingId, macPublicKey: mac.publicKey, phonePublicKey: phone.publicKey };
  return { mac: deriveSession({ ...common, ourSecretKey: mac.secretKey, theirPublicKey: phone.publicKey }), phone: deriveSession({ ...common, ourSecretKey: phone.secretKey, theirPublicKey: mac.publicKey }) };
}

const snapshot = (items: PendingItem[]): Snapshot => ({ t: "snapshot", at: NOW, network: "testnet", items, more: 0, done: [], results: [] });
const action = (item: PendingItem, kind: PhoneAction["kind"] = "approve"): PhoneAction => ({ t: "action", kind, meetingId: item.meetingId, followUpId: item.followUpId, digest: itemDigest(item), at: NOW });

test("a pending item holds what approving needs, and nothing of the summary, transcript or notes", () => {
  const p = toPendingItem(meeting, payment, { ...opts, route: { chain: "solana", address: "8xKemiSoLaNa111111111111111111111111111111" }, quoted: { amountOut: "19750000", at: NOW } }) as PaymentItem;
  assert.equal(p.kind, "payment");
  assert.equal(p.amount, "20000000");
  assert.equal(p.quote, "send Kemi the twenty dollars for the icons");
  assert.deepEqual(p.route, { chain: "solana", address: "8xKemiSoLaNa111111111111111111111111111111", quotedOut: "19750000", quotedAt: NOW });
  assert.match(p.whatLeaves.summary, /Public on NEAR/);
  const e = toPendingItem(meeting, email, opts)!;
  assert.equal(e.kind === "email" && e.to, "ada@example.com");
  assert.match(e.whatLeaves.details.join(" "), /Resend/);
  const wire = JSON.stringify([p, e]);
  assert.doesNotMatch(wire, /SECRET/);
});

test("only follow-ups that wait on someone become items; sent and paid ones are done", () => {
  for (const status of ["sent", "paid", "dismissed"] as const) assert.equal(toPendingItem(meeting, { ...email, status }, opts), null);
  assert.equal(toPendingItem(meeting, { ...email, slackPostedAt: "14:06" }, opts), null, "a recap posted to Slack doesn't wait on the phone");
  // A coding agent's proposal stays on the Mac: the phone shows only what the call said.
  const { evidence: _quote, ...unquoted } = payment;
  assert.equal(toPendingItem(meeting, { ...unquoted, proposedBy: { agent: "Codex", at: "2026-11-02T10:00:00.000Z", reason: "Pay the designer" } }, opts), null);
  assert.equal(toPendingItem(meeting, { ...payment, status: "blocked" }, opts)?.status, "blocked");
  // A deal waits on the Mac: the phone shows no condition, so it could pay before it's met.
  assert.equal(toPendingItem(meeting, { ...payment, condition: { text: "when the icons are delivered", evidence: { quote: "once the icons are delivered", at: 0 } } }, opts), null);
  assert.equal(toPendingItem(meeting, { ...payment, conditionDropped: true }, opts), null);
  assert.equal(toDoneItem(meeting, email), null);
  assert.deepEqual(toDoneItem(meeting, { ...payment, status: "paid", doneAt: "14:06", byAutopilot: true }), { kind: "payment", meetingTitle: "Sync with Ada", label: "Paid Kemi 20.00 USDC", doneAt: "14:06", byAutopilot: true });
  assert.equal(toDoneItem(meeting, { ...email, status: "sent", doneAt: "14:07" })?.label, "Recap sent to Ada");
});

test("long text is clipped to the schema's limits", () => {
  const long = toPendingItem({ ...meeting, title: "T".repeat(300) }, { ...email, evidence: { quote: "q ".repeat(400), at: 0 } }, opts)!;
  assert.equal(long.meetingTitle.length, 120);
  assert.ok(long.quote.length <= 500);
  const { mac } = session();
  assert.doesNotThrow(() => sealSnapshot(mac.key, 1, snapshot([long])));
});

test("a snapshot and an action round-trip, sealed and opened with the schemas", () => {
  const { mac, phone } = session();
  const items = [toPendingItem(meeting, payment, opts)!, toPendingItem(meeting, email, opts)!];
  const s = { ...snapshot(items), results: [{ n: 3, outcome: "refused" as const, reason: "Over your per-payment cap" }] };
  const opened = openSnapshot(phone.key, 0, sealSnapshot(mac.key, 1, s));
  assert.deepEqual(opened, { n: 1, snapshot: s });
  const a = action(items[0]);
  assert.deepEqual(openAction(mac.key, 0, sealAction(phone.key, 1, a)), { n: 1, action: a });
});

test("fields outside the schema never ride along, and a malformed message is refused", () => {
  const { mac, phone } = session();
  const leaky = { ...snapshot([]), summary: meeting.summary, transcript: meeting.transcript } as Snapshot;
  const opened = openSnapshot(phone.key, 0, sealSnapshot(mac.key, 1, leaky));
  assert.equal("summary" in opened.snapshot, false);
  assert.equal("transcript" in opened.snapshot, false);
  const refused = (e: unknown) => e instanceof RelayError && e.code === "BAD_MESSAGE";
  assert.throws(() => sealSnapshot(mac.key, 1, { ...snapshot([]), network: "devnet" } as unknown as Snapshot), refused);
  assert.throws(() => sealAction(phone.key, 1, { ...action(toPendingItem(meeting, email, opts)!), kind: "pay-everyone" } as unknown as PhoneAction), refused);
  assert.throws(() => sealAction(phone.key, 1, { ...action(toPendingItem(meeting, email, opts)!), meetingId: "../../etc" }), refused);
});

test("a replayed action and an action reflected as a snapshot are refused", () => {
  const { mac, phone } = session();
  const box = sealAction(phone.key, 5, action(toPendingItem(meeting, email, opts)!));
  assert.equal(openAction(mac.key, 4, box).n, 5);
  assert.throws(() => openAction(mac.key, 5, box), (e: unknown) => e instanceof RelayError && e.code === "REPLAY");
  assert.throws(() => openSnapshot(phone.key, 0, box), (e: unknown) => e instanceof RelayError && e.code === "WRONG_DIRECTION");
});

test("fitSnapshot keeps the newest items under the size limit and counts the rest", () => {
  const { mac } = session();
  const many = Array.from({ length: 60 }, (_, i) => toPendingItem(meeting, { ...payment, id: `f${i}`, heard: "h".repeat(200), evidence: { quote: "q".repeat(500), at: i } }, opts)!);
  const fitted = fitSnapshot(snapshot(many));
  assert.ok(fitted.items.length <= MAX_SNAPSHOT_ITEMS);
  assert.equal(fitted.items.length + fitted.more, 60);
  assert.equal(fitted.items[0].followUpId, "f0", "newest first, oldest dropped");
  assert.doesNotThrow(() => sealSnapshot(mac.key, 1, fitted));
  assert.ok(JSON.stringify(fitted).length < RELAY_LIMITS.snapshotBytes);
});

test("the digest changes with what you approve, not with how it's worded", () => {
  const p = toPendingItem(meeting, payment, opts)!;
  assert.equal(itemDigest(p), itemDigest(toPendingItem(meeting, { ...payment, evidence: { quote: "other words", at: 1 } }, opts)!));
  assert.notEqual(itemDigest(p), itemDigest(toPendingItem(meeting, { ...payment, amount: 21_000_000n }, opts)!));
  assert.notEqual(itemDigest(p), itemDigest(toPendingItem(meeting, { ...payment, payeeAccount: "mallory.testnet" }, opts)!));
  assert.notEqual(itemDigest(p), itemDigest(toPendingItem(meeting, payment, { ...opts, route: { chain: "base", address: "0x0000000000000000000000000000000000000001" } })!));
  const e = toPendingItem(meeting, email, opts)!;
  assert.notEqual(itemDigest(e), itemDigest(toPendingItem(meeting, { ...email, to: "eve@example.com" }, opts)!));
});

test("the Mac runs an approval only if the follow-up still waits, unchanged, and passes every rule", () => {
  const item = (f: PaymentFollowUp | EmailFollowUp) => toPendingItem(meeting, f, opts);
  const p = item(payment)!;
  assert.deepEqual(checkPhoneAction(action(p), payment, p, NOW), { ok: true });
  assert.equal(checkPhoneAction(action(p), undefined, null, NOW).ok, false);
  const paid = { ...payment, status: "paid" as const };
  assert.deepEqual(checkPhoneAction(action(p), paid, item(paid), NOW), { ok: false, reason: "Nothing waits on it: it's paid on your Mac." });
  const edited = { ...payment, amount: 25_000_000n };
  assert.match((checkPhoneAction(action(p), edited, item(edited), NOW) as { reason: string }).reason, /changed on your Mac/);
  const blocked = { ...payment, status: "blocked" as const };
  assert.match((checkPhoneAction(action(item(blocked)!), blocked, item(blocked), NOW) as { reason: string }).reason, /NEAR wallet/);
  const sending = { ...payment, status: "sending" as const };
  assert.equal(checkPhoneAction(action(item(sending)!), sending, item(sending), NOW).ok, false);
  const unlisted = { ...payment, payeeListed: false, payeeAccount: "" };
  assert.match((checkPhoneAction(action(item(unlisted)!), unlisted, item(unlisted), NOW) as { reason: string }).reason, /isn't on your list/);
  const unclear = { ...payment, amount: null, amountProblem: "not-usdc" as const };
  assert.deepEqual(checkPhoneAction(action(item(unclear)!), unclear, item(unclear), NOW), { ok: false, reason: "Amount isn't in US dollars" });
  const noAddress = { ...email, to: "" };
  assert.match((checkPhoneAction(action(item(noAddress)!), noAddress, item(noAddress), NOW) as { reason: string }).reason, /No email address/);
  assert.match((checkPhoneAction({ ...action(p), at: NOW - ACTION_TTL_MS - 1 }, payment, p, NOW) as { reason: string }).reason, /Too old/);
  assert.equal(checkPhoneAction({ ...action(p), meetingId: "other" }, payment, p, NOW).ok, false);
});

test("dismiss and undo follow the app's own buttons", () => {
  const p = toPendingItem(meeting, payment, opts)!;
  assert.deepEqual(checkPhoneAction(action(p, "dismiss"), payment, p, NOW), { ok: true });
  assert.equal(checkPhoneAction(action(p, "undo-autopilot"), payment, p, NOW).ok, false, "nothing counting down");
  const queued = { ...email, autopilotAt: NOW + 30_000 };
  const q = toPendingItem(meeting, queued, opts)!;
  assert.equal(q.autopilotAt, NOW + 30_000);
  assert.deepEqual(checkPhoneAction(action(q, "undo-autopilot"), queued, q, NOW), { ok: true });
  const blocked = { ...payment, status: "blocked" as const };
  const b = toPendingItem(meeting, blocked, opts)!;
  assert.match((checkPhoneAction(action(b, "dismiss"), blocked, b, NOW) as { reason: string }).reason, /decline it there/);
});

test("the phone opens a held payment's /sign links only when they match the item", () => {
  const web = "https://getaftercall.vercel.app";
  const sign = (kind: "approve" | "cancel", over: Partial<{ payee: string; amount: string; followupId: string }> = {}, network: "testnet" | "mainnet" = "testnet") =>
    `${web}/sign#${encodeSignRequest({ network, contract: "wallet.aftercall.testnet", owner: "victor.testnet", action: { kind, followupId: "1762000000-f2", payee: "kemi.testnet", amount: "20000000", ...over } })}`;
  const blocked = { ...payment, status: "blocked" as const };
  const held = (approve: string, decline: string) => toPendingItem(meeting, blocked, { ...opts, signUrls: { approve, decline } }) as PaymentItem;
  assert.equal(signUrlsMatch(held(sign("approve"), sign("cancel")), web, "testnet"), true);
  assert.equal(signUrlsMatch(held(sign("approve"), sign("cancel")), web, "mainnet"), false, "another network");
  assert.equal(signUrlsMatch(held(sign("approve", { payee: "mallory.testnet" }), sign("cancel")), web, "testnet"), false, "another payee");
  assert.equal(signUrlsMatch(held(sign("approve", { amount: "20000001" }), sign("cancel")), web, "testnet"), false, "another amount");
  assert.equal(signUrlsMatch(held(sign("approve", { followupId: "1762000000-f9" }), sign("cancel")), web, "testnet"), false, "another follow-up");
  assert.equal(signUrlsMatch(held(sign("cancel"), sign("cancel")), web, "testnet"), false, "approve that declines");
  assert.equal(signUrlsMatch(held(sign("approve").replace(web, "https://evil.example"), sign("cancel")), web, "testnet"), false, "another site");
  const proposed = toPendingItem(meeting, payment, { ...opts, signUrls: { approve: sign("approve"), decline: sign("cancel") } }) as PaymentItem;
  assert.equal(proposed.signUrls, undefined, "only held payments carry them");
});
