import { z } from "zod";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import type { FollowUp, Meeting } from "../meeting.ts";
import { formatUsdc } from "../money.ts";
import { NETWORKS } from "../network.ts";
import { PAYOUT_CHAINS } from "../intents/oneclick.ts";
import type { PayeeDestination } from "../wallet/actions.ts";
import { decodeSignRequest } from "../wallet/actions.ts";
import { AMOUNT_PROBLEM_REASONS } from "../followups/autopilot.ts";
import { emailWhatLeaves, paymentWhatLeaves } from "../followups/boundaries.ts";
import { RELAY_LIMITS, RelayError, openEnvelope, sealEnvelope } from "./crypto.ts";

/**
 * What the Mac and the phone say to each other through the relay
 * (docs/design/phone-protocol.md). The Mac sends a snapshot of what waits for you,
 * holding only what you need to approve it: never the summary, the transcript or your
 * notes. The phone sends back one action at a time. Both are checked with these schemas
 * before they're sealed and after they're opened.
 */

/** The phone asks for a new snapshot this often, only while the page is open and visible. */
export const PHONE_POLL_MS = 10_000;
/** The Mac collects actions this often while Aftercall runs and a phone is paired. */
export const MAC_POLL_MS = 10_000;
/** The phone says the Mac is offline when the relay hasn't heard from it for this long. */
export const MAC_OFFLINE_AFTER_MS = 60_000;
/** The phone holds a tap this long, with Undo, before it sends it: the app's own 5 s window. */
export const PHONE_UNDO_MS = 5_000;
/** The relay keeps an action this long at most; the Mac refuses an older one. */
export const ACTION_TTL_MS = 24 * 3_600_000;
/** Pending items in one snapshot; the rest are counted in `more`. */
export const MAX_SNAPSHOT_ITEMS = 40;

