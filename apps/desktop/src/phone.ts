import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  deriveSession,
  newPairing,
  openHello,
  pairingIdText,
  pairingUrl,
  pollHello,
  relayTokenHash,
  sealSnapshot,
  type ActionResult,
  type Pairing,
  type RelayActionBox,
  type RelayKeys,
  type RelaySession,
  type Snapshot,
} from "@aftercall/core";
import { BACKEND_URL, HAS_BACKEND } from "./backend";
import { WEB_URL } from "./near";
import { isDesktop } from "./recorder";
import { toast } from "./ui";

/**
 * The Mac's side of the phone relay (docs/design/phone-protocol.md): pairing, the relay
 * calls, and the paired phone's state. The relay only ever sees opaque boxes and token
 * hashes. The secrets live in the Keychain (src-tauri/src/phone.rs); this module holds
 * them in memory while the app runs, because the relay's cryptography is
 * packages/core/src/relay. Nothing here touches localStorage.
 */

/** The phone page the QR code opens (apps/web/app/phone). */
export const PHONE_PAGE = `${WEB_URL}/phone`;
/** Pairing needs the backend's relay; a build without one hides "Your phone". */
export const CAN_PAIR = isDesktop && HAS_BACKEND;

/** phone.json, as src-tauri/src/phone.rs keeps it. */
export interface PhoneState {
  pairingId: string;
  backend: string;
  device: string;
  phonePublicKey: string;
  pairedAt: number;
  macN: number;
  lastActionN: number;
  ackedSeq: number;
  results: ActionResult[];
}

interface PhoneSecrets {
  macSecretKey: string;
  macToken: string;
  sessionKey: string;
}

/** A relay answer that wasn't ok: the HTTP status (0 when unreachable) and the relay's code. */
export class RelayHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A relay failure while pairing, in plain words rather than the relay's code. */
export function pairingProblem(e: unknown): string {
  if (!(e instanceof RelayHttpError)) return e instanceof Error ? e.message : String(e);
  if (e.status === 0) return e.message;
  if (e.status === 404 || e.status === 401) return "The relay no longer knows this code. Make a new one.";
  if (e.status === 429) return "Too many pairing codes from this network today. Try again tomorrow.";
  return `Aftercall's relay refused it (${e.message}). Make a new code, or try again later.`;
}

/** The pairing is gone on the relay: unpaired from the phone, or expired. */
const isGone = (e: unknown) => e instanceof RelayHttpError && (e.status === 401 || e.status === 404);

/** No answer from the relay, or a server error: worth asking again. Anything else is the relay's answer. */
const isTransient = (e: unknown) => e instanceof RelayHttpError && (e.status === 0 || e.status >= 500);

async function relay<T>(backend: string, path: string, opts: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${backend}${path}`, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }).catch(() => {
    throw new RelayHttpError(0, `Can't reach the relay at ${backend}.`);
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new RelayHttpError(res.status, String(body.message ?? `Relay ${res.status}`));
  return body as T;
}

// ---------- the paired phone, as a store ----------

export interface PhoneStatus {
  loaded: boolean;
  paired: PhoneState | null;
  /** Why the last relay call failed, until one works again. */
  problem?: string;
}

let status: PhoneStatus = { loaded: !CAN_PAIR, paired: null };
let secrets: { key: Uint8Array; macToken: string } | null = null;
const listeners = new Set<() => void>();

