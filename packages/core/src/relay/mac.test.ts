import { test } from "node:test";
import assert from "node:assert/strict";
import type { EmailFollowUp, FollowUp, Meeting, PaymentFollowUp } from "../meeting.ts";
import { decodeSignRequest } from "../wallet/actions.ts";
import { decodePairing, deriveSession, newPairing, newRelayKeys, openHello, pairingIdText, pairingUrl, relayTokenHash, sealHello } from "./crypto.ts";
import { itemDigest, openSnapshot, sealAction, sealSnapshot, signUrlsMatch, toPendingItem, type ActionResult, type PaymentItem, type PhoneAction } from "./messages.ts";
import {
  AUTOPILOT_COUNTING,
  MAX_RESULTS,
  buildSnapshot,
  contractFollowupId,
  handlePhoneActions,
  heldPaymentActions,
  heldPaymentSignUrls,
  mergeResults,
  snapshotKey,
  type ActionTarget,
  type SnapshotMeeting,
} from "./mac.ts";

const NOW = Date.parse("2026-11-06T14:10:00Z");
const email: EmailFollowUp = { id: "f1", kind: "email", status: "proposed", to: "ada@example.com", toName: "Ada", subject: "Recap: Sync with Ada", evidence: { quote: "send Ada the recap", at: 0 } };
const payment: PaymentFollowUp = {
  id: "f2", kind: "payment", status: "proposed", payeeName: "Kemi", payeeAccount: "kemi.testnet", amount: 20_000_000n, heard: "the twenty dollars", payeeListed: true,
  evidence: { quote: "send Kemi the twenty dollars for the icons", at: 155 },
};
const meeting = (id: string, startedAt: string, followUps: FollowUp[]): Meeting => ({
  id, project: "Fundraise", title: `Meeting ${id}`, startedAt, durationSec: 192, verified: true,
  summary: "SECRET SUMMARY", decisions: ["SECRET DECISION"], actionItems: [{ id: "a1", text: "SECRET ITEM", owner: "Victor", done: false }],
  followUps, transcript: [{ at: 3, speaker: "others", text: "SECRET TRANSCRIPT" }], yourNotes: "SECRET NOTES",
});
const opts = () => ({ backend: true });
const today = meeting("1762440000", "2026-11-06T14:02:00Z", [email, payment, { ...email, id: "f3", status: "sent", doneAt: "14:06" }, { ...payment, id: "f4", status: "dismissed" }]);
const older = meeting("1762300000", "2026-11-04T09:00:00Z", [{ ...payment, id: "f5", status: "blocked" }, { ...payment, id: "f6", status: "paid", doneAt: "09:10" }]);

function session() {
  const mac = newRelayKeys();
  const phone = newRelayKeys();
  const common = { pairingId: new Uint8Array(32).fill(9), macPublicKey: mac.publicKey, phonePublicKey: phone.publicKey };
  return { mac: deriveSession({ ...common, ourSecretKey: mac.secretKey, theirPublicKey: phone.publicKey }), phone: deriveSession({ ...common, ourSecretKey: phone.secretKey, theirPublicKey: mac.publicKey }) };
}

test("a snapshot lists what waits, newest meeting first, and what went out in today's meetings", () => {
  const s = buildSnapshot({ at: NOW, network: "testnet", meetings: [older, today].map((m) => ({ meeting: m, options: opts })), results: [] });
  assert.deepEqual(s.items.map((i) => `${i.meetingId}/${i.followUpId}/${i.status}`), ["1762440000/f1/proposed", "1762440000/f2/proposed", "1762300000/f5/blocked"]);
  assert.deepEqual(s.done.map((d) => d.label), ["Recap sent to Ada"], "an older meeting's payment isn't in today's list");
  assert.equal(s.more, 0);
  const text = JSON.stringify(s);
  for (const secret of ["SECRET SUMMARY", "SECRET DECISION", "SECRET ITEM", "SECRET TRANSCRIPT", "SECRET NOTES"]) assert.ok(!text.includes(secret), secret);
});

