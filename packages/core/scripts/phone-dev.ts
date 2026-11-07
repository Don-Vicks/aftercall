/**
 * The phone page without a Mac or a backend, for development: an in-memory relay on
 * http://localhost:3102 (the routes in docs/design/phone-protocol.md) and a made-up Mac
 * that pairs with the page, posts sealed snapshots of a few follow-ups, and does what
 * the phone taps. It confirms the code on its own, as if you pressed They match.
 *
 *   pnpm dev:phone                          # then open the printed link on the phone or in a browser
 *   pnpm dev:web                            # the web app on :3000, in another terminal
 *   pnpm dev:phone -- --confirm-after 20    # the code stays on screen 20 s before the Mac confirms it
 *   pnpm dev:phone -- --offline-after 20    # the Mac stops calling after 20 s: the page says it's offline
 *   pnpm dev:phone -- --port 3211 --web http://localhost:3210   # other ports
 *
 * Nothing leaves this machine. The real relay is apps/backend/src/relay.
 */
import { createServer } from "node:http";
import type { EmailFollowUp, FollowUp, Meeting, PaymentFollowUp } from "../src/meeting.ts";
import { encodeSignRequest } from "../src/wallet/actions.ts";
import { checkPhoneAction, fitSnapshot, toDoneItem, toPendingItem, type ActionResult, type ItemOptions, type Snapshot } from "../src/relay/messages.ts";
import { fakeMac, fakeRelay } from "../src/relay/testkit.ts";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg("port", "3102"));
const WEB = arg("web", "http://localhost:3000");
const OFFLINE_AFTER_S = Number(arg("offline-after", "0"));
const CONFIRM_AFTER_S = Number(arg("confirm-after", "0"));
const BACKEND = `http://localhost:${PORT}`;
const TICK_MS = 2_000;

