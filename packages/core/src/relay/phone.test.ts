import { test } from "node:test";
import assert from "node:assert/strict";
import type { EmailFollowUp, FollowUp, Meeting, PaymentFollowUp } from "../meeting.ts";
import { RelayError, base64UrlToBytes, bytesToBase64Url, encodePairing, newPairing, sealEnvelope } from "./crypto.ts";
import { MAC_OFFLINE_AFTER_MS, checkPhoneAction, itemDigest, toPendingItem, type PaymentItem, type PendingItem, type Snapshot } from "./messages.ts";
import {
  RelayHttpError,
  afterHello,
  forgetTap,
  helloAttempt,
  inOrder,
  countdownText,
  deviceLabel,
  groupCode,
  isPhonePairing,
  itemAmount,
  itemTitle,
  macOfflineSince,
  phoneAction,
  phoneChoices,
  phoneRelay,
  routeText,
  startPhonePairing,
  takeSnapshot,
  tapHolds,
  tapState,
  tapText,
  type PhonePairing,
  type SnapshotPoll,
  type SnapshotReply,
} from "./phone.ts";
import { fakeMac, fakeRelay } from "./testkit.ts";

const BACKEND = "http://localhost:3101";
const NOW = 1_762_440_000_000;

const meeting: Meeting = {
  id: "1762000000", project: "Fundraise", title: "Sync with Ada", startedAt: "2026-11-06T14:02:00Z", durationSec: 192, verified: true,
  summary: "SECRET SUMMARY", decisions: [], actionItems: [], followUps: [], transcript: [], yourNotes: "",
};
const email: EmailFollowUp = { id: "f1", kind: "email", status: "proposed", to: "ada@example.com", toName: "Ada", subject: "Recap: Sync with Ada", evidence: { quote: "send Ada the recap", at: 0 } };
const payment: PaymentFollowUp = {
  id: "f2", kind: "payment", status: "proposed", payeeName: "Kemi", payeeAccount: "kemi.testnet", amount: 20_000_000n, heard: "the twenty dollars", payeeListed: true,
  evidence: { quote: "send Kemi the twenty dollars for the icons", at: 155 },
};
const item = (f: FollowUp, extra = {}) => toPendingItem(meeting, f, { backend: true, ...extra }) as PendingItem;
const snapshot = (items: PendingItem[], over: Partial<Snapshot> = {}): Snapshot => ({ t: "snapshot", at: NOW, network: "testnet", items, more: 0, done: [], results: [], ...over });

/** The relay's reply to a snapshot poll; fails the test on "waiting" or "gone". */
function replyOf(poll: SnapshotPoll): SnapshotReply {
  assert.equal(poll.kind, "reply");
  return (poll as Extract<SnapshotPoll, { kind: "reply" }>).reply;
}

/** A phone and a Mac paired through the in-memory relay, the way the page and the app do it. */
async function paired() {
  const relay = fakeRelay(() => NOW);
  const mac = await fakeMac(relay.fetch, BACKEND);
  let phone = helloAttempt(startPhonePairing(new URL(mac.url).hash, "iPhone · Safari", NOW));
  const api = phoneRelay(phone, relay.fetch);
  const hello = afterHello(phone, await api.hello(phone.hello));
  assert.ok("pairing" in hello);
  phone = hello.pairing;
  assert.equal(await mac.takeHello(), phone.code);
  await mac.confirm();
  return { relay, mac, api, phone };
}

