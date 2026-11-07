import { z } from "zod";
import { formatUsdc } from "../money.ts";
import { CHAIN_NAME } from "../intents/oneclick.ts";
import { RelayError, base64UrlToBytes, bytesToBase64Url, decodePairing, deriveSession, newRelayKeys, pairingIdText, sealHello, type RelayErrorCode } from "./crypto.ts";
import { ACTION_TTL_MS, MAC_OFFLINE_AFTER_MS, itemDigest, openSnapshot, sealAction, type ActionResult, type PendingItem, type PhoneAction, type Snapshot } from "./messages.ts";

/**
 * The phone page's side of the relay (docs/design/phone-protocol.md, section 6): the
 * one record it keeps, the calls it makes to the relay, and what it shows for each item.
 * The page (apps/web/app/phone) only stores this record and draws it; every decision is
 * here, so it's tested without a browser.
 */

/** A tap the phone sent, kept until the Mac's snapshot says what became of it. */
export interface SentAction {
  n: number;
  kind: PhoneAction["kind"];
  meetingId: string;
  followUpId: string;
  at: number;
}

/**
 * Everything the phone keeps, as one IndexedDB record of plain values (keys as base64url).
 * Unpairing deletes it.
 */
export interface PhonePairing {
  v: 1;
  /** The pairing id's text, as in relay paths (43 base64url characters). */
  id: string;
  /** The relay's origin, from the QR code. */
  backend: string;
  macPublicKey: string;
  phonePublicKey: string;
  phoneSecretKey: string;
  /** The session's envelope key. */
  key: string;
  /** The phone's bearer token on the relay. */
  phoneToken: string;
  /** Six digits, shown until the Mac says they match. */
  code: string;
  /** The sealed hello, kept until pairing ends so a lost answer is retried with the same box. */
  hello: string;
  /**
   * "hello": not posted yet. "confirming": posted, waiting for They match on the Mac.
   * "paired": a snapshot opened with the session key, so the Mac behind the QR sealed it.
   */
  state: "hello" | "confirming" | "paired";
  /** Times the hello was posted without an answer we saw. */
  helloTries: number;
  createdAt: number;
  pairedAt?: number;
  /** The counter of the last action sealed (0 before the first). */
  actionN: number;
  /** The highest snapshot counter accepted, and the relay version it came with. */
  snapshotN: number;
  version: number;
  /** The last snapshot that opened, so the inbox shows at once and while offline. */
  snapshot?: Snapshot;
  /** Recent taps, newest first. */
  sent: SentAction[];
}

const SENT_KEPT = 20;

/** "418 207" */
export const groupCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

/** A short label for the Mac's settings: "iPhone · Safari". */
export function deviceLabel(userAgent: string): string {
  const ua = userAgent;
  const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh|Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Phone";
  const browser = /EdgiOS|EdgA|Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /FxiOS|Firefox\//.test(ua)
        ? "Firefox"
        : /CriOS|Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  return `${device} · ${browser}`;
}

/**
 * Starts pairing from the QR's link: reads `#pair=…`, makes this phone's key pair, seals
 * the hello and works out the session. Nothing is sent yet. Throws `RelayError`
 * (`BAD_PAIRING`, `BAD_VERSION`, `BAD_KEY`) for a damaged or foreign link.
 */
export function startPhonePairing(fragment: string, device: string, now: number, secretKey?: Uint8Array): PhonePairing {
  const pairing = decodePairing(fragment);
  const phone = newRelayKeys(secretKey);
  const session = deriveSession({
    pairingId: pairing.pairingId,
    macPublicKey: pairing.macPublicKey,
    phonePublicKey: phone.publicKey,
    ourSecretKey: phone.secretKey,
    theirPublicKey: pairing.macPublicKey,
  });
  return {
    v: 1,
    id: pairingIdText(pairing),
    backend: pairing.backend,
    macPublicKey: bytesToBase64Url(pairing.macPublicKey),
    phonePublicKey: bytesToBase64Url(phone.publicKey),
    phoneSecretKey: bytesToBase64Url(phone.secretKey),
    key: bytesToBase64Url(session.key),
    phoneToken: session.phoneToken,
    code: session.code,
    hello: sealHello(pairing, phone.publicKey, device),
    state: "hello",
    helloTries: 0,
    createdAt: now,
    actionN: 0,
    snapshotN: 0,
    version: 0,
    sent: [],
  };
}