test("a snapshot seals and opens on the phone, and its key ignores only the time", () => {
  const { mac, phone } = session();
  const s = buildSnapshot({ at: NOW, network: "testnet", meetings: [{ meeting: today, options: opts }], results: [{ n: 1, outcome: "accepted" }] });
  assert.deepEqual(openSnapshot(phone.key, 0, sealSnapshot(mac.key, 1, s)).snapshot, s);
  assert.equal(snapshotKey(s), snapshotKey({ ...s, at: NOW + 60_000 }));
  assert.notEqual(snapshotKey(s), snapshotKey({ ...s, results: [] }));
});

test("each follow-up gets its own options: a held payment carries /sign links the phone accepts", () => {
  const held = older.followUps[0] as PaymentFollowUp;
  const actions = heldPaymentActions(older, held, { leftToday: 5_000_000n, dailyCap: 50_000_000n }, NOW);
  assert.equal(actions.approve.kind === "approve" && actions.approve.context?.leftToday, "5.00 of 50.00");
  assert.equal(actions.approve.kind === "approve" && actions.approve.followupId, contractFollowupId(older.id, held.id));
  const signUrls = heldPaymentSignUrls("https://getaftercall.vercel.app/sign", { network: "testnet", contract: "aftercall.testnet", owner: "victor.testnet" }, actions);
  const options: SnapshotMeeting["options"] = (f) => ({ backend: true, ...(f.id === held.id ? { signUrls } : {}) });
  const s = buildSnapshot({ at: NOW, network: "testnet", meetings: [{ meeting: older, options }], results: [] });
  const item = s.items[0] as PaymentItem;
  assert.deepEqual(item.signUrls, signUrls);
  assert.ok(signUrlsMatch(item, "https://getaftercall.vercel.app", "testnet"));
  assert.equal(decodeSignRequest(signUrls.decline.split("#")[1]).action.kind, "cancel");
});

test("an item the schema refuses is left out and counted, and the rest still go", () => {
  const odd = meeting("1762440000", "2026-11-06T14:02:00Z", [email, { ...payment, id: "f2 with spaces" }]);
  const s = buildSnapshot({ at: NOW, network: "testnet", meetings: [{ meeting: odd, options: opts }], results: [] });
  assert.deepEqual(s.items.map((i) => i.followUpId), ["f1"]);
  assert.equal(s.more, 1);
  const { mac } = session();
  assert.ok(sealSnapshot(mac.key, 1, s));
});

test("results keep the newest twenty", () => {
  const old: ActionResult[] = Array.from({ length: 20 }, (_, i) => ({ n: 20 - i, outcome: "accepted" }));
  const merged = mergeResults([{ n: 22, outcome: "refused", reason: "x" }, { n: 21, outcome: "accepted" }], old);
  assert.equal(merged.length, MAX_RESULTS);
  assert.deepEqual(merged.slice(0, 3).map((r) => r.n), [22, 21, 20]);
});

// ---------- actions ----------

function harness(followUps: FollowUp[] = [email, payment]) {
  const { mac, phone } = session();
  const m = meeting("1762440000", "2026-11-06T14:02:00Z", followUps);
  const item = (id: string) => toPendingItem(m, m.followUps.find((f) => f.id === id)!, { backend: true })!;
  const tap = (id: string, kind: PhoneAction["kind"] = "approve", at = NOW): PhoneAction => ({ t: "action", kind, meetingId: m.id, followUpId: id, digest: itemDigest(item(id)), at });
  const ran: PhoneAction[] = [];
  const saved: number[] = [];
  const busy = new Map<string, string>();
  const target = (meetingId: string, fuId: string): ActionTarget => {
    const f = meetingId === m.id ? m.followUps.find((x) => x.id === fuId) : undefined;
    return { followUp: f, item: f ? toPendingItem(m, f, { backend: true }) : null, busy: busy.get(fuId) };
  };
  const handle = (actions: { seq: number; box: string }[], lastN = 0, run: (a: PhoneAction) => void = (a) => void ran.push(a)) =>
    handlePhoneActions({ key: mac.key, lastN, actions, now: () => NOW, target, run, save: (n) => void saved.push(n) });
  return { mac, phone, m, tap, ran, saved, busy, handle };
}