test("a phone pairs from the QR's link, and both screens show the same code", async () => {
  const relay = fakeRelay(() => NOW);
  const mac = await fakeMac(relay.fetch, BACKEND);
  assert.match(mac.url, /^http:\/\/localhost:3000\/phone#pair=[A-Za-z0-9_-]+$/);
  const phone = startPhonePairing(new URL(mac.url).hash, "iPhone · Safari", NOW);
  assert.equal(phone.state, "hello");
  assert.equal(phone.backend, BACKEND);
  assert.match(phone.code, /^\d{6}$/);
  assert.equal(isPhonePairing(JSON.parse(JSON.stringify(phone))), true, "the record survives as plain values");

  const api = phoneRelay(phone, relay.fetch);
  assert.equal(await api.snapshot(0).then((r) => r.kind), "waiting", "nothing before the Mac says they match");
  assert.equal(await api.hello(phone.hello), "ok");
  assert.equal(await mac.takeHello(), phone.code);
  assert.equal(mac.device, "iPhone · Safari");
  assert.equal(await api.snapshot(0).then((r) => r.kind), "waiting", "still nothing until They match");
  await mac.confirm();

  const before = await api.snapshot(0);
  assert.ok(before.kind === "reply" && !before.reply.box, "confirmed, no snapshot yet");
  await mac.post(snapshot([item(payment)]));
  const poll = await api.snapshot(phone.version);
  assert.equal(poll.kind, "reply");
  const step = takeSnapshot({ ...phone, state: "confirming" }, replyOf(poll), NOW);
  assert.equal(step.kind, "opened");
  const now = (step as { pairing: PhonePairing }).pairing;
  assert.equal(now.state, "paired", "the first snapshot that opens completes pairing");
  assert.equal(now.pairedAt, NOW);
  assert.equal(now.snapshotN, 1);
  assert.equal(now.version, 1);
  assert.equal(now.snapshot?.items[0].followUpId, "f2");
  assert.deepEqual(relay.log.slice(-1), [`GET /relay/pairings/${phone.id}/snapshot`]);
});

test("a damaged or foreign pairing link is refused before anything is sent", () => {
  assert.throws(() => startPhonePairing("#pair=nope!", "x", NOW), (e: RelayError) => e.code === "BAD_PAIRING");
  const { pairing } = newPairing("https://api.example.com");
  const good = encodePairing(pairing);
  assert.doesNotThrow(() => startPhonePairing(`#pair=${good}`, "x", NOW));
  const raw = JSON.parse(new TextDecoder().decode(base64UrlToBytes(good)));
  const enc = (o: unknown) => `#pair=${bytesToBase64Url(new TextEncoder().encode(JSON.stringify(o)))}`;
  assert.throws(() => startPhonePairing(enc({ ...raw, v: 2 }), "x", NOW), (e: RelayError) => e.code === "BAD_VERSION");
  assert.throws(() => startPhonePairing(enc({ ...raw, api: "http://evil.example" }), "x", NOW), (e: RelayError) => e.code === "BAD_PAIRING");
  assert.throws(() => startPhonePairing(enc({ ...raw, mac: "short" }), "x", NOW), (e: RelayError) => e.code === "BAD_KEY");
});

test("someone else's hello first: the phone says so; a retry of its own lost hello goes on to the code", async () => {
  const relay = fakeRelay(() => NOW);
  const mac = await fakeMac(relay.fetch, BACKEND);
  const thief = startPhonePairing(new URL(mac.url).hash, "Thief", NOW);
  const phone = helloAttempt(startPhonePairing(new URL(mac.url).hash, "iPhone · Safari", NOW));
  assert.equal(phone.helloTries, 1);
  assert.equal(await phoneRelay(thief, relay.fetch).hello(thief.hello), "ok");
  const answer = await phoneRelay(phone, relay.fetch).hello(phone.hello);
  assert.equal(answer, "taken");
  assert.deepEqual(afterHello(phone, answer), { problem: "taken" });
  assert.notEqual(await mac.takeHello(), phone.code, "the Mac shows a code this phone doesn't");
  assert.equal("pairing" in afterHello(helloAttempt(phone), "taken"), true, "on a later try, taken is most likely our own earlier hello");

  await mac.unpair();
  assert.equal(await phoneRelay(phone, relay.fetch).hello(phone.hello), "gone");
  assert.deepEqual(afterHello(phone, "gone"), { problem: "gone" });
});

test("a snapshot that doesn't open keeps the last good one; a replayed or older one is refused", async () => {
  const { mac, api, phone: start } = await paired();
  await mac.post(snapshot([item(payment)]));
  let poll = await api.snapshot(0);
  let phone = (takeSnapshot(start, replyOf(poll), NOW) as { pairing: PhonePairing }).pairing;

  const unchanged = await api.snapshot(phone.version);
  assert.ok(unchanged.kind === "reply" && !unchanged.reply.box, "no box when nothing is newer");
  assert.deepEqual(takeSnapshot(phone, replyOf(unchanged), NOW), { kind: "unchanged" });

  // The relay can't forge: a box under another key fails as BAD_BOX.
  await mac.postBox(sealEnvelope(new Uint8Array(32).fill(1), "mac-to-phone", 9, snapshot([])));
  poll = await api.snapshot(phone.version);
  assert.deepEqual(takeSnapshot(phone, replyOf(poll), NOW), { kind: "unreadable", code: "BAD_BOX" });
  assert.equal(phone.snapshot?.items.length, 1, "the page keeps showing the last good snapshot");

  // A box the Mac sealed earlier, replayed under a newer version, fails as REPLAY.
  const key = base64UrlToBytes(phone.key);
  await mac.postBox(sealEnvelope(key, "mac-to-phone", 1, snapshot([])));
  poll = await api.snapshot(phone.version);
  assert.deepEqual(takeSnapshot(phone, replyOf(poll), NOW), { kind: "unreadable", code: "REPLAY" });

  // A box the phone sealed, reflected back, fails as WRONG_DIRECTION.
  await mac.postBox(sealEnvelope(key, "phone-to-mac", 50, snapshot([])));
  poll = await api.snapshot(phone.version);
  assert.deepEqual(takeSnapshot(phone, replyOf(poll), NOW), { kind: "unreadable", code: "WRONG_DIRECTION" });

  await mac.post(snapshot([]));
  poll = await api.snapshot(phone.version);
  const step = takeSnapshot(phone, replyOf(poll), NOW);
  assert.equal(step.kind, "opened", "the next good snapshot opens");
  phone = (step as { pairing: PhonePairing }).pairing;
  assert.equal(phone.snapshot?.items.length, 0);
});

test("a tap goes to the Mac sealed, with the next counter and the item's digest, and comes back as an outcome", async () => {
  const { mac, api, phone: start } = await paired();
  const pay = item(payment);
  await mac.post(snapshot([pay]));
  let phone = (takeSnapshot(start, replyOf(await api.snapshot(0)), NOW) as { pairing: PhonePairing }).pairing;

  const tap = phoneAction(phone, "approve", pay, NOW + 5_000);
  assert.equal(tap.n, 1);
  assert.equal(tap.pairing.actionN, 1, "saved with the new counter before it's posted");
  phone = tap.pairing;
  assert.equal(tapText(tapState(phone, pay)!, false), "Sent to your Mac.");
  assert.equal(tapText(tapState(phone, pay)!, true), "Sent. Your Mac will act on this when it's back online.");
  assert.deepEqual(await api.action(tap.box), { kind: "ok", seq: 1 });

  const second = phoneAction(phone, "dismiss", item(email), NOW + 6_000);
  assert.equal(second.n, 2);
  phone = second.pairing;
  await api.action(second.box);

  const got = await mac.collect();
  assert.deepEqual(got.map((a) => [a.n, a.action.kind, a.action.followUpId]), [[1, "approve", "f2"], [2, "dismiss", "f1"]]);
  assert.deepEqual(checkPhoneAction(got[0].action, payment, pay, NOW + 7_000), { ok: true }, "the Mac's own check passes on what the phone showed");
  assert.equal(checkPhoneAction(got[0].action, { ...payment, amount: 21_000_000n }, item({ ...payment, amount: 21_000_000n }), NOW).ok, false, "and fails once the amount changed");

  await mac.post(snapshot([], { results: [{ n: 2, outcome: "refused", reason: "It changed on your Mac since your phone showed it. Look again." }, { n: 1, outcome: "accepted" }] }));
  phone = (takeSnapshot(phone, replyOf(await api.snapshot(phone.version)), NOW) as { pairing: PhonePairing }).pairing;
  assert.equal(tapText(tapState(phone, pay)!, false), "Your Mac is doing it now.");
  assert.equal(tapText(tapState(phone, item(email))!, false), "Your Mac didn't do it: It changed on your Mac since your phone showed it. Look again.");
  assert.equal(tapState(phone, { meetingId: "x", followUpId: "y" }), null);

  assert.equal(tapHolds(tapState(phone, pay), pay), true, "approved on the Mac: nothing more to tap");
  assert.equal(tapHolds(tapState(phone, item(email)), item(email)), false, "refused: the card offers its buttons again");
  assert.equal(tapHolds(null, pay), false);
  const undo = { sent: { n: 9, kind: "undo-autopilot" as const, meetingId: "m", followUpId: "f", at: NOW }, result: null };
  assert.equal(tapHolds(undo, pay), true, "an Undo on its way");
  assert.equal(tapHolds({ ...undo, result: { n: 9, outcome: "accepted" as const } }, pay), false, "a stopped countdown leaves the item to approve or dismiss");

  // Approved, then the send failed or went over a cap: the item's own state decides again.
  const failed = item({ ...payment, status: "failed", error: "The quote moved" });
  assert.equal(tapHolds(tapState(phone, failed), failed), false, "a failed send offers Try again");
  assert.equal(phoneChoices(failed).approveLabel, "Try again");
  const held = item({ ...payment, status: "blocked" });
  assert.equal(tapHolds(tapState(phone, held), held), false, "a held payment offers the wallet");
  assert.equal(tapHolds({ ...tapState(phone, pay)!, result: null }, failed), true, "not answered yet: still waiting on the Mac");

  const lost = phoneAction(phone, "approve", pay, NOW);
  const forgotten = forgetTap(lost.pairing, lost.n);
  assert.equal(tapState(forgotten, pay)?.sent.n, 1, "a tap the relay never took no longer says Sent");
  assert.equal(forgotten.actionN, lost.n, "and its counter isn't used again");
});

test("taps reach the relay in counter order, or the Mac drops the earlier one as a replay", async () => {
  const { relay, mac, phone } = await paired();
  await mac.post(snapshot([]));
  // The first post is slow on the wire; the second would overtake it.
  let calls = 0;
  const slowFirst = async (url: string, init?: RequestInit) => {
    if (calls++ === 0) await new Promise((r) => setTimeout(r, 30));
    return relay.fetch(url, init);
  };
  const a = phoneAction(phone, "approve", item(payment), NOW);
  const b = phoneAction(a.pairing, "dismiss", item(email), NOW);

  await Promise.all([phoneRelay(phone, slowFirst).action(a.box), phoneRelay(phone, slowFirst).action(b.box)]);
  assert.deepEqual((await mac.collect()).map((x) => x.n), [2], "posted side by side, tap 1 lands second and is refused");

  const c = phoneAction(b.pairing, "approve", item(payment), NOW);
  const d = phoneAction(c.pairing, "dismiss", item(email), NOW);
  calls = 0;
  const queue = inOrder();
  await Promise.all([queue(() => phoneRelay(phone, slowFirst).action(c.box)), queue(() => phoneRelay(phone, slowFirst).action(d.box))]);
  assert.deepEqual((await mac.collect()).map((x) => x.n), [3, 4], "in order, both reach the Mac");

  const failing = queue(() => Promise.reject(new Error("offline")));
  await assert.rejects(failing);
  assert.equal(await queue(async () => "next"), "next", "a failed post doesn't stop the ones after it");
});

test("the relay's answers the page acts on: gone after unpairing, full at 50 waiting, errors otherwise", async () => {
  const { mac, api, phone } = await paired();
  await mac.post(snapshot([]));
  let p = phone;
  for (let i = 0; i < 50; i++) {
    const t = phoneAction(p, "dismiss", item(email), NOW);
    p = t.pairing;
    assert.equal((await api.action(t.box)).kind, "ok");
  }
  assert.deepEqual(await api.action(phoneAction(p, "dismiss", item(email), NOW).box), { kind: "full" });

  await api.unpair();
  assert.deepEqual(await api.snapshot(0), { kind: "gone" });
  assert.deepEqual(await api.action("AQ"), { kind: "gone" });
  await api.unpair(); // already gone counts as done

  const broken = phoneRelay(phone, async () => new Response(JSON.stringify({ statusCode: 413, message: "TOO_LARGE" }), { status: 413 }));
  await assert.rejects(broken.action("AQ"), (e: RelayHttpError) => e.status === 413 && e.code === "TOO_LARGE");
  const odd = phoneRelay(phone, async () => new Response(JSON.stringify({ version: "x" }), { status: 200 }));
  await assert.rejects(odd.snapshot(0), (e: RelayHttpError) => e.code === "BAD_REPLY");
  const down = phoneRelay(phone, async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(down.snapshot(0), TypeError);
});

test("a wrong phone token is treated as unpaired", async () => {
  const { relay, mac, phone } = await paired();
  await mac.post(snapshot([]));
  const api = phoneRelay({ ...phone, phoneToken: "x".repeat(43) }, relay.fetch);
  assert.deepEqual(await api.snapshot(0), { kind: "gone" });
});

test("requests carry the phone token as a bearer token and nothing readable", async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  const { phone } = await paired();
  const api = phoneRelay(phone, async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ seq: 4 }), { status: 200 });
  });
  const t = phoneAction(phone, "approve", item(payment), NOW);
  await api.action(t.box);
  assert.equal(seen[0].url, `${BACKEND}/relay/pairings/${phone.id}/actions`);
  assert.equal(new Headers(seen[0].init?.headers).get("authorization"), `Bearer ${phone.phoneToken}`);
  const sentBody = String(seen[0].init?.body);
  for (const secret of ["Kemi", "kemi.testnet", "20000000", "icons", "approve"]) assert.equal(sentBody.includes(secret), false, `"${secret}" isn't readable on the wire`);
});