const text = (max: number) => z.string().max(max);
const Id = z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/);
const Amount = z.string().regex(/^\d{1,30}$/);
const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const Time = z.number().int().nonnegative();
/** https, or http on this machine for development. */
const WebUrl = z
  .string()
  .max(2000)
  .refine((s) => /^https:\/\/[^/\s]+\//.test(s) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(s), "Not a web URL");

const WhatLeavesSchema = z.object({ summary: text(200), details: z.array(text(600)).max(5) });

const itemBase = {
  meetingId: Id,
  followUpId: Id,
  meetingTitle: text(120),
  /** The meeting's start, ISO 8601. */
  meetingAt: text(40),
  status: z.enum(["proposed", "sending", "blocked", "failed"]),
  /** The exact words from the transcript the follow-up came from. */
  quote: text(500),
  error: text(300).optional(),
  /** When autopilot runs it unless undone (ms since epoch). */
  autopilotAt: Time.optional(),
  autopilotHeld: z.boolean().optional(),
  whatLeaves: WhatLeavesSchema,
  /** From the made-up sample meeting: approving it is simulated, as in the app. */
  sample: z.boolean().optional(),
};

export const EmailItemSchema = z.object({
  ...itemBase,
  kind: z.literal("email"),
  /** Empty until you add an address on the Mac. */
  to: text(254),
  toName: text(80),
  subject: text(200),
});

export const PaymentItemSchema = z.object({
  ...itemBase,
  kind: z.literal("payment"),
  payeeName: text(80),
  /** Empty when the payee isn't on your list. */
  payeeAccount: text(64),
  payeeListed: z.boolean(),
  /** USDC base units; null when the words didn't read as an amount. */
  amount: Amount.nullable(),
  heard: text(200),
  /** Set when the payee is paid on another chain through NEAR Intents 1Click. */
  route: z
    .object({
      chain: z.enum(PAYOUT_CHAINS as ["solana", "base"]),
      address: text(100),
      /** What the Mac's last preview quote said the payee gets, and when it was asked. Approving asks again. */
      quotedOut: Amount.optional(),
      quotedAt: Time.optional(),
    })
    .nullable(),
  /** Held payments only: the web /sign pages that approve or decline it with your NEAR wallet. */
  signUrls: z.object({ approve: WebUrl, decline: WebUrl }).optional(),
});

export const PendingItemSchema = z.discriminatedUnion("kind", [EmailItemSchema, PaymentItemSchema]);
export type EmailItem = z.infer<typeof EmailItemSchema>;
export type PaymentItem = z.infer<typeof PaymentItemSchema>;
export type PendingItem = z.infer<typeof PendingItemSchema>;

export const DoneItemSchema = z.object({
  kind: z.enum(["email", "payment"]),
  meetingTitle: text(120),
  /** "Recap sent to Ada", "Paid Designer 50.00 USDC". */
  label: text(160),
  doneAt: text(10),
  byAutopilot: z.boolean().optional(),
});
export type DoneItem = z.infer<typeof DoneItemSchema>;

/** What the Mac did with one of the phone's actions, by the action's counter. */
export const ActionResultSchema = z.object({ n: z.number().int().positive(), outcome: z.enum(["accepted", "refused"]), reason: text(200).optional() });
export type ActionResult = z.infer<typeof ActionResultSchema>;

export const SnapshotSchema = z.object({
  t: z.literal("snapshot"),
  /** When the Mac made it (ms since epoch). */
  at: Time,
  network: z.enum(NETWORKS as ["testnet", "mainnet"]),
  /** Newest first. */
  items: z.array(PendingItemSchema).max(MAX_SNAPSHOT_ITEMS),
  /** Pending items left out for size; the phone says "and N more on your Mac". */
  more: z.number().int().nonnegative(),
  /** What went out today, newest first. */
  done: z.array(DoneItemSchema).max(20),
  /** The latest results of the phone's actions, newest first. */
  results: z.array(ActionResultSchema).max(20),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const PhoneActionSchema = z.object({
  t: z.literal("action"),
  kind: z.enum(["approve", "dismiss", "undo-autopilot"]),
  meetingId: Id,
  followUpId: Id,
  /** `itemDigest` of the item as the phone showed it: the Mac refuses if it has changed since. */
  digest: Hex64,
  /** When it was tapped (ms since epoch). */
  at: Time,
});
export type PhoneAction = z.infer<typeof PhoneActionSchema>;

// ---------- building items on the Mac ----------

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export interface ItemOptions {
  /** Whether this build sends recaps through Aftercall's backend (`HAS_BACKEND`). */
  backend: boolean;
  /** Whether this build can make claim links. */
  claimLinks?: boolean;
  /** The listed payee's payout on another chain, as `routeFor` gives it. */
  route?: PayeeDestination | null;
  /** The Mac's latest preview quote for that route. */
  quoted?: { amountOut: string; at: number };
  /** For a held payment: /sign links for `approve` and `cancel`, as the wallet screen builds them. */
  signUrls?: { approve: string; decline: string };
  sample?: boolean;
}

/**
 * One follow-up as the phone may see it, or null when nothing waits on it (sent, paid,
 * dismissed). Built from the follow-up and the meeting's title and time only.
 */
export function toPendingItem(meeting: Pick<Meeting, "id" | "title" | "startedAt" | "decisions" | "actionItems">, f: FollowUp, opts: ItemOptions): PendingItem | null {
  if (f.status !== "proposed" && f.status !== "sending" && f.status !== "blocked" && f.status !== "failed") return null;
  const base = {
    meetingId: meeting.id,
    followUpId: f.id,
    meetingTitle: clip(meeting.title, 120),
    meetingAt: meeting.startedAt,
    status: f.status,
    quote: clip(f.evidence.quote, 500),
    ...(f.error ? { error: clip(f.error, 300) } : {}),
    ...(f.autopilotAt ? { autopilotAt: f.autopilotAt } : {}),
    ...(f.autopilotHeld ? { autopilotHeld: true } : {}),
    ...(opts.sample ? { sample: true } : {}),
  };
  if (f.kind === "email") {
    return { ...base, kind: "email", to: f.to.trim(), toName: clip(f.toName, 80), subject: clip(f.subject, 200), whatLeaves: emailWhatLeaves(meeting, f, { backend: opts.backend }) };
  }
  const route = f.payeeListed && opts.route ? opts.route : null;
  return {
    ...base,
    kind: "payment",
    payeeName: clip(f.payeeName, 80),
    payeeAccount: f.payeeAccount,
    payeeListed: f.payeeListed,
    amount: f.amount === null ? null : f.amount.toString(),
    heard: clip(f.heard, 200),
    route: route ? { chain: route.chain, address: route.address, ...(opts.quoted ? { quotedOut: opts.quoted.amountOut, quotedAt: opts.quoted.at } : {}) } : null,
    ...(f.status === "blocked" && opts.signUrls ? { signUrls: opts.signUrls } : {}),
    whatLeaves: paymentWhatLeaves(f, { route, claimLinks: opts.claimLinks }),
  };
}

/** One follow-up that went out, for "Done today"; null when it hasn't. */
export function toDoneItem(meeting: Pick<Meeting, "title">, f: FollowUp): DoneItem | null {
  if (f.status !== "sent" && f.status !== "paid") return null;
  const label =
    f.kind === "email" ? `Recap sent to ${f.toName || f.to || "someone"}` : `Paid ${f.payeeName}${f.amount === null ? "" : ` ${formatUsdc(f.amount)} USDC`}`;
  return { kind: f.kind, meetingTitle: clip(meeting.title, 120), label: clip(label, 160), doneAt: f.doneAt ?? "", ...(f.byAutopilot ? { byAutopilot: true } : {}) };
}

/**
 * What an approval is about: who, how much, by which route, to whom and under which
 * subject. The phone sends it with each action; the Mac recomputes it from the
 * follow-up as it is now and refuses on any difference.
 */
export function itemDigest(item: PendingItem): string {
  const what =
    item.kind === "email"
      ? ["email", item.meetingId, item.followUpId, item.to, item.subject]
      : ["payment", item.meetingId, item.followUpId, item.payeeAccount, item.payeeListed, item.amount, item.route?.chain ?? null, item.route?.address ?? null];
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify(what))));
}

