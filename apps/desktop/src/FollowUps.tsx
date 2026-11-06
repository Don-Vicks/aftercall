import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { Copy, Link2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AUTOPILOT_HELD,
  CHAIN_NAME,
  UNDO_SECONDS,
  amountNote,
  amountProblem as whyNoAmount,
  capsCrossed,
  currencyIn,
  emailWhatLeaves,
  formatClock,
  formatUsdc,
  paymentWhatLeaves,
  routeLabel,
  type AmountProblemKind,
  type Attendee,
  type EmailFollowUp,
  type FollowUp,
  type FollowUpStatus,
  type Meeting,
  type PayeeDestination,
  type PaymentFollowUp,
  type PayoutPreview,
  type WalletLimits,
  type WhatLeaves,
} from "@aftercall/core";
import { useChanged } from "./primitives/Check";
import { Avatar, Button, Card, Input, LayoutMotion, SectionTitle, Spinner, cx, deferred, ease, enter, exit, springs, toast, useConfirm, useDeferred } from "./ui";
import { parseUsdcInput } from "./WalletScreen";
import { explorerTx, near } from "./near";
import { isDesktop } from "./recorder";
import { HAS_BACKEND } from "./backend";
import { TimeChip } from "./Quote";

/** Everything a follow-up row can ask the app to do. */
export interface FollowUpHandlers {
  /** Runs the follow-up now. The rows wait out a 5-second Undo before calling it. */
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
  /** Takes a dismiss back (the toast's Undo): the row returns in the state it had. */
  onRestore: (id: string, status: FollowUpStatus) => void;
  /** Shows the quote's line in the transcript; `focusId` is the row to focus again on "Back to notes". */
  onJumpTo: (at: number, quote: string, focusId?: string) => void;
  onReviewBlocked: (id: string) => void;
  onDraft: (id: string) => void;
  onSetEmail: (id: string, email: string) => void;
  onClaimLink: (id: string) => void;
  /** Opens the wallet to add the shared account. The rows wait out a 5-second Undo before calling it. */
  onConfirmClaim: (id: string) => void;
  onUndoAutopilot: (id: string) => void;
  /** The person corrects the amount; heard words stay as evidence. */
  onSetAmount: (id: string, amount: bigint) => void;
  /** The payee's address outside NEAR, when the owner opted them in to NEAR Intents. */
  routeFor?: (f: PaymentFollowUp) => PayeeDestination | null;
  /** A dry NEAR Intents quote for that route. */
  previewRoute?: (f: PaymentFollowUp, dest: PayeeDestination) => Promise<PayoutPreview>;
}

/** The grace period before an approved payment, send or wallet confirmation runs. */
const GRACE_MS = 5000;