/** Whether a stored value is a pairing this version of the page can use. */
export function isPhonePairing(x: unknown): x is PhonePairing {
  const p = x as PhonePairing | null;
  return !!p && p.v === 1 && typeof p.id === "string" && p.id.length === 43 && typeof p.key === "string" && typeof p.phoneToken === "string" && typeof p.backend === "string" && Array.isArray(p.sent);
}

// ---------- the relay, as the phone calls it ----------

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** An answer from the relay the phone didn't expect. `code` is the relay's (e.g. "TOO_LARGE") or the HTTP status. */
export class RelayHttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`Relay ${status} ${code}`);
    this.name = "RelayHttpError";
    this.status = status;
    this.code = code;
  }
}

const Time = z.number().int().nonnegative();
/** `GET …/snapshot`: the relay's clock, the snapshot's version, when the Mac last called, and the box when it's newer than `after`. */
export const SnapshotReplySchema = z.object({ now: Time, version: z.number().int().nonnegative(), postedAt: Time.nullable().optional(), macSeenAt: Time, box: z.string().optional() });
export type SnapshotReply = z.infer<typeof SnapshotReplySchema>;

export type HelloAnswer = "ok" | "taken" | "gone";
export type SnapshotPoll = { kind: "waiting" } | { kind: "gone" } | { kind: "reply"; reply: SnapshotReply };
export type ActionAnswer = { kind: "ok"; seq: number } | { kind: "gone" } | { kind: "full" };

/** A request gives up after this long; the next poll tries again. */
const TIMEOUT_MS = 15_000;

/**
 * The phone's four calls to the relay. Answers the page acts on come back as values;
 * anything else throws `RelayHttpError`, and a network failure throws as `fetch` does.
 */