test("the Mac is offline when the relay hasn't heard from it for a minute", () => {
  assert.equal(macOfflineSince({ now: NOW, macSeenAt: NOW - MAC_OFFLINE_AFTER_MS }), null);
  assert.equal(macOfflineSince({ now: NOW, macSeenAt: NOW - MAC_OFFLINE_AFTER_MS - 1 }), NOW - MAC_OFFLINE_AFTER_MS - 1);
});

test("the phone offers only what the Mac would run", () => {
  const cases: [string, FollowUp, Partial<ReturnType<typeof phoneChoices>>][] = [
    ["a listed payment", payment, { approve: true, dismiss: true, wallet: false }],
    ["a recap", email, { approve: true, dismiss: true }],
    ["a recap with no address", { ...email, to: "" }, { approve: false, dismiss: true, why: "No email address yet. Add one on your Mac." }],
    ["a payee not on your list", { ...payment, payeeListed: false, payeeAccount: "" }, { approve: false, dismiss: true }],
    ["an amount that didn't read", { ...payment, amount: null }, { approve: false, dismiss: true }],
    ["a held payment", { ...payment, status: "blocked" }, { approve: false, dismiss: false, wallet: true }],
    ["one on its way", { ...payment, status: "sending" }, { approve: false, dismiss: false, why: "Paying now." }],
    ["a failed send", { ...email, status: "failed", error: "The relay said no" }, { approve: true, approveLabel: "Try again" }],
    ["an autopilot countdown", { ...email, autopilotAt: NOW + 42_000 }, { approve: true, undoAutopilot: true }],
  ];
  for (const [what, f, want] of cases) {
    const i = item(f);
    const c = phoneChoices(i);
    for (const [k, v] of Object.entries(want)) assert.equal(c[k as keyof typeof c], v, `${what}: ${k}`);
    // Whatever the phone offers, the Mac's own check lets through.
    const act = (kind: "approve" | "dismiss" | "undo-autopilot") => ({ t: "action" as const, kind, meetingId: i.meetingId, followUpId: i.followUpId, digest: itemDigest(i), at: NOW });
    if (c.approve) assert.deepEqual(checkPhoneAction(act("approve"), f, i, NOW), { ok: true }, `${what}: approve`);
    else assert.equal(checkPhoneAction(act("approve"), f, i, NOW).ok, false, `${what}: no approve`);
    if (c.dismiss) assert.deepEqual(checkPhoneAction(act("dismiss"), f, i, NOW), { ok: true }, `${what}: dismiss`);
    if (c.undoAutopilot) assert.deepEqual(checkPhoneAction(act("undo-autopilot"), f, i, NOW), { ok: true }, `${what}: undo`);
  }
});