test("an action that passes every check runs once, and its counter is saved", async () => {
  const h = harness();
  const r = await h.handle([{ seq: 7, box: sealAction(h.phone.key, 1, h.tap("f2")) }]);
  assert.deepEqual(h.ran.map((a) => [a.kind, a.followUpId]), [["approve", "f2"]]);
  assert.deepEqual(r, { lastN: 1, ackSeq: 7, results: [{ n: 1, outcome: "accepted" }], skipped: 0 });
  assert.deepEqual(h.saved, [1]);
});

test("a box that fails to open runs nothing and is acknowledged: tampered, wrong key, reflected, replayed", async () => {
  const h = harness();
  const good = sealAction(h.phone.key, 3, h.tap("f2"));
  const tampered = good.slice(0, 40) + (good[40] === "A" ? "B" : "A") + good.slice(41);
  const stranger = sealAction(newRelayKeys().secretKey, 4, h.tap("f2"));
  const reflected = sealSnapshot(h.mac.key, 5, buildSnapshot({ at: NOW, network: "testnet", meetings: [], results: [] }));
  const replayed = sealAction(h.phone.key, 2, h.tap("f1"));
  const r = await h.handle([{ seq: 1, box: tampered }, { seq: 2, box: stranger }, { seq: 3, box: reflected }, { seq: 4, box: replayed }, { seq: 5, box: "not a box!" }], 2);
  assert.deepEqual(h.ran, []);
  assert.deepEqual(r, { lastN: 2, ackSeq: 5, results: [], skipped: 5 });
  assert.deepEqual(h.saved, []);
});

test("a box replayed after it ran is refused by its counter", async () => {
  const h = harness();
  const box = sealAction(h.phone.key, 1, h.tap("f1"));
  const first = await h.handle([{ seq: 1, box }]);
  const again = await h.handle([{ seq: 2, box }], first.lastN);
  assert.equal(h.ran.length, 1);
  assert.equal(again.skipped, 1);
});

test("actions run in relay order, and a follow-up is acted on at most once a batch", async () => {
  const h = harness();
  const r = await h.handle([
    { seq: 12, box: sealAction(h.phone.key, 3, h.tap("f2", "approve")) },
    { seq: 10, box: sealAction(h.phone.key, 1, h.tap("f1", "approve")) },
    { seq: 11, box: sealAction(h.phone.key, 2, h.tap("f2", "dismiss")) },
  ]);
  assert.deepEqual(h.ran.map((a) => `${a.kind}:${a.followUpId}`), ["approve:f1", "dismiss:f2"]);
  assert.deepEqual(r.results.map((x) => [x.n, x.outcome]), [[3, "refused"], [2, "accepted"], [1, "accepted"]]);
  assert.match(r.results[0].reason ?? "", /acted on the first/);
  assert.equal(r.lastN, 3);
});

test("an action is refused when the follow-up changed, is gone, is too old, or the Mac is busy with it", async () => {
  const h = harness();
  const changed = { ...h.tap("f2"), digest: "0".repeat(64) };
  const gone = { ...h.tap("f2"), followUpId: "f9" };
  const stale = h.tap("f2", "approve", NOW - 25 * 3_600_000);
  h.busy.set("f1", "Your Mac is counting down on it. Undo it there first.");
  const busy = h.tap("f1");
  const r = await h.handle([changed, gone, stale, busy].map((a, i) => ({ seq: i + 1, box: sealAction(h.phone.key, i + 1, a) })));
  assert.deepEqual(h.ran, []);
  assert.deepEqual(
    r.results.reverse().map((x) => x.reason),
    ["It changed on your Mac since your phone showed it. Look again.", "This follow-up isn't on your Mac any more.", "Too old: tapped more than a day ago.", "Your Mac is counting down on it. Undo it there first."],
  );
  assert.equal(r.lastN, 4, "refused actions still move the counter on");
});

