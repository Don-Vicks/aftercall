import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Copy, Link2, Mail, Wallet } from "lucide-react";
import { formatClock, formatUsdc, type EmailFollowUp, type FollowUp, type PaymentFollowUp } from "@aftercall/core";
import { Button, Pill, SectionLabel, Spinner } from "./ui";
import { parseUsdcInput } from "./WalletScreen";

/** Everything a follow-up row can ask the app to do. */
export interface FollowUpHandlers {
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
  onJumpTo: (at: number, quote: string) => void;
  onReviewBlocked: (id: string) => void;
  onDraft: (id: string) => void;
  onSetEmail: (id: string, email: string) => void;
  onClaimLink: (id: string) => void;
  onConfirmClaim: (id: string) => void;
  onUndoAutopilot: (id: string) => void;
  /** The person corrects the amount; heard words stay as evidence. */
  onSetAmount: (id: string, amount: bigint) => void;
}

export function FollowUps({ followUps, leftToday, ...h }: { followUps: FollowUp[]; leftToday: bigint | null } & FollowUpHandlers) {
  const visible = followUps.filter((f) => f.status !== "dismissed");
  if (visible.length === 0) return null;
  return (
    <section aria-labelledby="fu" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <SectionLabel id="fu">Follow-ups</SectionLabel>
        <span className="text-muted">Nothing runs until you approve it</span>
      </div>
      <div className="flex flex-col overflow-hidden rounded-md shadow-[inset_0_0_0_1px_var(--hairline)]">
        {visible.map((f, i) => {
          const last = i === visible.length - 1;
          if (f.kind === "email") return <EmailRow key={f.id} f={f} last={last} h={h} />;
          if (f.status === "blocked") return <BlockedRow key={f.id} f={f} last={last} onReview={h.onReviewBlocked} />;
          return <PaymentRow key={f.id} f={f} last={last} h={h} leftToday={leftToday} />;
        })}
      </div>
    </section>
  );
}

function Row({ children, last, active }: { children: ReactNode; last: boolean; active?: boolean }) {
  return <div className={`flex flex-col gap-3.5 px-5 py-4 ${last ? "" : "border-b border-hairline"} ${active ? "bg-elevated py-[18px]" : ""}`}>{children}</div>;
}

/** "Sending by autopilot in 0:52 · Undo", counting down live. */
function AutopilotBar({ at, verb, onUndo }: { at: number; verb: string; onUndo: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((at - now) / 1000));
  return (
    <div className="ml-8 flex items-center justify-between gap-3 rounded-sm bg-verdigris-tint px-3 py-2.5">
      <span>
        {verb} by autopilot in <span className="font-mono text-xs">{formatClock(left).replace(/^0/, "")}</span>
        <span className="text-muted"> · every rule passed</span>
      </span>
      <Button onClick={onUndo}>Undo</Button>
    </div>
  );
}

function EvidenceQuote({ quote, at, onJumpTo }: { quote: string; at: number; onJumpTo: (at: number, quote: string) => void }) {
  return (
    <p className="t-quote selectable m-0 pl-8 text-muted">
      “{quote}”{" "}
      <button onClick={() => onJumpTo(at, quote)} className="font-sans text-xs font-semibold not-italic text-verdigris hover:text-verdigris-hover">
        at {formatClock(at)}
      </button>
    </p>
  );
}

