import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RELAY_BOX_LIMITS,
  RELAY_LIMITS,
  RelayError,
  base64UrlToBytes,
  bytesToBase64Url,
  decodePairing,
  deriveSession,
  encodePairing,
  newPairing,
  newRelayKeys,
  openEnvelope,
  openHello,
  pairingIdText,
  pairingUrl,
  relayTokenHash,
  sealEnvelope,
  sealHello,
} from "./crypto.ts";

const refused = (code: string) => (e: unknown) => e instanceof RelayError && e.code === code;

/** A Mac and a phone that have paired, as both sides derive it. */
function paired() {
  const { pairing, mac, macToken } = newPairing("https://api.aftercall.test");
  const phone = newRelayKeys();
  const hello = openHello(pairing.pairingId, mac.secretKey, sealHello(pairing, phone.publicKey, "iPhone · Safari"));
  const common = { pairingId: pairing.pairingId, macPublicKey: pairing.macPublicKey, phonePublicKey: hello.phonePublicKey };
  const onMac = deriveSession({ ...common, ourSecretKey: mac.secretKey, theirPublicKey: hello.phonePublicKey });
  const onPhone = deriveSession({ ...common, phonePublicKey: phone.publicKey, ourSecretKey: phone.secretKey, theirPublicKey: pairing.macPublicKey });
  return { pairing, mac, macToken, phone, hello, onMac, onPhone };
}

const flip = (box: string, at: number) => {
  const b = base64UrlToBytes(box);
  b[at] ^= 0x01;
  return bytesToBase64Url(b);
};

test("base64url round-trips bytes and refuses anything else", () => {
  const b = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
  assert.deepEqual(base64UrlToBytes(bytesToBase64Url(b)), b);
  assert.throws(() => base64UrlToBytes("ab+/"), refused("BAD_BOX"));
  assert.throws(() => base64UrlToBytes("abc=="), refused("BAD_BOX"));
});

test("the pairing code round-trips through the QR URL's fragment", () => {
  const { pairing } = newPairing("https://api.aftercall.test/");
  const url = new URL(pairingUrl("https://getaftercall.vercel.app/phone", pairing));
  assert.equal(url.pathname, "/phone");
  assert.equal(url.search, "", "nothing in the query string, which servers see");
  const back = decodePairing(url.hash);
  assert.deepEqual(back.macPublicKey, pairing.macPublicKey);
  assert.deepEqual(back.pairingId, pairing.pairingId);
  assert.equal(back.backend, "https://api.aftercall.test");
  assert.equal(pairingIdText(back).length, 43);
  assert.deepEqual(decodePairing(encodePairing(pairing)).pairingId, pairing.pairingId, "the bare payload reads too");
});

test("a pairing code with a bad key, version or backend is refused", () => {
  const { pairing } = newPairing("https://api.aftercall.test");
  const raw = (o: object) => bytesToBase64Url(new TextEncoder().encode(JSON.stringify(o)));
  const good = { v: 1, mac: bytesToBase64Url(pairing.macPublicKey), id: bytesToBase64Url(pairing.pairingId), api: "https://api.aftercall.test" };
  assert.throws(() => decodePairing(raw({ ...good, v: 2 })), refused("BAD_VERSION"));
  assert.throws(() => decodePairing(raw({ ...good, mac: "short" })), refused("BAD_KEY"));
  assert.throws(() => decodePairing(raw({ ...good, api: "http://api.aftercall.test" })), refused("BAD_PAIRING"));
  assert.throws(() => decodePairing(raw({ ...good, api: "https://api.aftercall.test/x?y=1" })), refused("BAD_PAIRING"));
  assert.throws(() => decodePairing("#pair=not-json"), refused("BAD_PAIRING"));
  assert.throws(() => decodePairing(`#pair=${"A".repeat(500)}`), refused("BAD_PAIRING"));
  assert.equal(decodePairing(raw({ ...good, api: "http://localhost:3001" })).backend, "http://localhost:3001", "local development backend");
  assert.throws(() => newPairing("ftp://x"), refused("BAD_PAIRING"));
});

