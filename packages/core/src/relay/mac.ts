import type { FollowUp, Meeting, NearPlace, PaymentFollowUp } from "../meeting.ts";
import type { Network } from "../network.ts";
import { formatUsdc } from "../money.ts";
import { meetingLabel } from "../when.ts";
import { encodeSignRequest, type OwnerAction, type SignRequest } from "../wallet/actions.ts";
import {
  PendingItemSchema,
  checkPhoneAction,
  fitSnapshot,
  openAction,
  toDoneItem,
  toPendingItem,
  type ActionResult,
  type DoneItem,
  type ItemOptions,
  type PendingItem,
  type PhoneAction,
  type Snapshot,
} from "./messages.ts";

/**
 * The Mac's side of the phone relay (docs/design/phone-protocol.md §5), as pure
 * functions: what goes in a snapshot, and what the Mac does with the phone's actions.
 * The app supplies the follow-ups, the relay calls and its own Approve, Dismiss and
 * Undo handlers; nothing here reaches the network or the Keychain.
 */

/** At most one snapshot every this long while things change. */
export const SNAPSHOT_MIN_GAP_MS = 5_000;
/** A fresh snapshot this often even when nothing changed, so the phone's view of autopilot and errors stays current. */
export const SNAPSHOT_REFRESH_MS = 5 * 60_000;
/** Results of the phone's actions a snapshot carries, newest first. */
export const MAX_RESULTS = 20;

/** The Mac asks the relay for the phone's hello this often while the QR code shows. */
export const HELLO_POLL_MS = 2_000;

/**
 * Waits for the phone's sealed hello: `ask` every `HELLO_POLL_MS` until it returns a box,
 * the pairing runs out at `until` (null) or `signal` aborts (null). An ask that fails in
 * a way `transient` allows (the relay unreachable, a server error) is asked again at the
 * next interval, and `onReach` says whether the last ask got through; any other failure
 * is the relay's definite answer, such as the pairing gone or expired, and ends the wait.
 */