function EmailRow({ f, last, h }: { f: EmailFollowUp; last: boolean; h: FollowUpHandlers }) {
  const proposed = f.status === "proposed" || f.status === "failed";
  const [email, setEmail] = useState("");
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  return (
    <Row last={last} active={proposed}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Mail size={16} strokeWidth={1.5} className="text-faint" aria-hidden="true" />
        <div className="flex min-w-[260px] flex-1 flex-col gap-0.5">
          <span className="t-title">Recap to {f.toName || "someone"}</span>
          <span className="text-muted">
            {f.to || <span className="text-caution">No address yet</span>} · “{f.subject}”
          </span>
        </div>
        {f.status === "sent" && <Pill tone="verdigris">Sent {f.doneAt}</Pill>}
        {f.status === "sending" && <Pill tone="muted" icon={<Spinner size={10} />}>Sending</Pill>}
      </div>
      {proposed && (
        <>
          <EvidenceQuote quote={f.evidence.quote} at={f.evidence.at} onJumpTo={h.onJumpTo} />
          {f.autopilotAt && <AutopilotBar at={f.autopilotAt} verb="Sending" onUndo={() => h.onUndoAutopilot(f.id)} />}
          {!f.to && (
            <div className="ml-8 flex gap-2">
              <label htmlFor={`email-${f.id}`} className="sr-only">
                Email address for {f.toName}
              </label>
              <input
                id={`email-${f.id}`}
                value={email}
                onChange={(e) => setEmail(e.target.value.trim())}
                placeholder={`${(f.toName || "their").toLowerCase()}@example.com`}
                className="selectable h-8 flex-1 rounded-sm border border-border bg-well px-2.5 text-ink outline-none placeholder:text-muted"
              />
              <Button disabled={!valid} onClick={() => h.onSetEmail(f.id, email)}>Use address</Button>
            </div>
          )}
          {f.error && <p className="m-0 pl-8 text-record">{f.error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="pl-8 text-muted">Draft in Mail never leaves your Mac.</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => h.onDismiss(f.id)}>Dismiss</Button>
              <Button onClick={() => h.onDraft(f.id)}>Draft in Mail</Button>
              <Button variant="primary" onClick={() => h.onApprove(f.id)} disabled={!f.to}>
                Approve and send
              </Button>
            </div>
          </div>
        </>
      )}
    </Row>
  );
}

const payVerb: Partial<Record<PaymentFollowUp["status"], string>> = { sending: "Paying", paid: "Paid" };

function PaymentRow({ f, last, h, leftToday }: { f: PaymentFollowUp; last: boolean; h: FollowUpHandlers; leftToday: bigint | null }) {
  const proposed = f.status === "proposed" || f.status === "failed";
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [amountText, setAmountText] = useState(f.amount === null ? "" : formatUsdc(f.amount).replace(/,/g, ""));
  const parsed = parseUsdcInput(amountText);
  return (
    <Row last={last} active={proposed}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Wallet size={16} strokeWidth={1.5} className="text-muted" aria-hidden="true" />
        <div className="flex min-w-[260px] flex-1 flex-col gap-0.5">
          <span className="t-title">
            {payVerb[f.status] ?? "Pay"} {f.payeeName}
          </span>
          {f.payeeListed ? (
            <span className="t-mono text-muted">
              {f.payeeAccount}
              {proposed && leftToday !== null && ` · ${formatUsdc(leftToday)} left today`}
            </span>
          ) : (
            <span className="text-caution">{f.payeeName} isn't on your payee list yet, so Aftercall won't guess an account.</span>
          )}
        </div>
        {f.status === "sending" && <Pill tone="muted" icon={<Spinner size={10} />}>Sending</Pill>}
        {f.status === "paid" && <Pill tone="verdigris" icon={<Check size={11} strokeWidth={2.5} />}>Paid {f.doneAt}</Pill>}
        {f.status === "failed" && <Pill tone="record">Failed · refunded</Pill>}
        {proposed && (
          <span className="font-mono text-xl leading-6 tracking-[-0.01em]">
            {f.amount === null ? <span className="text-caution">?</span> : formatUsdc(f.amount)} <span className="text-xs text-muted">USDC</span>
          </span>
        )}
      </div>
      {proposed && (
        <>
          <EvidenceQuote quote={f.evidence.quote} at={f.evidence.at} onJumpTo={h.onJumpTo} />
          <div className="ml-8 flex flex-wrap gap-x-4 gap-y-1.5 rounded-sm bg-well px-3 py-2.5">
            <span className="t-label leading-[19px] text-muted">Check before you approve</span>
            <span>
              Heard <span className="font-serif italic">“{f.heard}”</span> →{" "}
              {f.amount === null ? <span className="text-caution">amount unclear, edit before approving</span> : <span className="t-mono">{formatUsdc(f.amount)} USDC</span>}
            </span>
            <span>
              Payee <span className="font-semibold">{f.payeeName}</span>{" "}
              {f.payeeListed ? <span className="text-verdigris">· on your list</span> : <span className="text-caution">· not on your list</span>}
            </span>
          </div>
          {editing && (
            <div className="ml-8 flex items-center gap-2">
              <label htmlFor={`amount-${f.id}`} className="text-muted">Amount</label>
              <input
                id={`amount-${f.id}`}
                autoFocus
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                className="selectable h-8 w-32 rounded-sm border border-border bg-well px-2.5 font-mono text-xs text-ink outline-none"
              />
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
          {f.autopilotAt && <AutopilotBar at={f.autopilotAt} verb="Paying" onUndo={() => h.onUndoAutopilot(f.id)} />}
          {f.error && <p className="m-0 pl-8 text-record">{f.error}</p>}

          {!f.payeeListed && f.claim && (
            <div className="ml-8 flex flex-wrap items-center gap-3 rounded-sm px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--hairline)]">
              {f.claim.account ? (
                <>
                  <span className="flex-1">
                    {f.payeeName} shared <span className="t-mono text-ink">{f.claim.account}</span>. Only confirm if you trust this account.
                  </span>
                  <Button className="border-caution text-caution" onClick={() => h.onConfirmClaim(f.id)}>Confirm in wallet</Button>
                </>
              ) : (
                <>
                  <Spinner size={12} />
                  <span className="flex-1 text-muted">Waiting for {f.payeeName} to share where to be paid · link works once, 7 days</span>
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(f.claim!.link);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1600);
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-verdigris"
                  >
                    <Copy size={12} aria-hidden="true" /> {copied ? "Copied" : "Copy link"}
                  </button>
                </>
              )}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => h.onDismiss(f.id)}>Dismiss</Button>
            <Button onClick={() => setEditing((e) => !e)}>Edit amount</Button>
            {f.payeeListed ? (
              <Button variant="primary" onClick={() => h.onApprove(f.id)} disabled={f.amount === null}>
                {f.status === "failed" ? "Try again" : "Approve payment"}
              </Button>
            ) : (
              !f.claim && (
                <Button variant="primary" onClick={() => h.onClaimLink(f.id)} disabled={f.amount === null}>
                  <Link2 size={13} aria-hidden="true" /> Send claim link
                </Button>
              )
            )}
          </div>
        </>
      )}
    </Row>
  );
}

function BlockedRow({ f, last, onReview }: { f: PaymentFollowUp; last: boolean; onReview: (id: string) => void }) {
  return (
    <Row last={last}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <AlertTriangle size={16} strokeWidth={1.5} className="text-caution" aria-hidden="true" />
        <div className="flex min-w-[260px] flex-1 flex-col gap-0.5">
          <span className="t-title">
            Pay {f.payeeName} <span className="font-mono text-[13px] font-normal">{f.amount === null ? "?" : formatUsdc(f.amount)} USDC</span>
          </span>
          <span className="text-caution">Over your limits. Your agent wallet refused it; only you can approve it, in your wallet.</span>
        </div>
        <Pill tone="caution">Blocked</Pill>
        <button onClick={() => onReview(f.id)} className="font-semibold text-verdigris hover:text-verdigris-hover">
          Review
        </button>
      </div>
    </Row>
  );
}
