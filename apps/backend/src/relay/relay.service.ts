import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { MemoryDailyCounts, limitKey, utcDay, type DailyCounts } from "../limits";
import { MemoryRelayStore, relayHash, type RelayPairing, type RelayStore } from "./relay.store";

/**
 * The phone relay (docs/design/phone-protocol.md, "The relay"): it passes sealed boxes
 * between the Mac app and the phone page. It holds no key, so it can't read a box or
 * forge one: it stores and returns opaque base64url text, refuses anything over its
 * size, and forgets it on time. The pairing id addresses a pairing and lets a phone post
 * its hello; after that each side calls with its own bearer token. Ids and tokens are
 * compared and stored only as sha256.
 */

/**
 * The longest box text of each kind: RELAY_BOX_LIMITS in packages/core/src/relay/crypto.ts
 * (the backend builds to CommonJS and can't import core). A test checks they match.
 */
export const RELAY_BOX_LIMITS = { hello: 780, action: 1_420, snapshot: 87_436 } as const;
/** An action waits this long at most: ACTION_TTL_MS in packages/core/src/relay/messages.ts. */
export const ACTION_TTL_MS = 24 * 3_600_000;
/** An unconfirmed pairing is gone this long after it was made: the Mac's QR lasts as long. PAIRING_WAIT_MS in packages/core/src/relay/messages.ts. */
export const PAIRING_WAIT_MS = 10 * 60_000;
/** A confirmed pairing is gone this long after the Mac last called. */
export const PAIRING_IDLE_MS = 30 * 86_400_000;
/** Actions waiting for the Mac at most; the phone is told to wait. */
export const MAX_WAITING_ACTIONS = 50;
/** Daily limits, per IP for the unauthenticated calls and per pairing for the rest. */
export const RELAY_DAILY = { pairingsPerIp: 20, hellosPerIp: 20, snapshotsPerPairing: 3_000, actionsPerPairing: 300 } as const;
/** Expired rows are deleted on a write at most this often, per server instance. */
export const SWEEP_EVERY_MS = 60_000;

const PAIRING_ID = /^[A-Za-z0-9_-]{43}$/;
const BOX = /^[A-Za-z0-9_-]+$/;
const HASH = /^[0-9a-f]{64}$/;
const BEARER = /^Bearer ([A-Za-z0-9_-]{16,200})$/;

const fail = (code: string, status: HttpStatus) => new HttpException(code, status);

function boxOf(body: unknown, max: number): string {
  const box = (body as { box?: unknown } | null)?.box;
  if (typeof box !== "string" || !box) throw fail("BAD_BOX", HttpStatus.BAD_REQUEST);
  if (box.length > max) throw fail("TOO_LARGE", HttpStatus.PAYLOAD_TOO_LARGE);
  if (!BOX.test(box) || box.length % 4 === 1) throw fail("BAD_BOX", HttpStatus.BAD_REQUEST);
  return box;
}

function hashOf(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) throw fail("BAD_HASH", HttpStatus.BAD_REQUEST);
  return value;
}

const sameHash = (a: string, b: string | null) => b !== null && a.length === b.length && timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));

@Injectable()
export class RelayService {
  private sweptAt = -Infinity;

  constructor(
    private readonly store: RelayStore = new MemoryRelayStore(),
    private readonly daily: DailyCounts = new MemoryDailyCounts(),
    private readonly now: () => number = Date.now,
  ) {}

  // ---------- the Mac ----------

  /** The Mac registers a new pairing by its id, with the hash of its own token. */
  async create(id: unknown, macTokenHash: unknown, ip: string): Promise<{ expiresAt: number }> {
    const idHash = this.idHash(id);
    const tokenHash = hashOf(macTokenHash);
    await this.limit("relay-pairings", ip, RELAY_DAILY.pairingsPerIp, "IP_DAILY_LIMIT");
    const now = this.now();
    await this.sweep(now);
    const p: RelayPairing = {
      idHash,
      macTokenHash: tokenHash,
      phoneTokenHash: null,
      hello: null,
      state: "waiting",
      createdAt: now,
      expiresAt: now + PAIRING_WAIT_MS,
      macSeenAt: now,
      snapshot: null,
      snapshotVersion: 0,
      snapshotAt: null,
    };
    if (!(await this.store.insert(p))) throw fail("PAIRING_EXISTS", HttpStatus.CONFLICT);
    return { expiresAt: p.expiresAt };
  }