test("a payment held for the wallet, or already sending, can't be approved from the phone", async () => {
  const h = harness([{ ...payment, status: "blocked" }, { ...email, status: "sending" }]);
  const r = await h.handle([
    { seq: 1, box: sealAction(h.phone.key, 1, h.tap("f2")) },
    { seq: 2, box: sealAction(h.phone.key, 2, h.tap("f1")) },
  ]);
  assert.deepEqual(h.ran, []);
  assert.deepEqual(r.results.map((x) => x.reason), ["It's already on its way.", "It's held for your NEAR wallet: approve it there."]);
});

test("approving from the phone is refused while autopilot counts down on it; undoing autopilot isn't", async () => {
  const h = harness([{ ...payment, autopilotAt: NOW + 30_000 }]);
  const r = await h.handle([
    { seq: 1, box: sealAction(h.phone.key, 1, h.tap("f2", "approve")) },
    { seq: 2, box: sealAction(h.phone.key, 2, h.tap("f2", "undo-autopilot")) },
  ]);
  assert.deepEqual(h.ran.map((a) => a.kind), ["undo-autopilot"]);
  assert.deepEqual(r.results.map((x) => [x.n, x.outcome, x.reason]), [[2, "accepted", undefined], [1, "refused", AUTOPILOT_COUNTING]]);
});

// ---------- the whole round trip, through a fake relay ----------

/** The relay as docs/design/phone-protocol.md §4 describes it, in memory: it stores hashes and opaque boxes only. */
function fakeRelay() {
  type Row = { macTokenHash: string; phoneTokenHash?: string; hello?: string; snapshot?: string; version: number; actions: { seq: number; box: string }[] };
  const rows = new Map<string, Row>();
  let seq = 0;
  const row = (id: string, token: string, who: "mac" | "phone"): Row => {
    const p = rows.get(id);
    if (!p) throw new Error("NO_PAIRING");
    if (relayTokenHash(token) !== (who === "mac" ? p.macTokenHash : p.phoneTokenHash)) throw new Error("BAD_TOKEN");
    return p;
  };
  return {
    stored: () => JSON.stringify([...rows.values()]),
    create: (id: string, macTokenHash: string) => void rows.set(id, { macTokenHash, version: 0, actions: [] }),
    hello: (id: string, box: string) => {
      const p = rows.get(id)!;
      if (p.hello || p.phoneTokenHash) throw new Error("HELLO_TAKEN");
      p.hello = box;
    },
    readHello: (id: string, macToken: string) => row(id, macToken, "mac").hello ?? null,
    confirm: (id: string, macToken: string, phoneTokenHash: string) => {
      const p = row(id, macToken, "mac");
      p.phoneTokenHash = phoneTokenHash;
      p.hello = undefined;
    },
    postSnapshot: (id: string, macToken: string, box: string) => {
      const p = row(id, macToken, "mac");
      p.snapshot = box;
      p.version += 1;
    },
    readSnapshot: (id: string, phoneToken: string) => row(id, phoneToken, "phone").snapshot!,
    postAction: (id: string, phoneToken: string, box: string) => void row(id, phoneToken, "phone").actions.push({ seq: ++seq, box }),
    readActions: (id: string, macToken: string) => [...row(id, macToken, "mac").actions],
    ack: (id: string, macToken: string, upTo: number) => {
      const p = row(id, macToken, "mac");
      p.actions = p.actions.filter((a) => a.seq > upTo);
    },
  };
}