/** "Recap to Ada", "Pay Designer 50.00": how a follow-up is named in chips and toasts. */
export function followUpTitle(f: FollowUp): string {
  if (f.kind === "email") return `Recap to ${f.toName || "someone"}`;
  return `Pay ${f.payeeName}${f.amount === null ? "" : ` ${formatUsdc(f.amount)}`}`;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const shortHash = (h: string) => (h.length > 12 ? `${h.slice(0, 4)}…${h.slice(-4)}` : h);
const shortAddress = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** The meeting's follow-ups as cards that animate between their states. */
export function FollowUps({
  meetingId,
  meeting,
  followUps,
  limits,
  invited = [],
  autopilotOn = false,
  onOpenAutopilot,
  ...h
}: {
  meetingId: string;
  /** What a recap is made of, so each card can say what leaves. */
  meeting: Pick<Meeting, "decisions" | "actionItems">;
  followUps: FollowUp[];
  /** The agent wallet's per-payment cap and what it can still pay today, when connected. */
  limits: WalletLimits | null;
  /** Invited people with an email: offered as recap addresses. */
  invited?: Attendee[];
  /** Whether any autopilot rule is on (Settings). */
  autopilotOn?: boolean;
  onOpenAutopilot?: () => void;
} & FollowUpHandlers) {
  const network = useNetwork();
  const visible = followUps.filter((f) => f.status !== "dismissed");
  // Kept while every row is dismissed, so the last one can collapse and its Undo still has a place to return to.
  if (followUps.length === 0) return null;
  const anyAutopilot = autopilotOn || followUps.some((f) => f.autopilotAt || f.byAutopilot);

  const dismiss = (f: FollowUp) => {
    const before = f.status;
    h.onDismiss(f.id);
    toast({
      id: `dismiss:${meetingId}:${f.id}`,
      text: f.kind === "email" ? `Recap to ${f.toName || "someone"} dismissed` : `Payment to ${f.payeeName} dismissed`,
      undo: () => h.onRestore(f.id, before),
    });
  };
  const ctx: RowContext = { meetingId, meeting, h, limits, invited, network, dismiss };

  return (
    <section aria-labelledby="followups" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <SectionTitle id="followups" count={anyAutopilot ? "autopilot on" : "nothing runs until you approve"}>
          Follow-ups
        </SectionTitle>
        {anyAutopilot && onOpenAutopilot && (
          <button type="button" onClick={onOpenAutopilot} className="text-[13px] font-semibold text-verdigris hover:text-verdigris-hover">
            Autopilot rules
          </button>
        )}
      </div>
      <LayoutMotion>
        <div className="relative flex flex-col gap-3">
          <AnimatePresence initial={false} mode="popLayout">
            {visible.map((f) => (
              <m.div
                key={f.id}
                id={`followup-${f.id}`}
                layout="position"
                transition={springs.gentle}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: enter }}
                exit={{ opacity: 0, scale: 0.98, transition: exit }}
                className="scroll-mt-16"
              >
                {f.kind === "email" ? <EmailRow f={f} c={ctx} /> : <PaymentRow f={f} c={ctx} />}
              </m.div>
            ))}
          </AnimatePresence>
          {visible.length === 0 && <p className="m-0 text-[13px] text-ink-2">Every follow-up was dismissed.</p>}
        </div>
      </LayoutMotion>
    </section>
  );
}

interface RowContext {
  meetingId: string;
  meeting: Pick<Meeting, "decisions" | "actionItems">;
  h: FollowUpHandlers;
  limits: WalletLimits | null;
  invited: Attendee[];
  network: "testnet" | "mainnet" | null;
  dismiss: (f: FollowUp) => void;
}

/** The NEAR network, for transaction links (desktop only). */
function useNetwork(): RowContext["network"] {
  const [network, setNetwork] = useState<RowContext["network"]>(null);
  useEffect(() => {
    if (!isDesktop) return;
    let live = true;
    near
      .getConfig()
      .then((c) => live && setNetwork(c?.network ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return network;
}

/** The id of a follow-up's pending deferred action, per kind. */
const graceId = (kind: "pay" | "send" | "claim", meetingId: string, fuId: string) => `${kind}:${meetingId}:${fuId}`;

/** The time, refreshed every 250 ms, for countdowns. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/** A card's lower part; it opens and closes in height as the card changes state. */
function Body({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <m.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1, transition: { height: springs.gentle, opacity: { duration: 0.2, ease, delay: 0.04 } } }}
      exit={{ height: 0, opacity: 0, transition: exit }}
      className="overflow-hidden"
    >
      <div className={cx("flex flex-col gap-3.5 pt-3.5 pl-12", className)}>{children}</div>
    </m.div>
  );
}

/** A card's top line: who, what, and its state or main figure on the right. `clip` cuts a long sub line (an address and subject) to one line. */
function Head({ name, title, sub, clip, children }: { name: string; title: ReactNode; sub?: ReactNode; clip?: boolean; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3.5">
      <Avatar name={name} size={34} decorative />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="font-semibold text-ink">{title}</span>
        {sub && <span className={cx("text-[13px] leading-[18px] text-ink-2", clip && "truncate")}>{sub}</span>}
      </span>
      {children}
    </div>
  );
}

/** The quote the follow-up came from, and its time: a chip that jumps to it in the transcript. */
function EvidenceQuote({ quote, at, returnId, onJumpTo }: { quote: string; at: number; returnId: string; onJumpTo: FollowUpHandlers["onJumpTo"] }) {
  return (
    <p className="t-quote selectable m-0 text-ink-2">
      “{quote}” <TimeChip id={returnId} at={at} onJump={() => onJumpTo(at, quote, returnId)} />
    </p>
  );
}

/** "Paying in 4… you can still take it back." with Undo and a bar that empties. */
function Countdown({ verb, startedAt, endsAt, onUndo }: { verb: string; startedAt: number; endsAt: number; onUndo: () => void }) {
  const now = useNow();
  const left = Math.max(1, Math.ceil((endsAt - now) / 1000));
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-ink-2">
          {verb} in <span className="font-mono text-ink">{left}</span>… you can still take it back.
        </span>
        <button type="button" autoFocus onClick={onUndo} className="press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm bg-well px-3 font-semibold text-ink">
          Undo <span className="font-mono text-[11px] font-normal text-muted">⌘Z</span>
        </button>
      </div>
      <Bar startedAt={startedAt} total={Math.max(1, endsAt - startedAt)} />
    </div>
  );
}

/** A 3px bar emptying over `total` ms from `startedAt`; coming back to it mid-way picks up where it is. */
function Bar({ startedAt, total }: { startedAt: number; total: number }) {
  const [elapsed] = useState(() => Math.min(total, Math.max(0, Date.now() - startedAt)));
  return (
    <div aria-hidden="true" className="h-[3px] overflow-hidden rounded-full bg-hairline">
      <div className="h-[3px] origin-left bg-verdigris" style={{ animation: `ac-countdown ${total}ms linear ${-elapsed}ms both` }} />
    </div>
  );
}

/** "Sending by autopilot in 0:52 · your team's domain", counting down live, with Undo. */
function AutopilotLine({ at, verb, why, onUndo }: { at: number; verb: string; why: string; onUndo: () => void }) {
  const now = useNow();
  const left = Math.max(0, Math.ceil((at - now) / 1000));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-ink-2">
          {verb} by autopilot in <span className="font-mono text-ink">{formatClock(left).replace(/^0/, "")}</span> · {why}
        </span>
        <button type="button" onClick={onUndo} className="press inline-flex h-8 shrink-0 items-center rounded-sm bg-well px-3 font-semibold text-ink">
          Undo
        </button>
      </div>
      <Bar startedAt={at - UNDO_SECONDS * 1000} total={UNDO_SECONDS * 1000} />
    </div>
  );
}

