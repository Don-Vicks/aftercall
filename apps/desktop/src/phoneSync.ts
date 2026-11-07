import { useEffect, useMemo, useRef, useState } from "react";
import {
  MAC_POLL_MS,
  SNAPSHOT_MIN_GAP_MS,
  SNAPSHOT_REFRESH_MS,
  buildSnapshot,
  contractFollowupId,
  handlePhoneActions,
  heldElsewhere,
  heldPaymentActions,
  heldPaymentOutcome,
  heldPaymentSignUrls,
  mergeResults,
  snapshotKey,
  toPendingItem,
  type ActionTarget,
  type FollowUp,
  type ItemOptions,
  type Meeting,
  type PhoneAction,
  type Snapshot,
} from "@aftercall/core";
import { SIGN_URL, near, type NearConfig } from "./near";
import { ackActions, exclusive, fetchActions, loadPhone, phoneStatus, postSnapshot, saveActionResult, sessionKey, usePhone } from "./phone";
import { isDeferred } from "./ui";

/** How often the Mac asks NEAR about payments held for the wallet while a phone is paired. */
const HELD_CHECK_MS = 60_000;

/** The ids of the app's own 5 s windows on a follow-up: the cards' (FollowUps.tsx) and Home's rows. */
const countdownIds = (meetingId: string, fuId: string) => ["pay", "send", "claim", "approve", "dismiss"].map((k) => `${k}:${meetingId}:${fuId}`);

export interface PhoneSyncInput {
  /** False until the saved meetings and the wallet (payees' routes) are read: nothing is posted or acted on before. */
  ready: boolean;
  /** Your NEAR account, so the /sign links follow a change of account. */
  account: string | null;
  /** Every meeting not waiting out its delete Undo. Kept between renders: a new array means a meeting changed. */
  meetings: Meeting[];
  /** The options the meeting's own follow-up cards use: backend, claim links, route, quote, sample. Kept between renders too. */
  options: (m: Meeting, f: FollowUp) => ItemOptions;
  /** What's left today and the daily cap, for a held payment's /sign context; null until the wallet is read. Kept between renders too. */
  wallet: { leftToday: bigint; dailyCap: bigint } | null;
  /** Exactly what the app's own buttons run: onApprove, onDismiss or onUndoAutopilot. */
  run: (action: PhoneAction) => void;
  /** A held payment the wallet paid or declined (as the wallet screen's onResolved). */
  onHeldResolved: (meetingId: string, fuId: string, status: "paid" | "dismissed") => void;
}

/**
 * While a phone is paired and Aftercall runs: posts a sealed snapshot of what waits when
 * it changes (at most one every 5 s) and every 5 minutes, collects the phone's actions
 * every 10 s and runs the ones that pass every check, and asks NEAR about held payments
 * the phone may have approved or declined in the wallet.
 */
