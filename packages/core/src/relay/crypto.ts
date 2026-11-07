import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, concatBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils";

/**
 * The phone relay's cryptography, shared by the Mac app and the phone page
 * (docs/design/phone-protocol.md). The backend only ever holds what these functions
 * output: opaque boxes, and sha256 hashes of the pairing id and the two tokens.
 *
 *   Pairing:   the Mac's QR holds its X25519 public key, a random 32-byte pairing id
 *              and the backend URL, in the URL fragment.
 *   Hello:     the phone's X25519 public key, sealed to the Mac's key with a fresh
 *              ephemeral key: [version][ephemeral public key 32][nonce 24][ciphertext + tag].
 *   Session:   X25519 → HKDF-SHA256 (salt: the transcript hash) → a 32-byte envelope
 *              key and the phone's relay token; a 6-digit code from the transcript hash.
 *   Envelopes: XChaCha20-Poly1305 under the session key: [version][nonce 24][ciphertext + tag],
 *              the plaintext JSON {dir, n, body} padded with spaces. `dir` stops a box
 *              being reflected back to its sender; `n` only goes up, so a replayed or
 *              reordered box is refused.
 */

export const RELAY_VERSION = 1;

/** Who sealed an envelope. The Mac sends snapshots; the phone sends actions. */
export type Direction = "mac-to-phone" | "phone-to-mac";

/**
 * Plaintext sizes, after padding. Every hello and every action pads to its limit, so
 * the backend can't tell an approve from a dismiss by its size; a snapshot pads to the
 * next 1 KiB, so its size says little about how many items wait.
 */
export const RELAY_LIMITS = {
  helloBytes: 512,
  actionBytes: 1024,
  snapshotBytes: 64 * 1024,
  snapshotPadTo: 1024,
} as const;

/** Length of base64url text (no padding) for `n` bytes. */
const base64UrlLength = (n: number) => Math.ceil((n * 4) / 3);

/**
 * The longest box text of each kind; the backend refuses anything longer before it
 * stores it. hello: 780, action: 1,420, snapshot: 87,436 characters.
 */
export const RELAY_BOX_LIMITS = {
  hello: base64UrlLength(1 + 32 + 24 + RELAY_LIMITS.helloBytes + 16),
  action: base64UrlLength(1 + 24 + RELAY_LIMITS.actionBytes + 16),
  snapshot: base64UrlLength(1 + 24 + RELAY_LIMITS.snapshotBytes + 16),
} as const;

export type RelayErrorCode = "BAD_PAIRING" | "BAD_KEY" | "BAD_VERSION" | "BAD_BOX" | "WRONG_DIRECTION" | "REPLAY" | "TOO_LARGE" | "BAD_MESSAGE";

/** Anything the relay code refuses. `code` is stable; the message is for logs, never shown with content. */
export class RelayError extends Error {
  readonly code: RelayErrorCode;
  constructor(code: RelayErrorCode, message: string = code) {
    super(message);
    this.name = "RelayError";
    this.code = code;
  }
}

// ---------- base64url ----------

const B64U = /^[A-Za-z0-9_-]*$/;

export function bytesToBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Strict: anything but base64url characters is refused, never skipped. */
export function base64UrlToBytes(text: string): Uint8Array {
  if (!B64U.test(text) || text.length % 4 === 1) throw new RelayError("BAD_BOX", "Not base64url");
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const key32 = (b64u: unknown, what: string): Uint8Array => {
  if (typeof b64u !== "string" || b64u.length !== 43) throw new RelayError("BAD_KEY", `${what} isn't 32 bytes`);
  return base64UrlToBytes(b64u);
};

/** sha256 of a token's base64url text, hex: what the backend stores and compares (as for claim tokens). */
export const relayTokenHash = (token: string) => bytesToHex(sha256(utf8ToBytes(token)));

// ---------- keys and pairing ----------

export interface RelayKeys {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

/** A fresh X25519 key pair: the Mac makes one per pairing, the phone one per pairing too. */
export function newRelayKeys(secretKey: Uint8Array = randomBytes(32)): RelayKeys {
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

/** What the Mac's QR code carries. */
export interface Pairing {
  macPublicKey: Uint8Array;
  /** 32 random bytes; its base64url text addresses the pairing on the relay. */
  pairingId: Uint8Array;
  /** The backend's origin, e.g. https://api.example.com. */
  backend: string;
}

/** Everything the Mac makes to start a pairing. `macToken` never leaves the Mac except as a bearer token to the relay. */
export function newPairing(backend: string): { pairing: Pairing; mac: RelayKeys; macToken: string } {
  const mac = newRelayKeys();
  const pairing = { macPublicKey: mac.publicKey, pairingId: randomBytes(32), backend: checkBackend(backend) };
  return { pairing, mac, macToken: bytesToBase64Url(randomBytes(32)) };
}

/** The pairing id as it appears in relay paths: 43 base64url characters. */
export const pairingIdText = (p: Pick<Pairing, "pairingId">) => bytesToBase64Url(p.pairingId);

/** https only, or http on this machine for development. No path, query or credentials. */
function checkBackend(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new RelayError("BAD_PAIRING", "Backend isn't a URL");
  }
  const local = u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !local) throw new RelayError("BAD_PAIRING", "Backend must be https");
  if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) throw new RelayError("BAD_PAIRING", "Backend must be an origin");
  return u.origin;
}