test("only the Mac opens the phone's hello, and a tampered one fails", () => {
  const { pairing, mac, phone } = paired();
  const box = sealHello(pairing, phone.publicKey, "  iPhone   ·  Safari  ");
  assert.equal(box.length, RELAY_BOX_LIMITS.hello, "every hello is the same size");
  const opened = openHello(pairing.pairingId, mac.secretKey, box);
  assert.deepEqual(opened.phonePublicKey, phone.publicKey);
  assert.equal(opened.device, "iPhone · Safari");
  assert.throws(() => openHello(pairing.pairingId, newRelayKeys().secretKey, box), refused("BAD_BOX"), "another key can't open it");
  assert.throws(() => openHello(new Uint8Array(32), mac.secretKey, box), refused("BAD_BOX"), "bound to this pairing id");
  assert.throws(() => openHello(pairing.pairingId, mac.secretKey, flip(box, 70)), refused("BAD_BOX"));
  assert.throws(() => openHello(pairing.pairingId, mac.secretKey, flip(box, 0)), refused("BAD_VERSION"));
  assert.throws(() => openHello(pairing.pairingId, mac.secretKey, `${box}AAAA`), refused("TOO_LARGE"));
});

test("both sides derive the same key, phone token and six-digit code", () => {
  const { onMac, onPhone } = paired();
  assert.deepEqual(onMac.key, onPhone.key);
  assert.equal(onMac.phoneToken, onPhone.phoneToken);
  assert.equal(onMac.code, onPhone.code);
  assert.match(onMac.code, /^\d{6}$/);
  assert.equal(onMac.transcript, onPhone.transcript);
  assert.equal(onMac.phoneToken.length, 43);
  assert.match(relayTokenHash(onMac.phoneToken), /^[0-9a-f]{64}$/);
});

test("a key swapped in by someone who saw the QR gives different codes and keys", () => {
  const { pairing, mac, phone, onPhone } = paired();
  const intruder = newRelayKeys();
  const onMac = deriveSession({ pairingId: pairing.pairingId, macPublicKey: pairing.macPublicKey, phonePublicKey: intruder.publicKey, ourSecretKey: mac.secretKey, theirPublicKey: intruder.publicKey });
  assert.notEqual(onMac.code, onPhone.code);
  assert.notDeepEqual(onMac.key, onPhone.key);
  assert.notEqual(onMac.phoneToken, onPhone.phoneToken);
  assert.ok(phone);
});

test("a low-order public key is refused", () => {
  const { pairing, mac } = paired();
  const zero = new Uint8Array(32);
  assert.throws(() => deriveSession({ pairingId: pairing.pairingId, macPublicKey: pairing.macPublicKey, phonePublicKey: zero, ourSecretKey: mac.secretKey, theirPublicKey: zero }), refused("BAD_KEY"));
});

test("envelopes round-trip each way", () => {
  const { onMac, onPhone } = paired();
  const toPhone = sealEnvelope(onMac.key, "mac-to-phone", 1, { hello: "phone" });
  assert.deepEqual(openEnvelope(onPhone.key, "mac-to-phone", 0, toPhone), { n: 1, body: { hello: "phone" } });
  const toMac = sealEnvelope(onPhone.key, "phone-to-mac", 7, { hello: "mac" });
  assert.deepEqual(openEnvelope(onMac.key, "phone-to-mac", 6, toMac), { n: 7, body: { hello: "mac" } });
});

test("a tampered byte, a wrong key or a wrong version fails", () => {
  const { onMac, onPhone } = paired();
  const box = sealEnvelope(onMac.key, "mac-to-phone", 1, { x: 1 });
  for (const at of [1, 24, 30, base64UrlToBytes(box).length - 1]) assert.throws(() => openEnvelope(onPhone.key, "mac-to-phone", 0, flip(box, at)), refused("BAD_BOX"), `byte ${at}`);
  assert.throws(() => openEnvelope(newRelayKeys().secretKey, "mac-to-phone", 0, box), refused("BAD_BOX"));
  assert.throws(() => openEnvelope(onPhone.key, "mac-to-phone", 0, flip(box, 0)), refused("BAD_VERSION"));
  assert.throws(() => openEnvelope(onPhone.key, "mac-to-phone", 0, "AAAA"), refused("BAD_BOX"));
});