export async function pollHello(args: {
  ask: () => Promise<string | null>;
  until: number;
  signal: AbortSignal;
  transient: (e: unknown) => boolean;
  onReach?: (reached: boolean) => void;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<string | null> {
  const now = args.now ?? Date.now;
  const sleep = args.sleep ?? pause;
  while (!args.signal.aborted && now() < args.until) {
    let box: string | null = null;
    try {
      box = await args.ask();
      args.onReach?.(true);
    } catch (e) {
      if (!args.transient(e)) throw e;
      args.onReach?.(false);
    }
    if (box) return box;
    await sleep(HELLO_POLL_MS, args.signal);
  }
  return null;
}

/** Resolves after `ms`, or at once when `signal` aborts. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });
}

/** The follow-up's id on the agent-wallet contract: "<meeting>-<follow-up>". */
export const contractFollowupId = (meetingId: string, followupId: string) => `${meetingId}-${followupId}`;

/**
 * The wallet's two answers to a held payment, exactly as the wallet screen's Review and
 * Decline send them: the same contract follow-up id, payee, amount and context.
 */
export function heldPaymentActions(
  meeting: Pick<Meeting, "id" | "title" | "startedAt">,
  f: PaymentFollowUp,
  wallet: { leftToday: bigint; dailyCap: bigint },
  now = Date.now(),
): { approve: OwnerAction; cancel: OwnerAction } {
  const followupId = contractFollowupId(meeting.id, f.id);
  const amount = String(f.amount ?? 0n);
  return {
    approve: {
      kind: "approve",
      followupId,
      payee: f.payeeAccount,
      amount,
      context: {
        payeeName: f.payeeName,
        meeting: `${meeting.title} · ${meetingLabel(meeting, now)}`,
        heard: f.heard,
        leftToday: `${formatUsdc(wallet.leftToday)} of ${formatUsdc(wallet.dailyCap)}`,
        // A coding agent's proposal has no words heard: the approve page says who proposed it and why.
        ...(f.proposedBy ? { proposedBy: `${f.proposedBy.agent}: “${f.proposedBy.reason}”` } : {}),
      },
    },
    cancel: { kind: "cancel", followupId, payee: f.payeeAccount, amount },
  };
}

/** The web /sign links that approve and decline a held payment, for the phone (`signUrls` in a payment item). */
export function heldPaymentSignUrls(signPage: string, owner: Omit<SignRequest, "action">, actions: { approve: OwnerAction; cancel: OwnerAction }): { approve: string; decline: string } {
  const link = (action: OwnerAction) => `${signPage}#${encodeSignRequest({ ...owner, action })}`;
  return { approve: link(actions.approve), decline: link(actions.cancel) };
}

/**
 * Whether a held payment was parked on another network, contract or NEAR account than
 * the one the app uses now (`heldOn`). The contract here has never heard of it: its
 * `get_pending` answers null, and that must not read as declined. False when the app
 * didn't keep where it was held.
 */
export function heldElsewhere(f: PaymentFollowUp, here: NearPlace): boolean {
  const at = f.heldOn;
  return !!at && (at.network !== here.network || at.contract !== here.contract || at.account !== here.account);
}

/**
 * What became of a held payment, from the contract the app uses now (`is_paid` and
 * `get_pending` for that follow-up): paid, dismissed, or null while it still waits or
 * the answer can't be trusted. The contract keeps no record of a decline: a payment
 * neither paid nor pending was declined only if it was parked on this very contract and
 * account. So a payment held elsewhere is never decided here, and one held before
 * `heldOn` was kept is marked only once it's paid.
 */
export function heldPaymentOutcome(f: PaymentFollowUp, here: NearPlace, state: { paid: boolean; pending: boolean }): "paid" | "dismissed" | null {
  if (heldElsewhere(f, here)) return null;
  if (state.paid) return "paid";
  return f.heldOn && !state.pending ? "dismissed" : null;
}

/** One meeting as the snapshot reads it, with the options its follow-up cards use. */
export interface SnapshotMeeting {
  meeting: Meeting;
  options: (f: FollowUp) => ItemOptions;
}

const startOf = (m: Pick<Meeting, "startedAt">) => Date.parse(m.startedAt) || 0;
const localDay = (ms: number) => new Date(ms).toDateString();

/**
 * What waits for you, for the phone: every follow-up proposed, sending, held or failed,
 * newest meeting first, and what went out in today's meetings. Built only through
 * `toPendingItem` and `toDoneItem`, then cut to size with `fitSnapshot`. Leave out
 * meetings waiting out their delete Undo before calling this.
 */
export function buildSnapshot(args: { at: number; network: Network; meetings: SnapshotMeeting[]; results: ActionResult[] }): Snapshot {
  const meetings = [...args.meetings].sort((a, b) => startOf(b.meeting) - startOf(a.meeting));
  const pending: PendingItem[] = meetings.flatMap(({ meeting, options }) =>
    meeting.followUps.flatMap((f) => {
      const item = toPendingItem(meeting, f, options(f));
      return item ? [item] : [];
    }),
  );
  // One item the schema refuses (an id it doesn't allow) is left out and counted, rather than stopping every snapshot.
  const items = pending.filter((i) => PendingItemSchema.safeParse(i).success);
  const today = localDay(args.at);
  const done: DoneItem[] = meetings
    .filter(({ meeting }) => localDay(startOf(meeting)) === today)
    .flatMap(({ meeting }) => meeting.followUps.flatMap((f) => toDoneItem(meeting, f) ?? []))
    .sort((a, b) => b.doneAt.localeCompare(a.doneAt))
    .slice(0, 20);
  return fitSnapshot({ t: "snapshot", at: args.at, network: args.network, items, more: pending.length - items.length, done, results: args.results.slice(0, MAX_RESULTS) });
}

/** What a snapshot says, without its time: when this changes, the phone needs a new one. */
export const snapshotKey = (s: Snapshot) => JSON.stringify({ ...s, at: 0 });

/** New results first, then the older ones, at most `MAX_RESULTS`. A new result for the same counter replaces the older one. */
export const mergeResults = (newestFirst: ActionResult[], older: ActionResult[]): ActionResult[] =>
  [...newestFirst, ...older.filter((r) => !newestFirst.some((x) => x.n === r.n))].slice(0, MAX_RESULTS);

/** Why an approval from the phone is refused while autopilot counts down on the follow-up. */
export const AUTOPILOT_COUNTING = "Autopilot is counting down on it. Let it run, or undo autopilot first.";

/** One sealed action as the relay hands it to the Mac. */
export interface RelayActionBox {
  seq: number;
  box: string;
}

/** A follow-up as the Mac sees it when an action names it. */
export interface ActionTarget {
  followUp: FollowUp | undefined;
  /** `toPendingItem` of it, with the same options as the snapshots. */
  item: PendingItem | null;
  /** Set when the Mac is already doing something with it (its own 5 s countdown): the action is refused with this reason. */
  busy?: string;
}

export interface HandledActions {
  /** The highest counter accepted, to keep as `lastActionN`. */
  lastN: number;
  /** The last `seq` read, to acknowledge; null when there was nothing. */
  ackSeq: number | null;
  /** What happened to each action that opened, newest first. */
  results: ActionResult[];
  /** Boxes that failed to open (tampered, wrong key, replayed, reflected): skipped, never run. */
  skipped: number;
}

/**
 * Runs the phone's waiting actions, oldest first. A box that doesn't open, or opens with
 * a counter not above the last accepted one, is skipped and nothing runs. An action that
 * opens is checked against the follow-up as it is now (`checkPhoneAction`); only if it
 * passes does `run` do what the app's own button does. `save` keeps the new counter and
 * the result before `run` starts: if saving fails, nothing has run and the box is read
 * again next time; once it's saved, the box can't open again (REPLAY), so a failed save
 * or Aftercall stopping mid-run can never run it twice. If `run` then throws, the result
 * is saved again as refused. A follow-up gets at most one action per batch: the app's
 * state catches up between batches.
 */
export async function handlePhoneActions(args: {
  key: Uint8Array;
  lastN: number;
  actions: RelayActionBox[];
  now: () => number;
  target: (meetingId: string, followUpId: string) => ActionTarget;
  run: (action: PhoneAction) => void | Promise<void>;
  save: (lastN: number, result: ActionResult) => void | Promise<void>;
}): Promise<HandledActions> {
  let lastN = args.lastN;
  let ackSeq: number | null = null;
  let skipped = 0;
  const results: ActionResult[] = [];
  const acted = new Set<string>();
  for (const { seq, box } of [...args.actions].sort((a, b) => a.seq - b.seq)) {
    ackSeq = seq;
    let opened: { n: number; action: PhoneAction };
    try {
      opened = openAction(args.key, lastN, box);
    } catch {
      skipped += 1;
      continue;
    }
    const { n, action } = opened;
    const id = `${action.meetingId}:${action.followUpId}`;
    const t = args.target(action.meetingId, action.followUpId);
    const check = acted.has(id)
      ? { ok: false as const, reason: "Your phone asked twice; your Mac acted on the first." }
      : t.busy && t.followUp
        ? { ok: false as const, reason: t.busy }
        : // The app offers no Approve during autopilot's countdown, and approving then would race it.
          action.kind === "approve" && t.followUp?.autopilotAt
          ? { ok: false as const, reason: AUTOPILOT_COUNTING }
          : checkPhoneAction(action, t.followUp, t.item, args.now());
    const result: ActionResult = check.ok ? { n, outcome: "accepted" } : { n, outcome: "refused", reason: check.reason };
    // Consumed before it runs, never after: see above.
    await args.save(n, result);
    lastN = n;
    results.unshift(result);
    if (!check.ok) continue;
    acted.add(id);
    try {
      await args.run(action);
    } catch {
      results[0] = { n, outcome: "refused", reason: "Your Mac couldn't start it. Look on your Mac." };
      await args.save(n, results[0]);
    }
  }
  return { lastN, ackSeq, results, skipped };
}