/** What a follow-up shares and who says yes, behind a short line, before you approve it. */
function WhatLeavesNote({ w }: { w: WhatLeaves }) {
  return (
    <details className="text-[13px] text-ink-2">
      <summary className="cursor-pointer">
        {w.summary} <span className="font-semibold hover:text-ink">What leaves?</span>
      </summary>
      <div className="mt-1.5 flex max-w-[440px] flex-col gap-1">
        {w.details.map((d) => (
          <p key={d} className="m-0">
            {d}
          </p>
        ))}
      </div>
    </details>
  );
}

/** Why a follow-up autopilot had queued now waits: Aftercall closed before its undo window ran out. */
function HeldNote() {
  return <span className="text-[13px] text-ink-2">{AUTOPILOT_HELD} Approve it yourself, or dismiss it.</span>;
}

/**
 * The "done" pill. It pops in, and its check draws, when the state changed on screen.
 * `upper` is the status-pill style (SENT 14:06); a payment's pill reads "50.00 USDC paid 14:07".
 */
function DonePill({ play, upper, children }: { play: boolean; upper?: boolean; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-verdigris-tint whitespace-nowrap text-verdigris",
        upper ? "t-label h-6 px-2.5" : "h-[26px] px-[11px] text-[12px] font-semibold",
      )}
      style={play ? { animation: "ac-pop 420ms var(--ease) both" } : undefined}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" strokeDasharray="24" style={play ? { animation: "ac-draw 260ms 120ms var(--ease) both" } : undefined} />
      </svg>
      {children}
    </span>
  );
}

/** A transaction hash; it opens the NEAR explorer once the network is known. */
function TxLink({ hash, network }: { hash: string; network: RowContext["network"] }) {
  if (!network) return <span className="font-mono text-[12px] text-ink-2">{shortHash(hash)}</span>;
  return (
    <button
      type="button"
      onClick={() => openUrl(explorerTx(network, hash))}
      aria-label={`Open transaction ${shortHash(hash)} on NEAR`}
      className="font-mono text-[12px] text-verdigris hover:text-verdigris-hover"
    >
      {shortHash(hash)}
    </button>
  );
}

