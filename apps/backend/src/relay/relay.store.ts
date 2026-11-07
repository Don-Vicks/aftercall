import { createHash } from "node:crypto";
import type { Pool } from "pg";

/**
 * Where the phone relay keeps its boxes (docs/design/phone-protocol.md, "The relay").
 * Postgres in production; memory for unit tests. A pairing is keyed by the sha256 of
 * its id, and the Mac's and phone's tokens are kept only as sha256 too, so a copy of
 * the database can't address a pairing or act as either side. Everything else is an
 * opaque sealed box the relay can't open: no keys, no meeting, no payee, no amount.
 */
export interface RelayPairing {
  idHash: string;
  macTokenHash: string;
  /** Set by /confirm. */
  phoneTokenHash: string | null;
  /** The sealed hello, until /confirm clears it. */
  hello: string | null;
  state: "waiting" | "active";
  createdAt: number;
  expiresAt: number;
  macSeenAt: number;
  /** The latest sealed snapshot. */
  snapshot: string | null;
  snapshotVersion: number;
  snapshotAt: number | null;
}

export interface RelayAction {
  seq: number;
  box: string;
  postedAt: number;
}

export interface RelayStore {
  /** False if a live pairing already has this id. */
  insert(p: RelayPairing): Promise<boolean>;
  /** A pairing that hasn't expired, or null. */
  get(idHash: string, now: number): Promise<RelayPairing | null>;
  /** Keeps the first hello only: false once one is stored or the pairing is active. */
  setHello(idHash: string, box: string, now: number): Promise<boolean>;
  /** Waiting with a hello → active: stores the phone's token hash and drops the hello. */
  confirm(idHash: string, phoneTokenHash: string, expiresAt: number): Promise<boolean>;
  /** The Mac called: when it was, and for an active pairing, when it now expires. */
  macSeen(idHash: string, now: number, expiresAt: number): Promise<void>;
  /** Replaces the snapshot; the new version, or null when the pairing isn't active. */
  putSnapshot(idHash: string, box: string, now: number): Promise<number | null>;
  /** Queues an action and returns its seq; "full" when `max` posted after `since` already wait, null when the pairing is gone. */
  addAction(idHash: string, box: string, now: number, since: number, max: number): Promise<number | "full" | null>;
  /** Waiting actions posted after `since`, oldest first. */
  actions(idHash: string, since: number, limit: number): Promise<RelayAction[]>;
  /** Deletes the pairing's actions up to `seq`. */
  ack(idHash: string, seq: number): Promise<void>;
  /** Deletes the pairing, its snapshot and its actions. */
  delete(idHash: string): Promise<void>;
  /** Deletes expired pairings, and actions posted before `actionsBefore`. */
  sweep(now: number, actionsBefore: number): Promise<void>;
}

/** sha256 of a pairing id's or token's text, hex: `relayTokenHash` in packages/core. */
export const relayHash = (text: string) => createHash("sha256").update(text).digest("hex");

export class MemoryRelayStore implements RelayStore {
  private readonly pairings = new Map<string, RelayPairing>();
  private readonly queued: (RelayAction & { idHash: string })[] = [];
  private seq = 0;