function setStatus(next: PhoneStatus) {
  status = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const phoneStatus = () => status;
export const usePhone = (): PhoneStatus => useSyncExternalStore(subscribe, phoneStatus, phoneStatus);

/** The session key while a phone is paired, for opening its actions. */
export const sessionKey = () => secrets?.key ?? null;

let loading: Promise<void> | null = null;

/** Reads the paired phone from phone.json and the Keychain, once per launch. */
export function loadPhone(): Promise<void> {
  if (!CAN_PAIR) return Promise.resolve();
  loading ??= invoke<{ state: PhoneState; secrets: PhoneSecrets } | null>("phone_load")
    .then((p) => {
      secrets = p ? { key: base64UrlToBytes(p.secrets.sessionKey), macToken: p.secrets.macToken } : null;
      setStatus({ loaded: true, paired: p?.state ?? null });
    })
    .catch((e) => setStatus({ loaded: true, paired: null, problem: e instanceof Error ? e.message : String(e) }));
  return loading;
}

/**
 * One relay job at a time: snapshots, actions and acknowledgements each move a counter,
 * and phone.json refuses a counter that goes back.
 */
let chain: Promise<unknown> = Promise.resolve();
export function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job);
  chain = run.catch(() => {});
  return run;
}

/** Saves a change to the paired phone's state (counters, results) and shows it. */
async function updateState(change: (s: PhoneState) => PhoneState): Promise<PhoneState | null> {
  const s = status.paired;
  if (!s) return null;
  const next = change(s);
  await invoke("phone_save", { state: next });
  setStatus({ ...status, paired: next });
  return next;
}

/** Forgets the phone on this Mac only. */
async function forgetHere() {
  secrets = null;
  await invoke("phone_forget").catch(() => {});
  setStatus({ loaded: true, paired: null });
}

/** A call the Mac makes with its token. A pairing gone on the relay is forgotten here too, and said once. */
async function macCall<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const s = status.paired;
  if (!s || !secrets) throw new RelayHttpError(404, "NO_PAIRING");
  try {
    const out = await relay<T>(s.backend, `/relay/pairings/${s.pairingId}${path}`, { ...opts, token: secrets.macToken });
    if (status.problem) setStatus({ ...status, problem: undefined });
    return out;
  } catch (e) {
    if (isGone(e)) {
      await forgetHere();
      toast({ text: "Your phone isn't paired any more. Pair it again in Settings.", tone: "caution" });
    } else if (e instanceof RelayHttpError && e.status === 0 && status.problem !== e.message) {
      setStatus({ ...status, problem: e.message });
    }
    throw e;
  }
}

// ---------- pairing ----------

/** A pairing waiting for the phone: what the QR code shows, and what only the Mac keeps. */
export interface PendingPairing {
  pairing: Pairing;
  mac: RelayKeys;
  macToken: string;
  /** What the QR code encodes. */
  url: string;
  expiresAt: number;
}

export interface PhoneHello {
  session: RelaySession;
  device: string;
  phonePublicKey: Uint8Array;
}

/**
 * Starts a pairing: new keys, registered on the relay by their hashes. One phone per Mac,
 * so a phone already paired is unpaired first.
 */
export async function startPairing(): Promise<PendingPairing> {
  if (status.paired) await unpair();
  const { pairing, mac, macToken } = newPairing(BACKEND_URL);
  const { expiresAt } = await relay<{ expiresAt: number }>(pairing.backend, "/relay/pairings", {
    method: "POST",
    body: { id: pairingIdText(pairing), macTokenHash: relayTokenHash(macToken) },
  });
  return { pairing, mac, macToken, url: pairingUrl(PHONE_PAGE, pairing), expiresAt };
}

/**
 * Waits for the phone's hello: asks every 2 s (`HELLO_POLL_MS`) until it comes, the pairing
 * expires (null) or `signal` aborts (null). A lost connection or a server error is asked
 * again at the next interval (`onReach` says when the relay can't be reached); the relay
 * saying the pairing is gone ends it. A hello that doesn't open is someone else's: the
 * relay keeps only the first, so this pairing can't be finished and the error says to
 * start again.
 */