/** The payload after `#pair=`: base64url of {"v":1,"mac":…,"id":…,"api":…}. */
export function encodePairing(p: Pairing): string {
  const json = JSON.stringify({ v: RELAY_VERSION, mac: bytesToBase64Url(p.macPublicKey), id: bytesToBase64Url(p.pairingId), api: checkBackend(p.backend) });
  return bytesToBase64Url(utf8ToBytes(json));
}

/** The URL the QR code encodes. The pairing rides in the fragment, which browsers never send to a server. */
export function pairingUrl(phonePage: string, p: Pairing): string {
  return `${phonePage}#pair=${encodePairing(p)}`;
}

/** Reads a pairing from `location.hash` ("#pair=…"), "pair=…" or the bare payload. Anything unexpected is refused. */
export function decodePairing(fragment: string): Pairing {
  const payload = fragment.replace(/^#/, "").replace(/^pair=/, "");
  if (payload.length > 400) throw new RelayError("BAD_PAIRING", "Pairing code is too long");
  let raw: { v?: unknown; mac?: unknown; id?: unknown; api?: unknown };
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(payload)));
  } catch {
    throw new RelayError("BAD_PAIRING", "Not a pairing code");
  }
  if (raw?.v !== RELAY_VERSION) throw new RelayError("BAD_VERSION", "Unknown pairing version");
  if (typeof raw.api !== "string") throw new RelayError("BAD_PAIRING", "No backend");
  return { macPublicKey: key32(raw.mac, "Mac key"), pairingId: key32(raw.id, "Pairing id"), backend: checkBackend(raw.api) };
}

// ---------- hello: the phone's key, sealed to the Mac ----------

const HELLO_INFO = utf8ToBytes("aftercall-relay-v1 hello");
const VERSION_AAD = new Uint8Array([RELAY_VERSION]);

function padJson(value: unknown, limit: number, padTo: number): Uint8Array {
  const raw = utf8ToBytes(JSON.stringify(value));
  if (raw.length > limit) throw new RelayError("TOO_LARGE", `${raw.length} bytes, over ${limit}`);
  const size = Math.min(limit, Math.ceil(Math.max(raw.length, 1) / padTo) * padTo);
  const out = new Uint8Array(size).fill(0x20); // spaces: JSON.parse ignores them
  out.set(raw);
  return out;
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new RelayError("BAD_MESSAGE", "Not JSON");
  }
}

/** The phone's first message: its public key and a device label, readable only by the Mac. */
export function sealHello(p: Pairing, phonePublicKey: Uint8Array, device: string): string {
  const eph = newRelayKeys();
  const key = hkdf(sha256, x25519.getSharedSecret(eph.secretKey, p.macPublicKey), p.pairingId, HELLO_INFO, 32);
  const nonce = randomBytes(24);
  const plain = padJson({ phone: bytesToBase64Url(phonePublicKey), device: device.replace(/\s+/g, " ").trim().slice(0, 40) }, RELAY_LIMITS.helloBytes, RELAY_LIMITS.helloBytes);
  return bytesToBase64Url(concatBytes(VERSION_AAD, eph.publicKey, nonce, xchacha20poly1305(key, nonce, VERSION_AAD).encrypt(plain)));
}

export function openHello(pairingId: Uint8Array, macSecretKey: Uint8Array, box: string): { phonePublicKey: Uint8Array; device: string } {
  if (box.length > RELAY_BOX_LIMITS.hello) throw new RelayError("TOO_LARGE");
  const data = base64UrlToBytes(box);
  if (data.length < 1 + 32 + 24 + 16) throw new RelayError("BAD_BOX", "Too short");
  if (data[0] !== RELAY_VERSION) throw new RelayError("BAD_VERSION");
  let plain: Uint8Array;
  try {
    const key = hkdf(sha256, x25519.getSharedSecret(macSecretKey, data.slice(1, 33)), pairingId, HELLO_INFO, 32);
    plain = xchacha20poly1305(key, data.slice(33, 57), VERSION_AAD).decrypt(data.slice(57));
  } catch {
    throw new RelayError("BAD_BOX", "Hello didn't open");
  }
  const h = parseJson(plain) as { phone?: unknown; device?: unknown };
  return { phonePublicKey: key32(h?.phone, "Phone key"), device: typeof h.device === "string" ? h.device.slice(0, 40) : "" };
}

