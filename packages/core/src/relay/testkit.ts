/**
 * Test doubles for the phone relay: an in-memory relay that answers the routes in
 * docs/design/phone-protocol.md (section 4) as `fetch` would, and a Mac that pairs and
 * posts snapshots through it with the real cryptography. Used by the tests and by the
 * phone page's local development script (apps/web/scripts/phone-dev.ts); the real relay
 * is apps/backend/src/relay.
 */
import { RELAY_BOX_LIMITS, deriveSession, newPairing, openHello, pairingIdText, pairingUrl, relayTokenHash, type RelaySession } from "./crypto.ts";
import { openAction, sealSnapshot, type PhoneAction, type Snapshot } from "./messages.ts";

interface FakePairing {
  macTokenHash: string;
  phoneTokenHash: string | null;
  hello: string | null;
  state: "waiting" | "active";
  macSeenAt: number;
  snapshot: string | null;
  version: number;
  snapshotAt: number | null;
}

const MAX_WAITING_ACTIONS = 50;

/** An in-memory relay. `fetch` takes the same URLs and answers the same codes as the real one. */
export function fakeRelay(now: () => number = Date.now) {
  const pairings = new Map<string, FakePairing>();
  const actions: { seq: number; id: string; box: string; postedAt: number }[] = [];
  let seq = 0;
  /** Requests seen, as "METHOD /path", for tests that check what was asked. */
  const log: string[] = [];

  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const err = (status: number, code: string) => json(status, { statusCode: status, message: code });

  async function fetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    log.push(`${method} ${url.pathname}`);
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const headers = new Headers(init.headers);
    const token = /^Bearer (.+)$/.exec(headers.get("authorization") ?? "")?.[1] ?? null;
    const hash = token ? relayTokenHash(token) : null;

    const m = /^\/relay\/pairings(?:\/([^/]+)(?:\/([a-z]+))?)?$/.exec(url.pathname);
    if (!m) return err(404, "NOT_FOUND");
    const [, id, verb] = m;
    if (!id) {
      if (method !== "POST") return err(405, "METHOD");
      const pid = String(body.id ?? "");
      if (pairings.has(pid)) return err(409, "PAIRING_EXISTS");
      pairings.set(pid, { macTokenHash: String(body.macTokenHash), phoneTokenHash: null, hello: null, state: "waiting", macSeenAt: now(), snapshot: null, version: 0, snapshotAt: null });
      return json(201, { expiresAt: now() + 600_000 });
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(id)) return err(400, "BAD_PAIRING");
    const p = pairings.get(id);
    if (!p) return err(404, "NO_PAIRING");
    const isMac = hash !== null && hash === p.macTokenHash;
    const isPhone = hash !== null && p.phoneTokenHash !== null && hash === p.phoneTokenHash;
    if (isMac) p.macSeenAt = now();
    const box = typeof body.box === "string" ? body.box : "";

    if (!verb && method === "DELETE") {
      if (!isMac && !isPhone) return err(401, "BAD_TOKEN");
      pairings.delete(id);
      for (let i = actions.length - 1; i >= 0; i--) if (actions[i].id === id) actions.splice(i, 1);
      return json(200, { ok: true });
    }
    if (verb === "hello" && method === "POST") {
      if (box.length > RELAY_BOX_LIMITS.hello) return err(413, "TOO_LARGE");
      if (p.hello !== null || p.state === "active") return err(409, "HELLO_TAKEN");
      p.hello = box;
      return json(200, { ok: true });
    }
    if (verb === "hello" && method === "GET") return isMac ? json(200, { box: p.hello }) : err(401, "BAD_TOKEN");
    if (verb === "confirm" && method === "POST") {
      if (!isMac) return err(401, "BAD_TOKEN");
      if (p.hello === null) return err(409, "NO_HELLO");
      p.phoneTokenHash = String(body.phoneTokenHash);
      p.hello = null;
      p.state = "active";
      return json(200, { ok: true });
    }
    if (verb === "snapshot" && method === "POST") {
      if (!isMac) return err(401, "BAD_TOKEN");
      if (p.state !== "active") return err(409, "NOT_CONFIRMED");
      if (box.length > RELAY_BOX_LIMITS.snapshot) return err(413, "TOO_LARGE");
      p.snapshot = box;
      p.version += 1;
      p.snapshotAt = now();
      return json(200, { version: p.version });
    }
    if (verb === "snapshot" && method === "GET") {
      if (p.state !== "active") return err(409, "NOT_CONFIRMED");
      if (!isPhone) return err(401, "BAD_TOKEN");
      const after = Number(url.searchParams.get("after") ?? 0);
      return json(200, { now: now(), version: p.version, postedAt: p.snapshotAt, macSeenAt: p.macSeenAt, ...(p.snapshot && p.version > after ? { box: p.snapshot } : {}) });
    }
    if (verb === "actions" && method === "POST") {
      if (!isPhone) return err(401, "BAD_TOKEN");
      if (box.length > RELAY_BOX_LIMITS.action) return err(413, "TOO_LARGE");
      if (actions.filter((a) => a.id === id).length >= MAX_WAITING_ACTIONS) return err(429, "TOO_MANY_ACTIONS");
      actions.push({ seq: ++seq, id, box, postedAt: now() });
      return json(200, { seq });
    }
    if (verb === "actions" && method === "GET") {
      if (!isMac) return err(401, "BAD_TOKEN");
      return json(200, { actions: actions.filter((a) => a.id === id).map(({ seq, box, postedAt }) => ({ seq, box, postedAt })) });
    }
    if (verb === "ack" && method === "POST") {
      if (!isMac) return err(401, "BAD_TOKEN");
      for (let i = actions.length - 1; i >= 0; i--) if (actions[i].id === id && actions[i].seq <= Number(body.seq)) actions.splice(i, 1);
      return json(200, { ok: true });
    }
    return err(405, "METHOD");
  }

  return { fetch, pairings, actions, log };
}

