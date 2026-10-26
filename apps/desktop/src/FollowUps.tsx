import type { ReactNode } from "react";
import { AlertTriangle, Check, Mail, Wallet } from "lucide-react";
import { formatClock, formatUsdc, type EmailFollowUp, type FollowUp, type PaymentFollowUp } from "@aftercall/core";
import { dailyCap, spentToday } from "./sample";
import { Button, Pill, SectionLabel, Spinner } from "./ui";

export function FollowUps({
  followUps,
  onApprove,
  onDismiss,
  onJumpTo,
  onReviewBlocked,
}: {
  followUps: FollowUp[];
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
  onJumpTo: (at: number, quote: string) => void;
  onReviewBlocked: (id: string) => void;
}) {
  const visible = followUps.filter((f) => f.status !== "dismissed");
  return (
    <section aria-labelledby="fu" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <SectionLabel id="fu">Follow-ups</SectionLabel>
        <span className="text-muted">Nothing runs until you approve it</span>
      </div>
      <div className="flex flex-col overflow-hidden rounded-md shadow-[inset_0_0_0_1px_var(--hairline)]">
        {visible.map((f, i) => {
          const last = i === visible.length - 1;
          if (f.kind === "email") return <EmailRow key={f.id} f={f} last={last} onApprove={onApprove} onDismiss={onDismiss} onJumpTo={onJumpTo} />;
          if (f.status === "blocked") return <BlockedRow key={f.id} f={f} last={last} onReview={onReviewBlocked} />;
          return <PaymentRow key={f.id} f={f} last={last} onApprove={onApprove} onDismiss={onDismiss} onJumpTo={onJumpTo} />;
        })}
      </div>
    </section>
  );
}

function Row({ children, last, active }: { children: ReactNode; last: boolean; active?: boolean }) {
  return (
    <div className={`flex flex-col gap-3.5 px-5 py-4 ${last ? "" : "border-b border-hairline"} ${active ? "bg-elevated py-[18px]" : ""}`}>
      {children}
    </div>
  );
}

function EvidenceQuote({ quote, at, onJumpTo }: { quote: string; at: number; onJumpTo: (at: number, quote: string) => void }) {
  return (
    <p className="t-quote selectable m-0 pl-8 text-muted">
      “{quote}”{" "}
      <button
        onClick={() => onJumpTo(at, quote)}
        className="font-sans text-xs font-semibold not-italic text-verdigris hover:text-verdigris-hover"
      >
        at {formatClock(at)}
      </button>
    </p>
  );
}

function EmailRow({
  f,
  last,
  onApprove,
  onDismiss,
  onJumpTo,
}: {
  f: EmailFollowUp;
  last: boolean;
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
  onJumpTo: (at: number, quote: string) => void;
}) {
  const proposed = f.status === "proposed";
  return (
    <Row last={last} active={proposed}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Mail size={16} strokeWidth={1.5} className="text-faint" aria-hidden="true" />
        <div className="flex min-w-[260px] flex-1 flex-col gap-0.5">
          <span className="t-title">Recap to {f.toName}</span>
          <span className="text-muted">
            {f.to} · “{f.subject}”
          </span>
        </div>
        {f.status === "sent" && <Pill tone="verdigris">Sent {f.doneAt}</Pill>}
        {f.status === "sending" && <Pill tone="muted" icon={<Spinner size={10} />}>Sending</Pill>}
      </div>
      {proposed && (
        <>
          <EvidenceQuote quote={f.evidence.quote} at={f.evidence.at} onJumpTo={onJumpTo} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => onDismiss(f.id)}>Dismiss</Button>
            <Button>Draft in Mail</Button>
            <Button variant="primary" onClick={() => onApprove(f.id)}>Approve and send</Button>
          </div>
        </>
      )}
    </Row>
  );
}

const payVerb: Partial<Record<PaymentFollowUp["status"], string>> = { sending: "Paying", paid: "Paid" };

function PaymentRow({
  f,
  last,
  onApprove,
  onDismiss,
  onJumpTo,
}: {
  f: PaymentFollowUp;
  last: boolean;
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
  onJumpTo: (at: number, quote: string) => void;
}) {
  const proposed = f.status === "proposed";
  const leftToday = dailyCap - spentToday;
  return (
    <Row last={last} active={proposed}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Wallet size={16} strokeWidth={1.5} className="text-muted" aria-hidden="true" />
        <div className="flex min-w-[260px] flex-1 flex-col gap-0.5">
          <span className="t-title">{payVerb[f.status] ?? "Pay"} {f.payeeName}</span>
          <span className="t-mono text-muted">
            {f.payeeAccount}
            {proposed && ` · ${formatUsdc(leftToday)} left today`}
          </span>
        </div>
        {f.status === "sending" && <Pill tone="muted" icon={<Spinner size={10} />}>Sending</Pill>}
        {f.status === "paid" && <Pill tone="verdigris" icon={<Check size={11} strokeWidth={2.5} />}>Paid {f.doneAt}</Pill>}
        {proposed && (
          <span className="font-mono text-xl leading-6 tracking-[-0.01em]">
            {formatUsdc(f.amount)} <span className="text-xs text-muted">USDC</span>
          </span>
        )}
      </div>
      {proposed && (
        <>
          <EvidenceQuote quote={f.evidence.quote} at={f.evidence.at} onJumpTo={onJumpTo} />
          <div className="ml-8 flex flex-wrap gap-x-4 gap-y-1.5 rounded-sm bg-well px-3 py-2.5">
            <span className="t-label leading-[19px] text-muted">Check before you approve</span>
            <span>
              Heard <span className="font-serif italic">“{f.heard}”</span> →{" "}
              <span className="t-mono">{formatUsdc(f.amount)} USDC</span>
            </span>
            <span>
              Payee <span className="font-semibold">{f.payeeName}</span>{" "}
              {f.payeeListed ? <span className="text-verdigris">· on your list</span> : <span className="text-caution">· not on your list</span>}
            </span>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => onDismiss(f.id)}>Dismiss</Button>
            <Button>Edit</Button>
            <Button variant="primary" onClick={() => onApprove(f.id)} disabled={!f.payeeListed}>
              Approve payment
            </Button>
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
            Pay {f.payeeName} <span className="font-mono text-[13px] font-normal">{formatUsdc(f.amount)} USDC</span>
          </span>
          <span className="text-caution">Over today's cap. Your agent wallet refused it; only you can approve it, in your wallet.</span>
        </div>
        <Pill tone="caution">Blocked</Pill>
        <button onClick={() => onReview(f.id)} className="font-semibold text-verdigris hover:text-verdigris-hover">
          Review
        </button>
      </div>
    </Row>
  );
}