export function usePhoneSync(input: PhoneSyncInput) {
  const phone = usePhone();
  // Nothing runs until the saved meetings are read: an action for one not yet loaded would be refused as gone.
  const pairedId = input.ready ? (phone.paired?.pairingId ?? null) : null;
  const latest = useRef(input);
  latest.current = input;
  const [config, setConfig] = useState<NearConfig | null>(null);

  useEffect(() => {
    void loadPhone();
  }, []);

  useEffect(() => {
    if (!pairedId) return;
    near.getConfig().then(setConfig).catch(() => setConfig(null));
  }, [pairedId, input.account]);

  /**
   * Options as the cards use them, plus /sign links for a payment held for the wallet,
   * unless it was held on another network or account: those links would ask a contract
   * that never parked it, so the phone says to review it on the Mac.
   */
  const optionsFor = (m: Meeting) => (f: FollowUp): ItemOptions => {
    const base = latest.current.options(m, f);
    const wallet = latest.current.wallet;
    if (f.kind !== "payment" || f.status !== "blocked" || base.sample || !config || !wallet || heldElsewhere(f, config)) return base;
    const signUrls = heldPaymentSignUrls(SIGN_URL, { network: config.network, contract: config.contract, owner: config.account }, heldPaymentActions(m, f, wallet));
    return { ...base, signUrls };
  };

  const build = (): Snapshot =>
    buildSnapshot({
      at: Date.now(),
      network: config?.network ?? "testnet",
      meetings: latest.current.meetings.map((m) => ({ meeting: m, options: optionsFor(m) })),
      results: phoneStatus().paired?.results ?? [],
    });

  // Posting: on change, at most one every 5 s, and every 5 minutes regardless.
  const posted = useRef({ key: "", at: 0, timer: 0 });
  const post = () =>
    exclusive(async () => {
      if (!phoneStatus().paired) return;
      const s = build();
      posted.current.key = snapshotKey(s);
      posted.current.at = Date.now();
      await postSnapshot(s);
    }).catch(() => {
      // Offline, or the relay forgot the pairing (phone.ts says so): try again on the next change,
      // once the relay answers again, or at the 5-minute refresh.
      posted.current.key = "";
    });
  const postRef = useRef(post);
  postRef.current = post;

  useEffect(() => {
    if (!pairedId) return;
    posted.current = { key: "", at: 0, timer: 0 };
    const t = window.setInterval(() => void postRef.current(), SNAPSHOT_REFRESH_MS);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(posted.current.timer);
      posted.current.timer = 0;
    };
  }, [pairedId]);

  // What the phone should see, rebuilt only when what goes into it changes, not on every
  // render: while you record, the app renders every second.
  const results = phone.paired?.results;
  const wanted = useMemo(
    () => (pairedId ? snapshotKey(build()) : ""),
    // `build` reads these through `latest` and `config`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pairedId, input.meetings, input.options, input.wallet, config, results],
  );

  // Also when the relay can be reached again (`problem` clears), after a post that failed.
  useEffect(() => {
    if (!pairedId) return;
    const p = posted.current;
    if (p.timer || wanted === p.key) return;
    const wait = Math.max(0, p.at + SNAPSHOT_MIN_GAP_MS - Date.now());
    p.timer = window.setTimeout(() => {
      p.timer = 0;
      void postRef.current();
    }, wait);
  }, [pairedId, wanted, phone.problem]);

  // Actions: every 10 s, in relay order, each re-checked against the follow-up as it is now.
  useEffect(() => {
    if (!pairedId) return;
    const target = (meetingId: string, fuId: string): ActionTarget => {
      const m = latest.current.meetings.find((x) => x.id === meetingId);
      const f = m?.followUps.find((x) => x.id === fuId);
      if (!m || !f) return { followUp: undefined, item: null };
      const busy = countdownIds(meetingId, fuId).some(isDeferred) ? "Your Mac is counting down on it. Undo it there, or let it run." : undefined;
      return { followUp: f, item: toPendingItem(m, f, optionsFor(m)(f)), busy };
    };
    const tick = () =>
      exclusive(async () => {
        const key = sessionKey();
        const s = phoneStatus().paired;
        if (!key || !s) return;
        const actions = await fetchActions();
        if (actions.length === 0) return;
        const done = await handlePhoneActions({
          key,
          lastN: s.lastActionN,
          actions,
          now: Date.now,
          target,
          run: (a) => latest.current.run(a),
          save: async (n, result) => void (await saveActionResult(n, (old) => mergeResults([result], old))),
        });
        if (done.ackSeq !== null) await ackActions(done.ackSeq);
      }).catch(() => {
        // Offline: the relay keeps the actions for 24 hours, so the next tick reads them again.
      });
    void tick();
    const t = window.setInterval(() => void tick(), MAC_POLL_MS);
    return () => window.clearInterval(t);
    // `optionsFor` reads the latest input through the ref; `config` changes the /sign links.
  }, [pairedId, config]);

  // Held payments: the phone opens the wallet directly, so the Mac asks NEAR what became of them,
  // on the contract and account it uses now; one held on another is left as it is (`heldPaymentOutcome`).
  useEffect(() => {
    if (!pairedId || !config) return;
    const check = async () => {
      const here = await near.getConfig().catch(() => null);
      if (!here) return;
      for (const m of latest.current.meetings) {
        for (const f of m.followUps) {
          if (f.kind !== "payment" || f.status !== "blocked" || latest.current.options(m, f).sample || heldElsewhere(f, here)) continue;
          const state = await near.paymentState(contractFollowupId(m.id, f.id)).catch(() => null);
          // Judged by where the answer came from, not `here`: a switch mid-check asks the new contract.
          const outcome = state && heldPaymentOutcome(f, state.asked, state);
          if (outcome) latest.current.onHeldResolved(m.id, f.id, outcome);
        }
      }
    };
    void check();
    const t = window.setInterval(() => void check(), HELD_CHECK_MS);
    return () => window.clearInterval(t);
  }, [pairedId, config]);
}