/**
 * A Mac that pairs through a relay, with the real cryptography: `start` registers a
 * pairing and gives the QR's link; `takeHello` opens the phone's hello and works out the
 * code; `confirm` is They match; `post` seals and posts a snapshot; `collect` opens and
 * acknowledges the phone's actions.
 */
export async function fakeMac(fetchFn: (url: string, init?: RequestInit) => Promise<Response>, backend: string, phonePage = "http://localhost:3000/phone") {
  const { pairing, mac, macToken } = newPairing(backend);
  const id = pairingIdText(pairing);
  const base = `${pairing.backend}/relay/pairings/${id}`;
  const auth = { authorization: `Bearer ${macToken}`, "content-type": "application/json" };
  const call = async (path: string, method: string, body?: unknown) => {
    const res = await fetchFn(`${base}${path}`, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });
    const out = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(String(out.message ?? res.status));
    return out;
  };
  const created = await fetchFn(`${pairing.backend}/relay/pairings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, macTokenHash: relayTokenHash(macToken) }) });
  if (!created.ok) throw new Error(`pairing: ${created.status}`);

  let session: RelaySession | null = null;
  let device = "";
  let snapshotN = 0;
  let actionN = 0;

  return {
    id,
    url: pairingUrl(phonePage, pairing),
    get session() {
      return session;
    },
    get device() {
      return device;
    },
    /** The phone's code once its hello is in, else null. */
    async takeHello(): Promise<string | null> {
      const { box } = (await call("/hello", "GET")) as { box: string | null };
      if (!box) return null;
      const hello = openHello(pairing.pairingId, mac.secretKey, box);
      device = hello.device;
      session = deriveSession({ pairingId: pairing.pairingId, macPublicKey: mac.publicKey, phonePublicKey: hello.phonePublicKey, ourSecretKey: mac.secretKey, theirPublicKey: hello.phonePublicKey });
      return session.code;
    },
    async confirm() {
      if (!session) throw new Error("no hello yet");
      await call("/confirm", "POST", { phoneTokenHash: relayTokenHash(session.phoneToken) });
    },
    async post(snapshot: Snapshot): Promise<number> {
      if (!session) throw new Error("no session");
      const { version } = await call("/snapshot", "POST", { box: sealSnapshot(session.key, ++snapshotN, snapshot) });
      return Number(version);
    },
    /** Opens waiting actions in order and acknowledges them. Ones that don't open are skipped, as the Mac does. */
    async collect(): Promise<{ n: number; action: PhoneAction }[]> {
      if (!session) throw new Error("no session");
      const { actions } = (await call("/actions", "GET")) as { actions: { seq: number; box: string }[] };
      const out: { n: number; action: PhoneAction }[] = [];
      for (const a of actions) {
        try {
          const opened = openAction(session.key, actionN, a.box);
          actionN = opened.n;
          out.push(opened);
        } catch {
          // skipped, as on the Mac: nothing runs
        }
      }
      if (actions.length) await call("/ack", "POST", { seq: actions[actions.length - 1].seq });
      return out;
    },
    async unpair() {
      await call("", "DELETE");
    },
    /** Raw access for tests that post something odd. */
    async postBox(box: string) {
      return call("/snapshot", "POST", { box });
    },
  };
}