  async insert(p: RelayPairing) {
    if (this.pairings.has(p.idHash)) return false;
    this.pairings.set(p.idHash, { ...p });
    return true;
  }
  async get(idHash: string, now: number) {
    const p = this.pairings.get(idHash);
    return p && p.expiresAt > now ? { ...p } : null;
  }
  async setHello(idHash: string, box: string, now: number) {
    const p = this.pairings.get(idHash);
    if (!p || p.expiresAt <= now || p.state !== "waiting" || p.hello !== null) return false;
    p.hello = box;
    return true;
  }
  async confirm(idHash: string, phoneTokenHash: string, expiresAt: number) {
    const p = this.pairings.get(idHash);
    if (!p || p.state !== "waiting" || p.hello === null) return false;
    Object.assign(p, { state: "active", phoneTokenHash, hello: null, expiresAt });
    return true;
  }
  async macSeen(idHash: string, now: number, expiresAt: number) {
    const p = this.pairings.get(idHash);
    if (!p) return;
    p.macSeenAt = now;
    if (p.state === "active") p.expiresAt = expiresAt;
  }
  async putSnapshot(idHash: string, box: string, now: number) {
    const p = this.pairings.get(idHash);
    if (!p || p.state !== "active") return null;
    Object.assign(p, { snapshot: box, snapshotVersion: p.snapshotVersion + 1, snapshotAt: now });
    return p.snapshotVersion;
  }
  async addAction(idHash: string, box: string, now: number, since: number, max: number) {
    if (!this.pairings.has(idHash)) return null;
    if (this.queued.filter((a) => a.idHash === idHash && a.postedAt > since).length >= max) return "full" as const;
    this.queued.push({ idHash, seq: ++this.seq, box, postedAt: now });
    return this.seq;
  }
  async actions(idHash: string, since: number, limit: number) {
    return this.queued
      .filter((a) => a.idHash === idHash && a.postedAt > since)
      .slice(0, limit)
      .map(({ seq, box, postedAt }) => ({ seq, box, postedAt }));
  }
  async ack(idHash: string, seq: number) {
    this.remove((a) => a.idHash === idHash && a.seq <= seq);
  }
  async delete(idHash: string) {
    this.pairings.delete(idHash);
    this.remove((a) => a.idHash === idHash);
  }
  async sweep(now: number, actionsBefore: number) {
    for (const [k, p] of this.pairings) if (p.expiresAt <= now) this.delete(k);
    this.remove((a) => a.postedAt <= actionsBefore);
  }
  private remove(match: (a: RelayAction & { idHash: string }) => boolean) {
    for (let i = this.queued.length - 1; i >= 0; i--) if (match(this.queued[i])) this.queued.splice(i, 1);
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS relay_pairings (
  id_hash          text PRIMARY KEY,
  mac_token_hash   text NOT NULL,
  phone_token_hash text,
  hello            text,
  state            text NOT NULL CHECK (state IN ('waiting', 'active')),
  created_at       bigint NOT NULL,
  expires_at       bigint NOT NULL,
  mac_seen_at      bigint NOT NULL,
  snapshot         text,
  snapshot_version integer NOT NULL DEFAULT 0,
  snapshot_at      bigint
);
CREATE TABLE IF NOT EXISTS relay_actions (
  seq       bigserial PRIMARY KEY,
  id_hash   text NOT NULL REFERENCES relay_pairings (id_hash) ON DELETE CASCADE,
  box       text NOT NULL,
  posted_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS relay_actions_pairing ON relay_actions (id_hash, seq);
`;

/** Every column of the relay's tables. A test checks the live tables have exactly these. */
export const RELAY_PAIRING_COLUMNS = [
  "id_hash",
  "mac_token_hash",
  "phone_token_hash",
  "hello",
  "state",
  "created_at",
  "expires_at",
  "mac_seen_at",
  "snapshot",
  "snapshot_version",
  "snapshot_at",
];
export const RELAY_ACTION_COLUMNS = ["seq", "id_hash", "box", "posted_at"];

interface Row {
  id_hash: string;
  mac_token_hash: string;
  phone_token_hash: string | null;
  hello: string | null;
  state: RelayPairing["state"];
  created_at: string;
  expires_at: string;
  mac_seen_at: string;
  snapshot: string | null;
  snapshot_version: number;
  snapshot_at: string | null;
}

const toPairing = (r: Row): RelayPairing => ({
  idHash: r.id_hash,
  macTokenHash: r.mac_token_hash,
  phoneTokenHash: r.phone_token_hash,
  hello: r.hello,
  state: r.state,
  createdAt: Number(r.created_at),
  expiresAt: Number(r.expires_at),
  macSeenAt: Number(r.mac_seen_at),
  snapshot: r.snapshot,
  snapshotVersion: Number(r.snapshot_version),
  snapshotAt: r.snapshot_at === null ? null : Number(r.snapshot_at),
});

/** Postgres's error code for a row whose foreign key points nowhere. */
const FOREIGN_KEY_VIOLATION = "23503";

export class PgRelayStore implements RelayStore {
  constructor(private readonly pool: Pool) {}

  /** Creates the tables if needed. Safe to run on every start. */
  async migrate(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async insert(p: RelayPairing) {
    const r = await this.pool.query(
      `INSERT INTO relay_pairings (id_hash, mac_token_hash, state, created_at, expires_at, mac_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id_hash) DO NOTHING`,
      [p.idHash, p.macTokenHash, p.state, p.createdAt, p.expiresAt, p.macSeenAt],
    );
    return r.rowCount === 1;
  }
  async get(idHash: string, now: number) {
    const r = await this.pool.query<Row>("SELECT * FROM relay_pairings WHERE id_hash = $1 AND expires_at > $2", [idHash, now]);
    return r.rows[0] ? toPairing(r.rows[0]) : null;
  }
  async setHello(idHash: string, box: string, now: number) {
    // One statement, so two phones posting at once can't both get in.
    const r = await this.pool.query(
      "UPDATE relay_pairings SET hello = $2 WHERE id_hash = $1 AND state = 'waiting' AND hello IS NULL AND expires_at > $3",
      [idHash, box, now],
    );
    return r.rowCount === 1;
  }
  async confirm(idHash: string, phoneTokenHash: string, expiresAt: number) {
    const r = await this.pool.query(
      "UPDATE relay_pairings SET state = 'active', phone_token_hash = $2, hello = NULL, expires_at = $3 WHERE id_hash = $1 AND state = 'waiting' AND hello IS NOT NULL",
      [idHash, phoneTokenHash, expiresAt],
    );
    return r.rowCount === 1;
  }
  async macSeen(idHash: string, now: number, expiresAt: number) {
    await this.pool.query(
      "UPDATE relay_pairings SET mac_seen_at = $2, expires_at = CASE WHEN state = 'active' THEN $3 ELSE expires_at END WHERE id_hash = $1",
      [idHash, now, expiresAt],
    );
  }
  async putSnapshot(idHash: string, box: string, now: number) {
    const r = await this.pool.query<{ snapshot_version: number }>(
      "UPDATE relay_pairings SET snapshot = $2, snapshot_version = snapshot_version + 1, snapshot_at = $3 WHERE id_hash = $1 AND state = 'active' RETURNING snapshot_version",
      [idHash, box, now],
    );
    return r.rows[0] ? Number(r.rows[0].snapshot_version) : null;
  }
  async addAction(idHash: string, box: string, now: number, since: number, max: number) {
    try {
      const r = await this.pool.query<{ seq: string }>(
        `INSERT INTO relay_actions (id_hash, box, posted_at)
         SELECT $1, $2, $3 WHERE (SELECT count(*) FROM relay_actions WHERE id_hash = $1 AND posted_at > $4) < $5
         RETURNING seq`,
        [idHash, box, now, since, max],
      );
      return r.rows[0] ? Number(r.rows[0].seq) : ("full" as const);
    } catch (e) {
      // The pairing was deleted after the token check: as if it had never been there.
      if ((e as { code?: string }).code === FOREIGN_KEY_VIOLATION) return null;
      throw e;
    }
  }
  async actions(idHash: string, since: number, limit: number) {
    const r = await this.pool.query<{ seq: string; box: string; posted_at: string }>(
      "SELECT seq, box, posted_at FROM relay_actions WHERE id_hash = $1 AND posted_at > $2 ORDER BY seq LIMIT $3",
      [idHash, since, limit],
    );
    return r.rows.map((a) => ({ seq: Number(a.seq), box: a.box, postedAt: Number(a.posted_at) }));
  }
  async ack(idHash: string, seq: number) {
    await this.pool.query("DELETE FROM relay_actions WHERE id_hash = $1 AND seq <= $2", [idHash, seq]);
  }
  async delete(idHash: string) {
    // Its actions go with it (ON DELETE CASCADE).
    await this.pool.query("DELETE FROM relay_pairings WHERE id_hash = $1", [idHash]);
  }
  async sweep(now: number, actionsBefore: number) {
    await this.pool.query("DELETE FROM relay_pairings WHERE expires_at <= $1", [now]);
    await this.pool.query("DELETE FROM relay_actions WHERE posted_at <= $1", [actionsBefore]);
  }
}