export function phoneRelay(p: Pick<PhonePairing, "backend" | "id" | "phoneToken">, fetchFn: FetchLike = (u, i) => fetch(u, i)) {
  const base = `${p.backend}/relay/pairings/${p.id}`;
  async function call(path: string, init: { method: "GET" | "POST" | "DELETE"; body?: unknown; auth: boolean }): Promise<{ status: number; body: Record<string, unknown> | null }> {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.auth) headers.authorization = `Bearer ${p.phoneToken}`;
    const res = await fetchFn(`${base}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
    });
    let body: Record<string, unknown> | null = null;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }
  const codeOf = (r: { status: number; body: Record<string, unknown> | null }) => (typeof r.body?.message === "string" ? r.body.message : String(r.status));
  const fail = (r: { status: number; body: Record<string, unknown> | null }): never => {
    throw new RelayHttpError(r.status, codeOf(r));
  };
  const gone = (r: { status: number }) => r.status === 401 || r.status === 404;

  return {
    /** Posts the sealed hello. "taken": the relay already holds a hello for this pairing. "gone": no such pairing (cancelled or expired). */
    async hello(box: string): Promise<HelloAnswer> {
      const r = await call("/hello", { method: "POST", body: { box }, auth: false });
      if (r.status >= 200 && r.status < 300) return "ok";
      if (r.status === 409) return "taken";
      if (r.status === 404) return "gone";
      return fail(r);
    },
    /** Asks for a snapshot newer than `after`. "waiting": the Mac hasn't said the codes match yet. "gone": unpaired or expired. */
    async snapshot(after: number): Promise<SnapshotPoll> {
      const r = await call(`/snapshot?after=${after}`, { method: "GET", auth: true });
      if (r.status === 409) return { kind: "waiting" };
      if (gone(r)) return { kind: "gone" };
      if (r.status !== 200) return fail(r);
      const parsed = SnapshotReplySchema.safeParse(r.body);
      if (!parsed.success) throw new RelayHttpError(r.status, "BAD_REPLY");
      return { kind: "reply", reply: parsed.data };
    },
    /** Posts one sealed action. "full": 50 actions already wait for the Mac. */
    async action(box: string): Promise<ActionAnswer> {
      const r = await call("/actions", { method: "POST", body: { box }, auth: true });
      if (gone(r)) return { kind: "gone" };
      if (r.status === 429) return { kind: "full" };
      if (r.status < 200 || r.status >= 300) return fail(r);
      return { kind: "ok", seq: typeof r.body?.seq === "number" ? r.body.seq : 0 };
    },
    /** Deletes the pairing on the relay. Already gone counts as done. */
    async unpair(): Promise<void> {
      const r = await call("", { method: "DELETE", auth: true });
      if (r.status >= 200 && r.status < 300) return;
      if (gone(r)) return;
      fail(r);
    },
  };
}

// ---------- pairing steps ----------

/** Counts a hello post. The page saves this before posting, so a try whose answer never arrived (page closed, network gone) is remembered. */
export const helloAttempt = (p: PhonePairing): PhonePairing => ({ ...p, helloTries: p.helloTries + 1 });

/**
 * What to do with the relay's answer to the hello (after `helloAttempt`). "taken" on the
 * first try means someone else posted a hello with this QR first. "taken" on a later try
 * is most likely our own earlier hello, so the phone shows its code: if the Mac shows
 * another, you press Cancel there, as for any other mismatch.
 */
export function afterHello(p: PhonePairing, answer: HelloAnswer): { pairing: PhonePairing } | { problem: "taken" | "gone" } {
  if (answer === "ok" || (answer === "taken" && p.helloTries > 1)) return { pairing: { ...p, state: "confirming" } };
  return { problem: answer };
}

export type SnapshotStep = { kind: "unchanged" } | { kind: "opened"; pairing: PhonePairing } | { kind: "unreadable"; code: RelayErrorCode };

/**
 * Takes a snapshot reply. A new box opens with the session key and the last accepted
 * counter; if it doesn't, the page keeps the last good snapshot and says it couldn't read
 * the update. The first snapshot that opens completes pairing.
 */
export function takeSnapshot(p: PhonePairing, reply: SnapshotReply, now: number): SnapshotStep {
  if (!reply.box || reply.version <= p.version) return { kind: "unchanged" };
  try {
    const { n, snapshot } = openSnapshot(base64UrlToBytes(p.key), p.snapshotN, reply.box);
    const sent = p.sent.filter((s) => now - s.at < ACTION_TTL_MS);
    return { kind: "opened", pairing: { ...p, state: "paired", pairedAt: p.pairedAt ?? now, snapshotN: n, version: reply.version, snapshot, sent } };
  } catch (e) {
    return { kind: "unreadable", code: e instanceof RelayError ? e.code : "BAD_BOX" };
  }
}

/** When the relay last heard from the Mac, if that's long enough ago to call it offline (on the relay's clock). */
export const macOfflineSince = (reply: Pick<SnapshotReply, "now" | "macSeenAt">): number | null => (reply.now - reply.macSeenAt > MAC_OFFLINE_AFTER_MS ? reply.macSeenAt : null);

// ---------- items and taps ----------

/** One item's address in the inbox. */
export const itemKey = (i: Pick<PendingItem, "meetingId" | "followUpId">) => `${i.meetingId}/${i.followUpId}`;

/** "Pay Kemi", "Recap to Ada". */
export const itemTitle = (i: PendingItem) => (i.kind === "payment" ? `Pay ${i.payeeName}` : `Recap to ${i.toName || i.to || "the group"}`);

/** "20.00 USDC", or null when the words didn't read as an amount. */
export const itemAmount = (i: PendingItem) => (i.kind === "payment" && i.amount !== null ? `${formatUsdc(BigInt(i.amount))} USDC` : null);

/** "USDC on Solana via NEAR Intents · Kemi gets 19.75", or "USDC on NEAR". */
export function routeText(i: PendingItem): string | null {
  if (i.kind !== "payment") return null;
  if (!i.route) return "USDC on NEAR";
  const gets = i.route.quotedOut ? ` · ${i.payeeName} gets about ${formatUsdc(BigInt(i.route.quotedOut))}` : "";
  return `USDC on ${CHAIN_NAME[i.route.chain]} via NEAR Intents${gets}`;
}

/** What the phone offers on an item, and in plain words why it doesn't offer Approve. */
export interface PhoneChoices {
  approve: boolean;
  /** "Try again" after a failed send. */
  approveLabel: "Approve" | "Try again";
  dismiss: boolean;
  /** Undo for an autopilot countdown. */
  undoAutopilot: boolean;
  /** Held for your NEAR wallet: Approve in wallet and Decline. */
  wallet: boolean;
  why?: string;
}

/**
 * The phone offers only what the Mac would run (`checkPhoneAction`): nothing on an item
 * already on its way, the wallet for a held payment, and no Approve for a recap with no
 * address, a payee not on your list or an amount that didn't read.
 */
export function phoneChoices(i: PendingItem): PhoneChoices {
  const none = { approve: false, approveLabel: "Approve" as const, dismiss: false, undoAutopilot: false, wallet: false };
  if (i.status === "sending") return { ...none, why: i.kind === "email" ? "Sending now." : "Paying now." };
  if (i.status === "blocked") return { ...none, wallet: true, why: "Over your caps. Only your NEAR wallet can approve it. The app's key can't." };
  const base = { ...none, dismiss: true, undoAutopilot: !!i.autopilotAt, approveLabel: i.error ? ("Try again" as const) : ("Approve" as const) };
  if (i.kind === "email" && !i.to) return { ...base, why: "No email address yet. Add one on your Mac." };
  if (i.kind === "payment" && !i.payeeListed) return { ...base, why: "Payee isn't on your list. Add them on your Mac, or send a claim link there." };
  if (i.kind === "payment" && i.amount === null) return { ...base, why: "The amount didn't read clearly. Set it on your Mac." };
  return { ...base, approve: true };
}

/**
 * Seals one tap with the next counter and records it as sent. The page saves the
 * returned pairing before it posts the box, so a counter is never used twice.
 */
export function phoneAction(p: PhonePairing, kind: PhoneAction["kind"], item: PendingItem, now: number): { pairing: PhonePairing; box: string; n: number } {
  const n = p.actionN + 1;
  const action: PhoneAction = { t: "action", kind, meetingId: item.meetingId, followUpId: item.followUpId, digest: itemDigest(item), at: now };
  const box = sealAction(base64UrlToBytes(p.key), n, action);
  const sent = [{ n, kind, meetingId: item.meetingId, followUpId: item.followUpId, at: now }, ...p.sent].slice(0, SENT_KEPT);
  return { pairing: { ...p, actionN: n, sent }, box, n };
}

/** Forgets a tap the relay never took (offline, refused), so its card doesn't say "Sent". The counter stays used. */
export const forgetTap = (p: PhonePairing, n: number): PhonePairing => ({ ...p, sent: p.sent.filter((s) => s.n !== n) });

export type TapState = { sent: SentAction; result: ActionResult | null };

/** The latest tap on an item and, once a snapshot carries it, what the Mac did with it. */
export function tapState(p: Pick<PhonePairing, "sent" | "snapshot">, i: Pick<PendingItem, "meetingId" | "followUpId">): TapState | null {
  const sent = p.sent.find((s) => s.meetingId === i.meetingId && s.followUpId === i.followUpId);
  if (!sent) return null;
  return { sent, result: p.snapshot?.results.find((r) => r.n === sent.n) ?? null };
}

/** What the card says about a tap: "Sent to your Mac", then the Mac's outcome. */
export function tapText(t: TapState, macOffline: boolean): string {
  if (t.result?.outcome === "refused") return `Your Mac didn't do it: ${t.result.reason ?? "it changed there."}`;
  if (t.result?.outcome === "accepted") return t.sent.kind === "approve" ? "Your Mac is doing it now." : t.sent.kind === "dismiss" ? "Dismissed on your Mac." : "Autopilot stopped on your Mac.";
  return macOffline ? "Sent. Your Mac will act on this when it's back online." : "Sent to your Mac.";
}

/** "0:42" */
export function countdownText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