  /** The phone's sealed public key, once one has arrived. */
  async hello(id: unknown, authorization: string | undefined): Promise<{ box: string | null }> {
    const p = await this.mac(id, authorization);
    return { box: p.hello };
  }

  /** The codes matched: the phone's token (by its hash) may now read and post. */
  async confirm(id: unknown, authorization: string | undefined, phoneTokenHash: unknown): Promise<void> {
    const hash = hashOf(phoneTokenHash);
    const p = await this.mac(id, authorization);
    if (!(await this.store.confirm(p.idHash, hash, this.now() + PAIRING_IDLE_MS))) throw fail("NO_HELLO", HttpStatus.CONFLICT);
  }

  /** Replaces the snapshot; the phone sees the new version on its next poll. */
  async postSnapshot(id: unknown, authorization: string | undefined, body: unknown): Promise<{ version: number }> {
    const box = boxOf(body, RELAY_BOX_LIMITS.snapshot);
    const p = await this.mac(id, authorization);
    if (p.state !== "active") throw fail("NOT_CONFIRMED", HttpStatus.CONFLICT);
    await this.limit("relay-snapshots", p.idHash, RELAY_DAILY.snapshotsPerPairing, "DAILY_LIMIT");
    const now = this.now();
    await this.sweep(now);
    const version = await this.store.putSnapshot(p.idHash, box, now);
    if (version === null) throw fail("NO_PAIRING", HttpStatus.NOT_FOUND);
    return { version };
  }

  /** The phone's waiting actions, oldest first. */
  async actions(id: unknown, authorization: string | undefined): Promise<{ actions: { seq: number; box: string; postedAt: number }[] }> {
    const p = await this.mac(id, authorization);
    return { actions: await this.store.actions(p.idHash, this.now() - ACTION_TTL_MS, MAX_WAITING_ACTIONS) };
  }