test("a replayed or reordered counter fails", () => {
  const { onMac, onPhone } = paired();
  const first = sealEnvelope(onPhone.key, "phone-to-mac", 1, { a: 1 });
  const second = sealEnvelope(onPhone.key, "phone-to-mac", 2, { a: 2 });
  let last = 0;
  last = openEnvelope(onMac.key, "phone-to-mac", last, first).n;
  assert.throws(() => openEnvelope(onMac.key, "phone-to-mac", last, first), refused("REPLAY"), "the same box again");
  last = openEnvelope(onMac.key, "phone-to-mac", last, second).n;
  assert.equal(last, 2);
  assert.throws(() => openEnvelope(onMac.key, "phone-to-mac", 2, first), refused("REPLAY"), "an older box after a newer one");
  assert.throws(() => sealEnvelope(onPhone.key, "phone-to-mac", 0, {}), refused("BAD_MESSAGE"));
  assert.throws(() => sealEnvelope(onPhone.key, "phone-to-mac", 1.5, {}), refused("BAD_MESSAGE"));
});

test("a box sent back the other way fails on its direction", () => {
  const { onMac, onPhone } = paired();
  const fromPhone = sealEnvelope(onPhone.key, "phone-to-mac", 1, { a: 1 });
  assert.throws(() => openEnvelope(onPhone.key, "mac-to-phone", 0, fromPhone), refused("WRONG_DIRECTION"), "reflected to its sender");
  const fromMac = sealEnvelope(onMac.key, "mac-to-phone", 1, { s: 1 });
  assert.throws(() => openEnvelope(onMac.key, "phone-to-mac", 0, fromMac), refused("WRONG_DIRECTION"), "the Mac's own snapshot, sent back to it");
  const big = sealEnvelope(onMac.key, "mac-to-phone", 2, { s: "x".repeat(2000) });
  assert.throws(() => openEnvelope(onMac.key, "phone-to-mac", 0, big), refused("TOO_LARGE"), "over the action size, refused before it is opened");
});

test("sizes: actions pad to one size, snapshots to the next KiB, and the limits hold", () => {
  const { onMac } = paired();
  const approve = sealEnvelope(onMac.key, "phone-to-mac", 1, { kind: "approve" });
  const dismiss = sealEnvelope(onMac.key, "phone-to-mac", 2, { kind: "dismiss", more: "x".repeat(200) });
  assert.equal(approve.length, dismiss.length);
  assert.equal(sealEnvelope(onMac.key, "mac-to-phone", 1, { s: "x".repeat(10) }).length, Math.ceil(((1 + 24 + 1024 + 16) * 4) / 3));
  assert.equal(sealEnvelope(onMac.key, "mac-to-phone", 1, { s: "x".repeat(1100) }).length, Math.ceil(((1 + 24 + 2048 + 16) * 4) / 3));
  assert.throws(() => sealEnvelope(onMac.key, "phone-to-mac", 1, { s: "x".repeat(RELAY_LIMITS.actionBytes) }), refused("TOO_LARGE"));
  assert.throws(() => sealEnvelope(onMac.key, "mac-to-phone", 1, { s: "x".repeat(RELAY_LIMITS.snapshotBytes) }), refused("TOO_LARGE"));
  const biggest = sealEnvelope(onMac.key, "mac-to-phone", 1, { s: "x".repeat(RELAY_LIMITS.snapshotBytes - 44) });
  assert.equal(biggest.length, RELAY_BOX_LIMITS.snapshot);
  assert.deepEqual(RELAY_BOX_LIMITS, { hello: 780, action: 1420, snapshot: 87436 }, "the numbers the backend enforces");
});