test("what a card says: title, amount, route", () => {
  const pay = item(payment, { route: { chain: "solana", address: "8xKemiSoLaNa111111111111111111111111111111" }, quoted: { amountOut: "19750000", at: NOW } }) as PaymentItem;
  assert.equal(itemTitle(pay), "Pay Kemi");
  assert.equal(itemAmount(pay), "20.00 USDC");
  assert.equal(routeText(pay), "USDC on Solana via NEAR Intents · Kemi gets about 19.75");
  assert.equal(routeText(item(payment)), "USDC on NEAR");
  assert.equal(itemAmount(item({ ...payment, amount: null })), null);
  assert.equal(itemTitle(item(email)), "Recap to Ada");
  assert.equal(itemTitle(item({ ...email, toName: "", to: "" })), "Recap to the group");
  assert.equal(routeText(item(email)), null);
});

test("small words: the code, the device, the countdown", () => {
  assert.equal(groupCode("418207"), "418 207");
  assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), "iPhone · Safari");
  assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1"), "iPhone · Chrome");
  assert.equal(deviceLabel("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"), "Android · Chrome");
  assert.equal(deviceLabel(""), "Phone · Browser");
  assert.equal(countdownText(42_000), "0:42");
  assert.equal(countdownText(41_001), "0:42");
  assert.equal(countdownText(61_000), "1:01");
  assert.equal(countdownText(-5), "0:00");
});

test("taps older than a day are dropped when the next snapshot opens", async () => {
  const { mac, api, phone: start } = await paired();
  const old = { ...start, sent: [{ n: 1, kind: "approve" as const, meetingId: "m", followUpId: "f", at: NOW - 25 * 3_600_000 }], actionN: 1 };
  await mac.post(snapshot([]));
  const step = takeSnapshot(old, replyOf(await api.snapshot(0)), NOW);
  assert.deepEqual((step as { pairing: PhonePairing }).pairing.sent, []);
  assert.equal((step as { pairing: PhonePairing }).pairing.actionN, 1, "the counter never goes back");
});