  /** The Mac has handled the actions up to `seq`: they're deleted. */
  async ack(id: unknown, authorization: string | undefined, seq: unknown): Promise<void> {
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) throw fail("BAD_SEQ", HttpStatus.BAD_REQUEST);
    const p = await this.mac(id, authorization);
    await this.sweep(this.now());
    await this.store.ack(p.idHash, seq);
  }

  // ---------- the phone ----------

  /** The phone's sealed public key. Knowing the id is the capability; only the first hello is kept. */
  async postHello(id: unknown, body: unknown, ip: string): Promise<void> {
    const idHash = this.idHash(id);
    const box = boxOf(body, RELAY_BOX_LIMITS.hello);
    await this.limit("relay-hellos", ip, RELAY_DAILY.hellosPerIp, "IP_DAILY_LIMIT");
    const now = this.now();
    await this.sweep(now);
    if (!(await this.store.get(idHash, now))) throw fail("NO_PAIRING", HttpStatus.NOT_FOUND);
    if (!(await this.store.setHello(idHash, box, now))) throw fail("HELLO_TAKEN", HttpStatus.CONFLICT);
  }

  /** The latest snapshot's version and times; the box only when it's newer than `after`. */
  async snapshot(id: unknown, authorization: string | undefined, after: unknown) {
    const since = after === undefined || after === "" ? 0 : Number(after);
    if (!Number.isSafeInteger(since) || since < 0) throw fail("BAD_AFTER", HttpStatus.BAD_REQUEST);
    const p = await this.phone(id, authorization);
    return {
      now: this.now(),
      version: p.snapshotVersion,
      postedAt: p.snapshotAt,
      macSeenAt: p.macSeenAt,
      ...(p.snapshot !== null && p.snapshotVersion > since ? { box: p.snapshot } : {}),
    };
  }

  /** One sealed tap, kept until the Mac acknowledges it or for a day. */
  async postAction(id: unknown, authorization: string | undefined, body: unknown): Promise<{ seq: number }> {
    const box = boxOf(body, RELAY_BOX_LIMITS.action);
    const p = await this.phone(id, authorization);
    await this.limit("relay-actions", p.idHash, RELAY_DAILY.actionsPerPairing, "DAILY_LIMIT");
    const now = this.now();
    await this.sweep(now);
    const seq = await this.store.addAction(p.idHash, box, now, now - ACTION_TTL_MS, MAX_WAITING_ACTIONS);
    if (seq === null) throw fail("NO_PAIRING", HttpStatus.NOT_FOUND);
    if (seq === "full") throw fail("TOO_MANY_ACTIONS", HttpStatus.TOO_MANY_REQUESTS);
    return { seq };
  }

  // ---------- either ----------

  /** Unpair: the pairing, its snapshot and its actions are deleted. Either side's token works. */
  async unpair(id: unknown, authorization: string | undefined): Promise<void> {
    const p = await this.pairing(id);
    const token = tokenHash(authorization);
    if (!sameHash(token, p.macTokenHash) && !sameHash(token, p.phoneTokenHash)) throw fail("BAD_TOKEN", HttpStatus.UNAUTHORIZED);
    await this.store.delete(p.idHash);
  }

  // ---------- helpers ----------

  private idHash(id: unknown): string {
    if (typeof id !== "string" || !PAIRING_ID.test(id)) throw fail("BAD_PAIRING", HttpStatus.BAD_REQUEST);
    return relayHash(id);
  }

  private async pairing(id: unknown): Promise<RelayPairing> {
    const p = await this.store.get(this.idHash(id), this.now());
    if (!p) throw fail("NO_PAIRING", HttpStatus.NOT_FOUND);
    return p;
  }

  /** A call with the Mac's token. Every one counts as the Mac being seen, and keeps an active pairing alive. */
  private async mac(id: unknown, authorization: string | undefined): Promise<RelayPairing> {
    const p = await this.pairing(id);
    if (!sameHash(tokenHash(authorization), p.macTokenHash)) throw fail("BAD_TOKEN", HttpStatus.UNAUTHORIZED);
    const now = this.now();
    await this.store.macSeen(p.idHash, now, now + PAIRING_IDLE_MS);
    return { ...p, macSeenAt: now };
  }

  /** A call with the phone's token, which exists only once the Mac has confirmed. */
  private async phone(id: unknown, authorization: string | undefined): Promise<RelayPairing> {
    const p = await this.pairing(id);
    if (p.state !== "active") throw fail("NOT_CONFIRMED", HttpStatus.CONFLICT);
    if (!sameHash(tokenHash(authorization), p.phoneTokenHash)) throw fail("BAD_TOKEN", HttpStatus.UNAUTHORIZED);
    return p;
  }

  private async limit(scope: string, id: string, max: number, code: string): Promise<void> {
    const key = limitKey(scope, id);
    const day = utcDay(this.now());
    if ((await this.daily.get(key, day)) >= max) throw fail(code, HttpStatus.TOO_MANY_REQUESTS);
    await this.daily.increment(key, day);
  }

  /** Expired rows go on a write, once a minute at most; reads already treat them as gone. */
  private async sweep(now: number): Promise<void> {
    if (now - this.sweptAt < SWEEP_EVERY_MS) return;
    this.sweptAt = now;
    await this.store.sweep(now, now - ACTION_TTL_MS);
  }
}

/** sha256 of the bearer token in an Authorization header; 401 without one. */
function tokenHash(authorization: string | undefined): string {
  const m = BEARER.exec(authorization ?? "");
  if (!m) throw fail("BAD_TOKEN", HttpStatus.UNAUTHORIZED);
  return relayHash(m[1]);
}