test("pair, snapshot, tap and act, through a fake relay that holds only hashes and boxes", async () => {
  const relay = fakeRelay();
  // The Mac makes the QR code and registers the pairing by its hashes.
  const { pairing, mac, macToken } = newPairing("https://api.example.com");
  const id = pairingIdText(pairing);
  relay.create(id, relayTokenHash(macToken));
  const url = pairingUrl("https://getaftercall.vercel.app/phone", pairing);

  // The phone scans it and posts its sealed hello; a second hello is refused.
  const scanned = decodePairing(new URL(url).hash);
  const phoneKeys = newRelayKeys();
  relay.hello(id, sealHello(scanned, phoneKeys.publicKey, "iPhone · Safari"));
  assert.throws(() => relay.hello(id, sealHello(scanned, newRelayKeys().publicKey, "Someone else")), /HELLO_TAKEN/);

  // Both sides derive the session, and both screens show the same code.
  const hello = openHello(pairing.pairingId, mac.secretKey, relay.readHello(id, macToken)!);
  assert.equal(hello.device, "iPhone · Safari");
  const common = { pairingId: pairing.pairingId, macPublicKey: pairing.macPublicKey, phonePublicKey: hello.phonePublicKey };
  const macSession = deriveSession({ ...common, ourSecretKey: mac.secretKey, theirPublicKey: hello.phonePublicKey });
  const phoneSession = deriveSession({ ...common, ourSecretKey: phoneKeys.secretKey, theirPublicKey: scanned.macPublicKey });
  assert.equal(macSession.code, phoneSession.code);

  // They match: the Mac confirms and posts its first snapshot.
  relay.confirm(id, macToken, relayTokenHash(macSession.phoneToken));
  const m = meeting("1762440000", "2026-11-06T14:02:00Z", [email, payment]);
  relay.postSnapshot(id, macToken, sealSnapshot(macSession.key, 1, buildSnapshot({ at: NOW, network: "testnet", meetings: [{ meeting: m, options: opts }], results: [] })));

  // The phone opens it and taps Approve on the payment.
  const shown = openSnapshot(phoneSession.key, 0, relay.readSnapshot(id, phoneSession.phoneToken)).snapshot;
  const pay = shown.items.find((i) => i.kind === "payment")!;
  relay.postAction(id, phoneSession.phoneToken, sealAction(phoneSession.key, 1, { t: "action", kind: "approve", meetingId: pay.meetingId, followUpId: pay.followUpId, digest: itemDigest(pay), at: NOW }));

  // The Mac reads it, re-checks it against the follow-up, runs it once and acknowledges it.
  const ran: PhoneAction[] = [];
  const done = await handlePhoneActions({
    key: macSession.key,
    lastN: 0,
    actions: relay.readActions(id, macToken),
    now: () => NOW,
    target: (_meetingId, fuId) => {
      const f = m.followUps.find((x) => x.id === fuId);
      return { followUp: f, item: f ? toPendingItem(m, f, opts()) : null };
    },
    run: (a) => void ran.push(a),
    save: () => {},
  });
  relay.ack(id, macToken, done.ackSeq!);
  assert.deepEqual(ran.map((a) => [a.kind, a.followUpId]), [["approve", "f2"]]);
  assert.deepEqual(relay.readActions(id, macToken), []);

  // The relay held nothing readable: no names, amounts, quotes, addresses, labels or tokens.
  const stored = relay.stored();
  for (const plain of ["Kemi", "kemi.testnet", "20000000", "twenty dollars", "ada@example.com", "Meeting 1762440000", "iPhone", macToken, macSession.phoneToken]) {
    assert.ok(!stored.includes(plain), plain);
  }
});

test("if the app's own handler throws, the result says so and the counter still moves", async () => {
  const h = harness();
  const r = await h.handle([{ seq: 1, box: sealAction(h.phone.key, 1, h.tap("f1")) }], 0, () => {
    throw new Error("boom");
  });
  assert.equal(r.results[0].outcome, "refused");
  assert.equal(r.lastN, 1);
});