const relay = fakeRelay();
const server = createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", WEB);
  res.setHeader("access-control-allow-methods", "GET, POST, DELETE");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  if (req.method === "OPTIONS") return void res.writeHead(204).end();
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
  const answer = await relay.fetch(`${BACKEND}${req.url}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined });
  res.writeHead(answer.status, { "content-type": "application/json" }).end(await answer.text());
  console.log(`relay ${req.method} ${req.url?.replace(/pairings\/[^/?]+/, "pairings/…")} → ${answer.status}`);
});
await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));

// ---------- a made-up Mac with a meeting's follow-ups ----------

const now = Date.now();
const meeting: Meeting = {
  id: String(Math.floor(now / 1000) - 3600),
  project: "Studio",
  title: "Sync with Ada",
  startedAt: new Date(now - 3_600_000).toISOString(),
  durationSec: 1_800,
  verified: true,
  summary: "Not sent to the phone.",
  decisions: [],
  actionItems: [],
  followUps: [],
  transcript: [],
  yourNotes: "",
};
let followUps: FollowUp[] = [
  { id: "f1", kind: "payment", status: "proposed", payeeName: "Kemi", payeeAccount: "kemi.testnet", amount: 20_000_000n, heard: "the twenty dollars", payeeListed: true, evidence: { quote: "send Kemi the twenty dollars for the icons", at: 155 } } satisfies PaymentFollowUp,
  { id: "f2", kind: "email", status: "proposed", to: "ada@example.com", toName: "Ada", subject: "Recap: Sync with Ada", autopilotAt: now + 90_000, evidence: { quote: "I'll send you the recap after this", at: 1_700 } } satisfies EmailFollowUp,
  { id: "f3", kind: "payment", status: "blocked", payeeName: "Designer", payeeAccount: "designer.testnet", amount: 5_000_000_000n, heard: "five thousand", payeeListed: true, evidence: { quote: "the designer's five thousand for the brand work", at: 900 } } satisfies PaymentFollowUp,
  { id: "f4", kind: "payment", status: "proposed", payeeName: "Tunde", payeeAccount: "", amount: 35_000_000n, heard: "thirty-five dollars", payeeListed: false, evidence: { quote: "and Tunde gets thirty-five dollars for the copy", at: 1_200 } } satisfies PaymentFollowUp,
  { id: "f5", kind: "email", status: "sent", to: "ada@example.com", toName: "Ada", subject: "Notes from Monday", doneAt: "09:41", evidence: { quote: "send the notes", at: 10 } } satisfies EmailFollowUp,
];

const sign = (kind: "approve" | "cancel", f: PaymentFollowUp) =>
  `${WEB}/sign#${encodeSignRequest({ network: "testnet", contract: "wallet.aftercall.testnet", owner: "you.testnet", action: { kind, followupId: `${meeting.id}-${f.id}`, payee: f.payeeAccount, amount: String(f.amount) } })}`;
const optionsFor = (f: FollowUp): ItemOptions => ({
  backend: true,
  ...(f.id === "f1" ? { route: { chain: "solana" as const, address: "8xKemiSoLaNa111111111111111111111111111111" }, quoted: { amountOut: "19750000", at: now } } : {}),
  ...(f.kind === "payment" && f.status === "blocked" ? { signUrls: { approve: sign("approve", f), decline: sign("cancel", f) } } : {}),
});

let results: ActionResult[] = [];
const snapshot = (): Snapshot =>
  fitSnapshot({
    t: "snapshot",
    at: Date.now(),
    network: "testnet",
    items: followUps.map((f) => toPendingItem(meeting, f, optionsFor(f))).filter((i) => i !== null),
    more: 0,
    done: followUps.map((f) => toDoneItem(meeting, f)).filter((d) => d !== null),
    results: results.slice(0, 20),
  });

const hhmm = () => new Date().toTimeString().slice(0, 5);
const mac = await fakeMac(relay.fetch, BACKEND, `${WEB}/phone`);
console.log(`\nOpen this on your phone or in a browser:\n\n  ${mac.url}\n`);

let pairedAt = 0;
let helloAt = 0;
setInterval(async () => {
  if (OFFLINE_AFTER_S && pairedAt && Date.now() - pairedAt > OFFLINE_AFTER_S * 1000) return; // the Mac is asleep
  try {
    if (!pairedAt) {
      if (!helloAt) {
        const code = await mac.takeHello();
        if (!code) return;
        helloAt = Date.now();
        console.log(`phone "${mac.device}" says hello; code ${code.slice(0, 3)} ${code.slice(3)}: confirming as if you pressed They match${CONFIRM_AFTER_S ? ` in ${CONFIRM_AFTER_S} s` : ""}`);
      }
      if (Date.now() - helloAt < CONFIRM_AFTER_S * 1000) return;
      await mac.confirm();
      pairedAt = Date.now();
      await mac.post(snapshot());
      return;
    }
    let changed = false;
    for (const { n, action } of await mac.collect()) {
      const f = followUps.find((x) => x.id === action.followUpId);
      const check = checkPhoneAction(action, f, f ? toPendingItem(meeting, f, optionsFor(f)) : null, Date.now());
      console.log(`action ${n}: ${action.kind} ${action.followUpId} → ${check.ok ? "accepted" : `refused: ${check.reason}`}`);
      results = [{ n, outcome: check.ok ? "accepted" : "refused", ...(check.ok ? {} : { reason: check.reason }) } satisfies ActionResult, ...results];
      if (check.ok && f) {
        // As the app's own buttons: Undo clears the countdown; Approve sends or pays; Dismiss dismisses.
        const { autopilotAt: _, ...rest } = f;
        const next = action.kind === "undo-autopilot" ? rest : action.kind === "dismiss" ? { ...rest, status: "dismissed" } : { ...rest, status: f.kind === "email" ? "sent" : "paid", doneAt: hhmm() };
        followUps = followUps.map((x) => (x.id === f.id ? (next as FollowUp) : x));
      }
      changed = true;
    }
    for (const f of followUps) {
      if (f.autopilotAt && f.autopilotAt <= Date.now() && f.status === "proposed") {
        followUps = followUps.map((x) => (x.id === f.id ? ({ ...x, status: x.kind === "email" ? "sent" : "paid", doneAt: hhmm(), byAutopilot: true, autopilotAt: undefined } as FollowUp) : x));
        console.log(`autopilot ran ${f.id}`);
        changed = true;
      }
    }
    if (changed) await mac.post(snapshot());
  } catch (e) {
    console.log(`mac: ${(e as Error).message}`);
  }
}, TICK_MS);