export async function waitForHello(p: PendingPairing, signal: AbortSignal, onReach?: (reached: boolean) => void): Promise<PhoneHello | null> {
  const path = `/relay/pairings/${pairingIdText(p.pairing)}/hello`;
  const box = await pollHello({
    ask: () => relay<{ box: string | null }>(p.pairing.backend, path, { token: p.macToken }).then((r) => r.box),
    until: p.expiresAt,
    signal,
    transient: isTransient,
    onReach,
  });
  if (!box) return null;
  let hello: { phonePublicKey: Uint8Array; device: string };
  try {
    hello = openHello(p.pairing.pairingId, p.mac.secretKey, box);
  } catch {
    throw new Error("Something other than your phone answered this code. Cancel and pair again.");
  }
  const session = deriveSession({
    pairingId: p.pairing.pairingId,
    macPublicKey: p.pairing.macPublicKey,
    phonePublicKey: hello.phonePublicKey,
    ourSecretKey: p.mac.secretKey,
    theirPublicKey: hello.phonePublicKey,
  });
  return { session, device: hello.device, phonePublicKey: hello.phonePublicKey };
}

/**
 * You pressed They match: the relay learns the phone token's hash and the pairing goes
 * active; the secrets go to the Keychain and the rest to phone.json. The first snapshot
 * follows from the sync loop, which starts once `paired` is set.
 */
export async function confirmPairing(p: PendingPairing, hello: PhoneHello): Promise<void> {
  const id = pairingIdText(p.pairing);
  await relay(p.pairing.backend, `/relay/pairings/${id}/confirm`, { method: "POST", token: p.macToken, body: { phoneTokenHash: relayTokenHash(hello.session.phoneToken) } });
  const state: PhoneState = {
    pairingId: id,
    backend: p.pairing.backend,
    device: hello.device.slice(0, 40),
    phonePublicKey: bytesToBase64Url(hello.phonePublicKey),
    pairedAt: Date.now(),
    macN: 0,
    lastActionN: 0,
    ackedSeq: 0,
    results: [],
  };
  const kept: PhoneSecrets = { macSecretKey: bytesToBase64Url(p.mac.secretKey), macToken: p.macToken, sessionKey: bytesToBase64Url(hello.session.key) };
  await invoke("phone_pair", { state, secrets: kept });
  secrets = { key: hello.session.key, macToken: p.macToken };
  setStatus({ loaded: true, paired: state });
}

/** Cancel, or closing the sheet: the relay forgets the pairing now rather than in 10 minutes. */
export function cancelPairing(p: PendingPairing): void {
  relay(p.pairing.backend, `/relay/pairings/${pairingIdText(p.pairing)}`, { method: "DELETE", token: p.macToken }).catch(() => {});
}

/**
 * Unpairs: the relay deletes the pairing, its snapshot and its actions, then this Mac
 * forgets the keys. If the relay can't be reached the Mac forgets anyway; the relay
 * drops the pairing 30 days after it last heard from this Mac. False in that case.
 */
export async function unpair(): Promise<boolean> {
  const s = status.paired;
  let reached = true;
  if (s && secrets) {
    await relay(s.backend, `/relay/pairings/${s.pairingId}`, { method: "DELETE", token: secrets.macToken }).catch((e) => {
      reached = isGone(e);
    });
  }
  await forgetHere();
  return reached;
}

// ---------- the sync loop's relay calls ----------

/** Seals a snapshot with the next counter, saved before it's posted, and posts it. */
export async function postSnapshot(snapshot: Snapshot): Promise<void> {
  const key = secrets?.key;
  const next = key && (await updateState((s) => ({ ...s, macN: s.macN + 1 })));
  if (!key || !next) return;
  await macCall("/snapshot", { method: "POST", body: { box: sealSnapshot(key, next.macN, snapshot) } });
}

/** The phone's waiting actions, oldest first. */
export const fetchActions = () => macCall<{ actions: RelayActionBox[] }>("/actions").then((r) => r.actions);

/** Tells the relay it may delete the actions up to `seq`. */
export async function ackActions(seq: number): Promise<void> {
  await macCall("/ack", { method: "POST", body: { seq } });
  await updateState((s) => ({ ...s, ackedSeq: Math.max(s.ackedSeq, seq) }));
}

/** Keeps a newly accepted action counter and its result. */
export const saveActionResult = (lastActionN: number, results: (old: ActionResult[]) => ActionResult[]) =>
  updateState((s) => ({ ...s, lastActionN, results: results(s.results) }));