function EmailRow({ f, c }: { f: EmailFollowUp; c: RowContext }) {
  const { h } = c;
  const pending = useDeferred(graceId("send", c.meetingId, f.id));
  const sentNow = useChanged(f.status);
  const draftedNow = useChanged(f.draftedAt);
  const [held, setHeld] = useState(false);
  const [email, setEmail] = useState("");
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const name = f.toName || "someone";
  const fromCalendar = !!f.to && c.invited.some((a) => a.email.toLowerCase() === f.to.toLowerCase());
  const open = f.status === "proposed" || f.status === "failed";

  const send = () =>
    deferred({
      id: graceId("send", c.meetingId, f.id),
      quiet: true,
      ms: GRACE_MS,
      text: (s) => `Sending the recap to ${name} in ${s}…`,
      run: () => h.onApprove(f.id),
    });

  const confirm = useConfirm();
  /** A sent recap again, as it reads now: edits made since are in it, marked. Same undo window as the first send. */
  const sendAgain = async () => {
    const ok = await confirm({
      title: `Send this recap to ${f.to} again?`,
      body: "It goes out as it reads now, so action items you've changed since are in it, marked as edited.",
      confirmLabel: "Send again",
    });
    if (ok) send();
  };

  const state = pending
    ? "countdown"
    : f.status === "sending"
      ? "sending"
      : f.status === "sent"
        ? "sent"
        : f.autopilotAt
          ? "autopilot"
          : open && f.draftedAt
            ? "drafted"
            : "open";

  let sub: ReactNode;
  if (state === "sent") sub = f.byAutopilot ? "Sent by autopilot · every rule passed" : `Sent through Aftercall · ${f.to}`;
  else if (state === "sending") sub = `To ${f.to}`;
  else if (state === "drafted") sub = `Opened as a draft in your Mail · “${f.subject}”`;
  else if (!f.to)
    sub = (
      <>
        <span className="text-caution">No address yet</span> · “{f.subject}”
      </>
    );
  else sub = fromCalendar ? `${f.to} · from your calendar` : `${f.to} · “${f.subject}”`;

  return (
    <Card pad="none" className={cx("lift px-5", state === "sent" || state === "drafted" ? "py-3.5" : "py-4")}>
      <Head name={name} title={`Recap to ${name}`} sub={sub} clip>
        {state === "sent" && (
          <>
            <Button variant="quiet" size="sm" onClick={() => h.onDraft(f.id)}>
              Draft in Mail
            </Button>
            {HAS_BACKEND && f.to && (
              <Button variant="quiet" size="sm" onClick={sendAgain}>
                Send again
              </Button>
            )}
            <DonePill play={sentNow} upper>
              Sent {f.doneAt}
            </DonePill>
          </>
        )}
        {state === "drafted" && (
          <>
            <Button variant="quiet" size="sm" onClick={() => h.onDraft(f.id)}>
              Draft again
            </Button>
            <DonePill play={draftedNow} upper>
              Drafted {f.draftedAt}
            </DonePill>
          </>
        )}
        {state === "open" && <span className="t-eyebrow shrink-0 text-muted">Proposed</span>}
      </Head>
      <AnimatePresence initial={false} mode="wait">
        {state === "countdown" && pending && (
          <Body key="countdown">
            <Countdown verb="Sending" startedAt={pending.startedAt} endsAt={pending.endsAt} onUndo={pending.cancel} />
          </Body>
        )}
        {state === "sending" && (
          <Body key="sending" className="flex-row items-center gap-2.5 text-ink-2">
            <Spinner size={14} /> Sending through Aftercall…
          </Body>
        )}
        {state === "sent" && f.error && (
          <Body key="sent-error">
            <p className="selectable m-0 text-record">Sending it again didn't work: {f.error}</p>
          </Body>
        )}
        {state === "autopilot" && f.autopilotAt && (
          <Body key="autopilot">
            <AutopilotLine
              at={f.autopilotAt}
              verb="Sending"
              why="your team's domain"
              onUndo={() => {
                setHeld(true);
                h.onUndoAutopilot(f.id);
              }}
            />
          </Body>
        )}
        {state === "open" && (
          <Body key="open">
            {held && <span className="text-[13px] text-ink-2">Autopilot stopped. This recap waits for you.</span>}
            {!held && f.autopilotHeld && f.status === "proposed" && <HeldNote />}
            <EvidenceQuote quote={f.evidence.quote} at={f.evidence.at} returnId={`jump-${f.id}`} onJumpTo={h.onJumpTo} />
            {!f.to && (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Input
                    aria-label={`Email address for ${name}`}
                    value={email}
                    onChange={(e) => setEmail(e.target.value.trim())}
                    placeholder={`${(f.toName || "their").toLowerCase().split(" ")[0]}@example.com`}
                    className="flex-1"
                  />
                  <Button disabled={!valid} onClick={() => h.onSetEmail(f.id, email)}>
                    Use address
                  </Button>
                </div>
                {c.invited.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] text-ink-2">Invited:</span>
                    {c.invited.map((a) => (
                      <Button key={a.email} variant="ghost" size="sm" title={a.email} onClick={() => h.onSetEmail(f.id, a.email)}>
                        {a.name || a.email}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {f.error && <p className="selectable m-0 text-record">{f.error}</p>}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <WhatLeavesNote w={emailWhatLeaves(c.meeting, f, { backend: HAS_BACKEND })} />
              <span className="ml-auto flex flex-wrap justify-end gap-2">
                <Button variant="quiet" onClick={() => c.dismiss(f)}>
                  Dismiss
                </Button>
                {HAS_BACKEND && (
                  <Button variant="quiet" onClick={send} disabled={!f.to}>
                    Send through Aftercall
                  </Button>
                )}
                {/* The private default: the recap opens in your own mail app and no Aftercall server sees it. */}
                <Button variant="primary" onClick={() => h.onDraft(f.id)}>
                  Draft in Mail
                </Button>
              </span>
            </div>
          </Body>
        )}
      </AnimatePresence>
    </Card>
  );
}

/**
 * Why a payment has no amount, short enough for the Heard row. Meetings made before
 * amounts were checked against the quote have no reason: they read as unclear.
 */
function missingAmount(f: PaymentFollowUp): string {
  const p = whyNoAmount(f.heard);
  // As amountNote reads it: heard words in another currency say so even without a reason.
  const kind: AmountProblemKind = f.amountProblem ?? (p?.kind === "not-usdc" ? "not-usdc" : "unclear");
  if (kind === "not-in-quote") return "Amount not in the quote: enter it";
  if (kind === "not-usdc") {
    const currency = p?.kind === "not-usdc" ? p.currency : currencyIn(f.evidence.quote);
    return currency ? `Not in USDC (${currency}): enter the USDC amount` : "Not in USDC: enter the USDC amount";
  }
  return "Amount unclear: enter it";
}

/** 1Click's statuses in plain words. */
const swapWords: Record<string, string> = {
  PENDING_DEPOSIT: "Waiting for deposit",
  KNOWN_DEPOSIT_TX: "Deposit seen",
  INCOMPLETE_DEPOSIT: "Deposit short",
  PROCESSING: "Bridging",
  SUCCESS: "Delivered",
  REFUNDED: "Refunded",
  FAILED: "Failed",
};

function PaymentRow({ f, c }: { f: PaymentFollowUp; c: RowContext }) {
  const { h } = c;
  const paying = useDeferred(graceId("pay", c.meetingId, f.id));
  const confirming = useDeferred(graceId("claim", c.meetingId, f.id));
  const pending = paying ?? confirming;
  const paidNow = useChanged(f.status);
  const [held, setHeld] = useState(false);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [amountText, setAmountText] = useState(f.amount === null ? "" : formatUsdc(f.amount).replace(/,/g, ""));
  const parsed = parseUsdcInput(amountText);
  const route = f.payeeListed ? (h.routeFor?.(f) ?? null) : null;
  const first = firstName(f.payeeName);
  const amount = f.amount === null ? null : formatUsdc(f.amount);
  const amountId = `amount-${c.meetingId}-${f.id}`;
  // The per-payment cap holds for every payment, approved here or by autopilot, so say before Approve when it (or today's cap) won't let this through.
  const crossed = c.limits && f.amount !== null ? capsCrossed(f.amount, c.limits) : null;
  const overWhat = !crossed
    ? null
    : crossed.perPayment && crossed.today
      ? "your per-payment cap and what's left today"
      : crossed.perPayment
        ? `your per-payment cap of ${formatUsdc(c.limits!.perPaymentCap)} USDC`
        : crossed.today
          ? "what's left today"
          : null;
  const overNote = overWhat && `Over ${overWhat}, so ${route ? `paying on ${CHAIN_NAME[route.chain]} would be refused` : "it will wait for your wallet after you approve"}.`;

  const pay = () =>
    deferred({
      id: graceId("pay", c.meetingId, f.id),
      quiet: true,
      ms: GRACE_MS,
      text: (s) => `Paying ${f.payeeName}${amount ? ` ${amount} USDC` : ""} in ${s}…`,
      run: () => h.onApprove(f.id),
    });
  const confirmClaim = () =>
    deferred({
      id: graceId("claim", c.meetingId, f.id),
      quiet: true,
      ms: GRACE_MS,
      text: (s) => `Opening your wallet to add ${f.claim?.account ?? f.payeeName} in ${s}…`,
      run: () => h.onConfirmClaim(f.id),
    });

  if (f.status === "blocked") {
    return (
      <Card pad="none" tone="caution" className="px-5 py-3.5">
        <Head
          name={f.payeeName}
          title={
            <>
              Pay {f.payeeName} <span className="font-mono font-medium">{amount ?? "?"} USDC</span>
            </>
          }
          sub={<span className="text-caution">Over your caps. Only your wallet can approve it.</span>}
        >
          <Button className="border-caution text-caution hover:bg-transparent" onClick={() => h.onReviewBlocked(f.id)}>
            Review
          </Button>
        </Head>
      </Card>
    );
  }

  if (f.status === "failed" && !pending) {
    return (
      <Card pad="none" tone="record" className="px-5 py-3.5">
        <Head name={f.payeeName} title={`Payment to ${f.payeeName} didn't land`} sub={<span className="text-record">{f.error ?? "The transfer didn't go through."}</span>}>
          <Button variant="quiet" onClick={() => c.dismiss(f)}>
            Dismiss
          </Button>
          <Button className="border-record text-record hover:bg-transparent" onClick={pay} disabled={f.amount === null}>
            Try again
          </Button>
        </Head>
        {f.crossChain && (
          <div className="pt-2 pl-12">
            <CrossChainTrail c={f.crossChain} />
          </div>
        )}
      </Card>
    );
  }

  const paid = f.status === "paid";
  const shared = !f.payeeListed && !!f.claim?.account;
  const waitingClaim = !f.payeeListed && !!f.claim && !f.claim.account;
  const state = pending ? "countdown" : f.status === "sending" ? "sending" : paid ? "paid" : f.autopilotAt ? "autopilot" : "open";

  const title = paid ? (
    `Paid ${f.payeeName}`
  ) : shared && state === "open" ? (
    <>
      {first} shared <span className="font-mono font-medium">{f.claim!.account}</span>
    </>
  ) : (
    `${state === "open" || state === "autopilot" ? "Pay" : "Paying"} ${f.payeeName}`
  );

  let sub: ReactNode;
  if (paid && f.byAutopilot) sub = "By autopilot · every rule passed";
  else if (paid && f.crossChain) sub = `Paid on ${CHAIN_NAME[f.crossChain.chain]} · ${shortAddress(f.crossChain.address)}`;
  else if (shared) sub = `Confirm in your wallet that this account is ${first}’s, then the payment can go.`;
  else if (!f.payeeListed) sub = <span className="text-caution">Not on your payee list yet. A claim link lets {first} tell you where to be paid.</span>;
  else if (route && !paid) sub = <span className="font-mono">{`To ${CHAIN_NAME[route.chain]} · ${shortAddress(route.address)}`}</span>;
  else sub = <span className="font-mono">{f.payeeAccount}</span>;

  return (
    <Card pad="none" className={cx("lift px-5", paid ? "py-3.5" : "py-[18px]")}>
      <Head name={f.payeeName} title={title} sub={sub}>
        {paid ? (
          <DonePill play={paidNow}>
            {amount && (
              <m.span layoutId={amountId} transition={springs.bouncy} className="font-mono font-medium">
                {amount} USDC
              </m.span>
            )}
            paid {f.doneAt}
          </DonePill>
        ) : (
          <span className="inline-flex shrink-0 items-baseline gap-1.5">
            <m.span layoutId={amountId} transition={springs.bouncy} className={cx("t-figure", amount === null && "text-caution")}>
              {amount ?? "?"}
            </m.span>
            <span className="text-[12px] text-muted">USDC</span>
          </span>
        )}
      </Head>
      <AnimatePresence initial={false} mode="wait">
        {state === "countdown" && pending && (
          <Body key="countdown">
            <Countdown verb={confirming ? "Opening your wallet" : "Paying"} startedAt={pending.startedAt} endsAt={pending.endsAt} onUndo={pending.cancel} />
          </Body>
        )}
        {state === "sending" && (
          <Body key="sending" className="flex-row items-center gap-2.5 text-ink-2">
            <Spinner size={14} />
            {f.crossChain ? `${swapWords[f.crossChain.swapStatus] ?? f.crossChain.swapStatus} · ${routeLabel(f.crossChain.chain)}` : "Sending through your agent wallet on NEAR…"}
          </Body>
        )}
        {state === "paid" && (
          <Body key="paid" className="gap-1.5 pt-2 text-[13px] text-ink-2">
            <span className="flex flex-wrap items-center gap-x-1.5">
              <span>From your agent wallet</span>
              {c.limits && !f.crossChain && <span>· {formatUsdc(c.limits.leftToday)} left today</span>}
              {f.ref && (
                <>
                  <span aria-hidden="true">·</span>
                  <TxLink hash={f.ref} network={c.network} />
                </>
              )}
            </span>
            {f.crossChain && <CrossChainTrail c={f.crossChain} />}
          </Body>
        )}
        {state === "autopilot" && f.autopilotAt && (
          <Body key="autopilot">
            <AutopilotLine
              at={f.autopilotAt}
              verb="Paying"
              why="every rule passed"
              onUndo={() => {
                setHeld(true);
                h.onUndoAutopilot(f.id);
              }}
            />
          </Body>
        )}
        {state === "open" && (
          <Body key="open">
            {held && <span className="text-[13px] text-ink-2">Autopilot stopped. This payment waits for you.</span>}
            {!held && f.autopilotHeld && f.status === "proposed" && <HeldNote />}
            <EvidenceQuote quote={f.evidence.quote} at={f.evidence.at} returnId={`jump-${f.id}`} onJumpTo={h.onJumpTo} />
            <dl className="m-0 flex flex-col gap-1.5 rounded-[10px] bg-well px-3.5 py-3">
              <div className="flex items-baseline gap-2.5">
                <dt className="w-14 shrink-0 text-[12px] text-muted">Heard</dt>
                <dd className="m-0">
                  <span className="font-serif italic">“{f.heard}”</span> <span className="text-muted">→</span>{" "}
                  {amount === null ? <span className="text-caution">{missingAmount(f)}</span> : <span className="t-mono">{amount} USDC</span>}
                  {amount === null && amountNote(f) && <span className="mt-0.5 block text-[13px] leading-[19px] text-ink-2">{amountNote(f)}</span>}
                </dd>
              </div>
              <div className="flex items-baseline gap-2.5">
                <dt className="w-14 shrink-0 text-[12px] text-muted">Payee</dt>
                <dd className="m-0">
                  {f.payeeName} {f.payeeListed ? <span className="text-verdigris">· on your list</span> : <span className="text-caution">· not on your list</span>}
                </dd>
              </div>
              {f.payeeListed && c.limits && (
                <div className="flex items-baseline gap-2.5">
                  <dt className="w-14 shrink-0 text-[12px] text-muted">Today</dt>
                  <dd className="m-0">
                    <span className="t-mono">{formatUsdc(c.limits.leftToday)}</span> <span className="text-ink-2">left to pay today</span>
                    {overNote && <span className="mt-0.5 block text-[13px] leading-[19px] text-caution">{overNote}</span>}
                  </dd>
                </div>
              )}
            </dl>
            {route && f.amount !== null && h.previewRoute && <RoutePreview f={f} dest={route} preview={h.previewRoute} />}
            {editing && (
              <div className="flex items-center gap-2">
                <label htmlFor={`amount-${f.id}`} className="text-ink-2">
                  Amount
                </label>
                <Input id={`amount-${f.id}`} mono autoFocus value={amountText} onChange={(e) => setAmountText(e.target.value)} className="w-32" />
                <span className="text-muted">USDC</span>
                <Button
                  disabled={!parsed}
                  onClick={() => {
                    if (parsed) h.onSetAmount(f.id, parsed);
                    setEditing(false);
                  }}
                >
                  Use amount
                </Button>
              </div>
            )}
            {waitingClaim && (
              <div className="flex flex-wrap items-center gap-3 rounded-[10px] px-3.5 py-2.5 shadow-[inset_0_0_0_1px_var(--hairline)]">
                <Spinner size={12} />
                <span className="flex-1 text-ink-2">Waiting for {first} to share where to be paid · the link works once, for 7 days</span>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Copy size={12} aria-hidden="true" />}
                  onClick={async () => {
                    await navigator.clipboard.writeText(f.claim!.link);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  }}
                >
                  {copied ? "Copied" : "Copy link"}
                </Button>
              </div>
            )}
            {f.error && <p className="selectable m-0 text-record">{f.error}</p>}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <WhatLeavesNote w={paymentWhatLeaves(f, { route, claimLinks: HAS_BACKEND })} />
              <span className="ml-auto flex flex-wrap justify-end gap-2">
                <Button variant="quiet" onClick={() => c.dismiss(f)}>
                  Dismiss
                </Button>
                {!shared && <Button onClick={() => setEditing((e) => !e)}>{f.amount === null ? "Enter amount" : "Edit amount"}</Button>}
                {f.payeeListed ? (
                  <Button variant="primary" onClick={pay} disabled={f.amount === null}>
                    Approve payment
                  </Button>
                ) : shared ? (
                  <Button variant="primary" onClick={confirmClaim}>
                    Confirm in wallet
                  </Button>
                ) : (
                  !f.claim &&
                  HAS_BACKEND && (
                    <Button onClick={() => h.onClaimLink(f.id)} disabled={f.amount === null} icon={<Link2 size={13} aria-hidden="true" />}>
                      Send claim link
                    </Button>
                  )
                )}
              </span>
            </div>
          </Body>
        )}
      </AnimatePresence>
    </Card>
  );
}

/** The route and a dry quote, so the person sees what the payee gets before approving. */
function RoutePreview({ f, dest, preview }: { f: PaymentFollowUp; dest: PayeeDestination; preview: (f: PaymentFollowUp, d: PayeeDestination) => Promise<PayoutPreview> }) {
  const [quote, setQuote] = useState<PayoutPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setQuote(null);
    setError(null);
    preview(f, dest)
      .then((q) => live && setQuote(q))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
    // Re-quote when the amount or the destination changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.amount, dest.chain, dest.address]);
  return (
    <div className="flex flex-col gap-1 rounded-[10px] bg-well px-3 py-2.5 text-[13px]">
      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="text-ink-2">USDC on NEAR</span>
        <span aria-hidden="true" className="text-faint">
          →
        </span>
        <span className="text-ink-2">USDC on {CHAIN_NAME[dest.chain]}, via NEAR Intents</span>
        <span className="ml-auto text-ink-2">
          {quote ? (
            <>
              {firstName(f.payeeName)} gets <span className="font-mono text-ink">{formatUsdc(quote.amountOut)}</span> · fee{" "}
              <span className="font-mono text-ink">{formatUsdc(quote.fee)}</span> · about {quote.seconds} s
            </>
          ) : error ? (
            <span className="text-caution">{error}</span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <Spinner size={10} /> Asking NEAR Intents for a quote…
            </span>
          )}
        </span>
      </span>
      <span className="selectable font-mono text-[12px] break-all text-muted">To {dest.address} · quote from NEAR Intents, not checked on chain</span>
    </div>
  );
}

function CrossChainTrail({ c }: { c: NonNullable<PaymentFollowUp["crossChain"]> }) {
  return (
    <p className="m-0 text-[13px] text-ink-2">
      {routeLabel(c.chain)} · {swapWords[c.swapStatus] ?? c.swapStatus}
      {c.payoutTxUrl && (
        <>
          {" · "}
          <button type="button" onClick={() => openUrl(c.payoutTxUrl!)} className="font-semibold text-verdigris hover:text-verdigris-hover">
            {CHAIN_NAME[c.chain]} transaction
          </button>
        </>
      )}
    </p>
  );
}