// ---------- the session ----------

export interface RelaySession {
  /** XChaCha20-Poly1305 key for every envelope, both ways. */
  key: Uint8Array;
  /** The phone's bearer token on the relay; the Mac registers only its hash. */
  phoneToken: string;
  /** Six digits both screens show; the Mac accepts nothing until you say they match. */
  code: string;
  /** sha256 over the pairing id and both public keys, hex. */
  transcript: string;
}

/**
 * Both sides run this with their own secret key and the other's public key, and get the
 * same session. A key swapped in by anyone else gives a different transcript, so the
 * codes differ.
 */
export function deriveSession(args: { pairingId: Uint8Array; macPublicKey: Uint8Array; phonePublicKey: Uint8Array; ourSecretKey: Uint8Array; theirPublicKey: Uint8Array }): RelaySession {
  const { pairingId, macPublicKey, phonePublicKey } = args;
  if (pairingId.length !== 32 || macPublicKey.length !== 32 || phonePublicKey.length !== 32) throw new RelayError("BAD_KEY");
  let shared: Uint8Array;
  try {
    shared = x25519.getSharedSecret(args.ourSecretKey, args.theirPublicKey);
  } catch {
    throw new RelayError("BAD_KEY", "Key agreement failed");
  }
  if (shared.every((b) => b === 0)) throw new RelayError("BAD_KEY", "Low-order key");
  const transcript = sha256(concatBytes(utf8ToBytes("aftercall-relay-v1"), pairingId, macPublicKey, phonePublicKey));
  const okm = hkdf(sha256, shared, transcript, utf8ToBytes("aftercall-relay-v1 keys"), 64);
  const digest = sha256(concatBytes(utf8ToBytes("aftercall-relay-v1 code"), transcript));
  const n = new DataView(digest.buffer, digest.byteOffset, 8).getBigUint64(0) % 1_000_000n;
  return { key: okm.slice(0, 32), phoneToken: bytesToBase64Url(okm.slice(32, 64)), code: n.toString().padStart(6, "0"), transcript: bytesToHex(transcript) };
}

// ---------- envelopes ----------

const LIMIT: Record<Direction, { bytes: number; padTo: number; box: number }> = {
  "mac-to-phone": { bytes: RELAY_LIMITS.snapshotBytes, padTo: RELAY_LIMITS.snapshotPadTo, box: RELAY_BOX_LIMITS.snapshot },
  "phone-to-mac": { bytes: RELAY_LIMITS.actionBytes, padTo: RELAY_LIMITS.actionBytes, box: RELAY_BOX_LIMITS.action },
};

const isCounter = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;

/** Seals one message. `n` is the sender's counter: start at 1, add 1 for every box, keep it across restarts. */
export function sealEnvelope(key: Uint8Array, dir: Direction, n: number, body: unknown): string {
  if (!isCounter(n)) throw new RelayError("BAD_MESSAGE", "Counter must be a positive integer");
  const nonce = randomBytes(24);
  const plain = padJson({ dir, n, body }, LIMIT[dir].bytes, LIMIT[dir].padTo);
  return bytesToBase64Url(concatBytes(VERSION_AAD, nonce, xchacha20poly1305(key, nonce, VERSION_AAD).encrypt(plain)));
}

/**
 * Opens one message sealed in direction `dir`. `lastN` is the highest counter already
 * accepted from that sender (0 before the first); anything not above it is a replay.
 * The caller stores the returned `n` as its new `lastN` once it has acted on the body.
 */
export function openEnvelope(key: Uint8Array, dir: Direction, lastN: number, box: string): { n: number; body: unknown } {
  if (box.length > LIMIT[dir].box) throw new RelayError("TOO_LARGE");
  const data = base64UrlToBytes(box);
  if (data.length < 1 + 24 + 16) throw new RelayError("BAD_BOX", "Too short");
  if (data[0] !== RELAY_VERSION) throw new RelayError("BAD_VERSION");
  let plain: Uint8Array;
  try {
    plain = xchacha20poly1305(key, data.slice(1, 25), VERSION_AAD).decrypt(data.slice(25));
  } catch {
    throw new RelayError("BAD_BOX", "Envelope didn't open");
  }
  const m = parseJson(plain) as { dir?: unknown; n?: unknown; body?: unknown };
  if (m?.dir !== dir) throw new RelayError("WRONG_DIRECTION");
  if (!isCounter(m.n)) throw new RelayError("BAD_MESSAGE", "No counter");
  if (m.n <= lastN) throw new RelayError("REPLAY", `Counter ${m.n} isn't above ${lastN}`);
  return { n: m.n, body: m.body };
}