/**
 * Keeps a snapshot under the size limit: the oldest pending items go first (counted in
 * `more`), then the done list. Items arrive newest first.
 */
export function fitSnapshot(s: Snapshot): Snapshot {
  let out = { ...s, items: s.items.slice(0, MAX_SNAPSHOT_ITEMS), more: s.more + Math.max(0, s.items.length - MAX_SNAPSHOT_ITEMS) };
  const size = (x: Snapshot) => utf8ToBytes(JSON.stringify({ dir: "mac-to-phone", n: Number.MAX_SAFE_INTEGER, body: x })).length;
  while (size(out) > RELAY_LIMITS.snapshotBytes && out.items.length) out = { ...out, items: out.items.slice(0, -1), more: out.more + 1 };
  while (size(out) > RELAY_LIMITS.snapshotBytes && out.done.length) out = { ...out, done: out.done.slice(0, -1) };
  return out;
}

// ---------- sealing ----------

function checked<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new RelayError("BAD_MESSAGE", r.error.issues[0]?.message ?? "Bad message");
  return r.data;
}

/** Seals the parsed snapshot, so a field outside the schema (a summary, a transcript) can't ride along. */
export const sealSnapshot = (key: Uint8Array, n: number, s: Snapshot) => sealEnvelope(key, "mac-to-phone", n, checked(SnapshotSchema, s));

export function openSnapshot(key: Uint8Array, lastN: number, box: string): { n: number; snapshot: Snapshot } {
  const { n, body } = openEnvelope(key, "mac-to-phone", lastN, box);
  return { n, snapshot: checked(SnapshotSchema, body) };
}

export const sealAction = (key: Uint8Array, n: number, a: PhoneAction) => sealEnvelope(key, "phone-to-mac", n, checked(PhoneActionSchema, a));

export function openAction(key: Uint8Array, lastN: number, box: string): { n: number; action: PhoneAction } {
  const { n, body } = openEnvelope(key, "phone-to-mac", lastN, box);
  return { n, action: checked(PhoneActionSchema, body) };
}

// ---------- on the Mac: may this action run? ----------

export type ActionCheck = { ok: true } | { ok: false; reason: string };

/**
 * Whether the Mac may act on a phone's action, checked against the follow-up as it is
 * now. `item` is `toPendingItem` of that follow-up with the options the snapshots use.
 * On ok the Mac does exactly what the app's own button does (onApprove, onDismiss,
 * onUndoAutopilot) and nothing more; the contract still enforces the caps.
 */
export function checkPhoneAction(a: PhoneAction, f: FollowUp | undefined, item: PendingItem | null, now: number): ActionCheck {
  const no = (reason: string): ActionCheck => ({ ok: false, reason });
  if (now - a.at > ACTION_TTL_MS) return no("Too old: tapped more than a day ago.");
  if (!f || f.id !== a.followUpId) return no("This follow-up isn't on your Mac any more.");
  if (!item || item.meetingId !== a.meetingId) return no(`Nothing waits on it: it's ${f.status} on your Mac.`);
  if (itemDigest(item) !== a.digest) return no("It changed on your Mac since your phone showed it. Look again.");
  if (item.status === "sending") return no("It's already on its way.");
  if (a.kind === "undo-autopilot") return f.autopilotAt ? { ok: true } : no("Autopilot isn't counting down on it.");
  if (item.status === "blocked") return no(a.kind === "approve" ? "It's held for your NEAR wallet: approve it there." : "It's held for your NEAR wallet: decline it there.");
  if (a.kind === "dismiss") return { ok: true };
  if (item.kind === "email") return item.to ? { ok: true } : no("No email address yet. Add one on your Mac.");
  if (!item.payeeListed) return no("Payee isn't on your list. Add them on your Mac, or send a claim link there.");
  if (item.amount === null) return no(f.kind === "payment" ? AMOUNT_PROBLEM_REASONS[f.amountProblem ?? "unclear"] : "Amount unclear");
  return { ok: true };
}

// ---------- on the phone: is this the wallet page it says? ----------

/**
 * Whether a held payment's /sign links are what the item shows: on the web app's own
 * origin, approving and declining exactly this payee, amount and follow-up. The phone
 * opens them only when this holds. The contract's follow-up id is "<meeting>-<follow-up>"
 * (`contractFollowupId` in the Mac app).
 */
export function signUrlsMatch(item: PaymentItem, webOrigin: string, network: Snapshot["network"]): boolean {
  if (!item.signUrls || item.amount === null) return false;
  const check = (url: string, kind: "approve" | "cancel") => {
    const prefix = `${webOrigin}/sign#`;
    if (!url.startsWith(prefix)) return false;
    try {
      const r = decodeSignRequest(url.slice(prefix.length));
      const a = r.action;
      return r.network === network && a.kind === kind && a.payee === item.payeeAccount && a.amount === item.amount && a.followupId === `${item.meetingId}-${item.followUpId}`;
    } catch {
      return false;
    }
  };
  return check(item.signUrls.approve, "approve") && check(item.signUrls.decline, "cancel");
}
