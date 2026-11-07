import { useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import {
  buildPeople,
  clockTime,
  dueLabel,
  firstName,
  formatClock,
  formatUsdc,
  meetingTime,
  openCount,
  parseDue,
  relativeDay,
  type Meeting,
  type PersonDecision,
  type PersonItem,
  type PersonPayment,
} from "@aftercall/core";
import { Avatar, AvatarStack, Button, Pill, RollingNumber, SectionTitle, Strike, Tick, cx, type PillTone } from "./ui";
import { QuoteReveal, useQuoteReveal } from "./Quote";
import { Empty, Footnote, Page, PageHeader, Why, rise } from "./PagePieces";
import { minutes, plural } from "./library";

/** "Today 14:02" for today's meetings, "28 Oct" for older ones. */
export function meetingWhen(m: Meeting, now: number): string {
  const t = meetingTime(m, now);
  if (t === null) return m.startedAt;
  const day = relativeDay(t, now);
  return day === "today" ? `Today ${clockTime(t)}` : day === "yesterday" ? "Yesterday" : day;
}

/** "today", "yesterday", "28 Oct", or the meeting's own label when it has no date. */
export function meetingDay(m: Meeting, now: number): string {
  const t = meetingTime(m, now);
  return t === null ? m.startedAt : relativeDay(t, now);
}

/** Where a payment stands, as a pill tone and word. */
export const PAY_STATUS: Record<PersonPayment["status"], [PillTone, string]> = {
  proposed: ["muted", "To approve"],
  sending: ["muted", "Sending"],
  sent: ["verdigris", "Sent"],
  paid: ["verdigris", "Paid"],
  failed: ["record", "Failed"],
  blocked: ["caution", "Blocked"],
  dismissed: ["muted", "Dismissed"],
};

/**
 * One person: what's open between you, the meetings you shared, decisions, payments
 * and, from calls with only them, what they said. All from the meetings on this Mac.
 */
export function PersonScreen({
  personId,
  meetings,
  me,
  sampleIds,
  onBack,
  onOpenMeeting,
  onToggleItem,
  onAsk,
}: {
  personId: string;
  meetings: Meeting[];
  me: readonly string[];
  /** Fictional meetings, labelled wherever they show. */
  sampleIds: ReadonlySet<string>;
  onBack: () => void;
  onOpenMeeting: (id: string, at?: number) => void;
  onToggleItem: (meetingId: string, itemId: string) => void;
  onAsk: (question: string) => void;
}) {
  const [now] = useState(() => Date.now());
  const index = useMemo(() => buildPeople(meetings, { me, now }), [meetings, me, now]);
  const p = index.byId[personId];
  const back = { label: "People", onClick: onBack };
  if (!p) {
    return (
      <Page>
        <PageHeader back={back} title="Not found" />
        <Empty title="This person isn't in your meetings any more">Their meetings may have been deleted from this Mac.</Empty>
      </Page>
    );
  }

  const first = firstName(p.name);
  const byId = Object.fromEntries(meetings.map((m) => [m.id, m]));
  const theirMeetings = p.meetingIds.map((id) => byId[id]).filter(Boolean);
  const projects = [...new Set(theirMeetings.map((m) => m.project))];
  const open = openCount(p.youOwe) + openCount(p.theyOwe);
  const metLine = p.invitedTo.length > 0 ? `Met ${p.invitedTo.length === 1 ? "once" : `${p.invitedTo.length} times`}` : `Named in ${plural(p.meetingIds.length, "meeting")}`;
  const meta = (id: string) => (byId[id] ? `${byId[id].title} · ${meetingDay(byId[id], now)}` : "");

  const via = p.sources.includes("calendar") ? "from your calendar" : p.email ? "from a recap" : p.account ? "on your payees" : "from what was said";

  return (
    <Page className="gap-9">
      <header className="flex flex-col gap-3.5" style={rise(0)}>
        <button type="button" onClick={onBack} className="t-eyebrow inline-flex items-center gap-1 self-start rounded-sm text-muted hover:text-ink">
          <ChevronLeft size={12} strokeWidth={2} aria-hidden="true" />
          People
        </button>
        <div className="flex items-center gap-5">
          <Avatar name={p.name} size={64} decorative />
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="t-display selectable m-0 text-ink">{p.name}</h1>
            <span className="flex flex-wrap items-baseline gap-x-1.5 text-ink-2">
              {p.email && <span className="t-mono selectable text-ink">{p.email}</span>}
              {!p.email && p.account && <span className="t-mono selectable text-ink">{p.account}</span>}
              <span>{via}</span>
              <span className="text-[13px] text-muted">
                · {metLine}
                {p.lastAt !== null && ` · last ${relativeDay(p.lastAt, now)}`}
              </span>
            </span>
          </div>
        </div>
      </header>

      <section aria-labelledby="ps-between" className="flex flex-col gap-3.5" style={rise(1)}>
        <SectionTitle
          id="ps-between"
          count={
            <>
              <RollingNumber value={open} /> open
            </>
          }
        >
          Between you
        </SectionTitle>
        <div className="grid grid-cols-2 gap-10">
          <ItemColumn
            title={`You owe ${first}`}
            avatar={<Avatar name="You" you size={22} decorative />}
            items={p.youOwe}
            empty={`Nothing of yours names ${first}.`}
            now={now}
            meetingsById={byId}
            meta={meta}
            onOpenMeeting={onOpenMeeting}
            onToggleItem={onToggleItem}
          />
          <ItemColumn
            title={`${first} owes you`}
            avatar={<Avatar name={p.name} size={22} decorative />}
            items={p.theyOwe}
            empty={`No action items owned by ${first}.`}
            now={now}
            meetingsById={byId}
            meta={meta}
            onOpenMeeting={onOpenMeeting}
            onToggleItem={onToggleItem}
          />
        </div>
      </section>

      <section aria-labelledby="ps-meet" className="flex flex-col gap-1.5" style={rise(2)}>
        <SectionTitle id="ps-meet" count={`${theirMeetings.length}${projects.length === 1 ? `, ${theirMeetings.length > 1 ? "all " : ""}in ${projects[0]}` : ""}`} className="mb-2">
          Meetings
        </SectionTitle>
        {theirMeetings.map((m) => {
          const faces = (index.byMeeting[m.id] ?? []).map((id) => index.byId[id]?.name).filter(Boolean);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onOpenMeeting(m.id)}
              className="press -mx-3 flex w-[calc(100%+24px)] items-center gap-4 rounded-[10px] p-3 text-left text-ink hover:bg-elevated"
            >
              <span className="flex w-[84px] shrink-0">
                <AvatarStack people={["You", ...(faces.length ? faces : [p.name])]} max={3} size={32} ring="raised" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-baseline gap-2.5">
                  <span className="t-title truncate">{m.title}</span>
                  <span className="shrink-0 text-[13px] text-muted">
                    {meetingWhen(m, now)} · {minutes(m.durationSec)}
                  </span>
                </span>
                {m.summary && <span className="truncate text-ink-2">{m.summary}</span>}
              </span>
              {sampleIds.has(m.id) ? (
                <Pill tone="muted">Sample</Pill>
              ) : (
                m.verified && (
                  <Pill tone="verdigris" icon={<ShieldCheck size={11} strokeWidth={2.2} />}>
                    Verified
                  </Pill>
                )
              )}
            </button>
          );
        })}
      </section>

      {p.decisions.length > 0 && (
        <section aria-labelledby="ps-dec" className="flex flex-col gap-2.5" style={rise(3)}>
          <SectionTitle id="ps-dec" count={p.decisions.length}>
            Decisions you made together
          </SectionTitle>
          <ol className="m-0 flex list-decimal flex-col gap-2 pl-[22px] font-serif marker:text-muted text-[18px] leading-7 text-ink">
            {p.decisions.map((d, i) => (
              <DecisionRow key={`${d.meetingId}-${i}`} decision={d} meta={meta(d.meetingId)} onOpenMeeting={onOpenMeeting} />
            ))}
          </ol>
        </section>
      )}

      {p.payments.length > 0 && (
        <section aria-labelledby="ps-pay" className="flex flex-col gap-2" style={rise(4)}>
          <SectionTitle id="ps-pay" count={p.payments.length}>
            Payments
          </SectionTitle>
          <ul className="m-0 flex list-none flex-col border-t border-hairline p-0">
            {p.payments.map((pay) => {
              const [tone, word] = PAY_STATUS[pay.status];
              return (
                <li key={`${pay.meetingId}-${pay.followUpId}`} className="flex items-center gap-3 border-b border-hairline py-3">
                  <span className="t-mono w-[120px] shrink-0 text-ink">{pay.amount === null ? "No amount" : `${formatUsdc(pay.amount)} USDC`}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">
                    {pay.proposedBy ? (
                      <>proposed by {pay.proposedBy}, not heard on the call</>
                    ) : (
                      <>
                        heard “<span className="selectable text-ink">{pay.heard}</span>”
                      </>
                    )}{" "}
                    · <MeetingLink onClick={() => onOpenMeeting(pay.meetingId)}>{meta(pay.meetingId)}</MeetingLink>
                  </span>
                  <Pill tone={tone}>{pay.status === "paid" && pay.doneAt ? `${word} ${pay.doneAt}` : word}</Pill>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="ps-said" className="flex flex-col gap-4" style={rise(5)}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <SectionTitle id="ps-said" count="from one-to-one calls">
            What {first} said
          </SectionTitle>
          <Why summary="Why only these calls?" className="max-w-[340px]">
            Your mic is You. The other side is {first} only when your calendar invited just {first}, so lines from bigger calls never show up here.
          </Why>
        </div>
        {p.quotes.length === 0 ? (
          <p className="m-0 text-ink-2">
            No calls with only {first} yet, so no lines are shown as {first}'s.
          </p>
        ) : (
          p.quotes.map((q) => (
            <div key={`${q.meetingId}-${q.at}`} className="flex flex-col items-start gap-1.5">
              <span className="inline-flex items-center gap-2 text-[12px] text-muted">
                <Avatar name={p.name} size={24} decorative />
                <span className="font-semibold text-ink-2">{first}</span>
                <span>{meta(q.meetingId)}</span>
                <button
                  type="button"
                  onClick={() => onOpenMeeting(q.meetingId, q.at)}
                  className="rounded-sm font-mono text-verdigris hover:text-verdigris-hover"
                  aria-label={`Open ${byId[q.meetingId]?.title ?? "the meeting"} at ${formatClock(q.at)}`}
                >
                  {formatClock(q.at)}
                </button>
              </span>
              <p className="selectable m-0 max-w-[78%] rounded-[18px_18px_18px_6px] bg-elevated px-4 py-3 font-serif text-[17px] leading-[26px] text-ink shadow-1">{q.text}</p>
            </div>
          ))
        )}
      </section>

      <AskAbout first={first} onAsk={onAsk} style={rise(6)} />

      <Footnote className="border-t border-hairline pt-[18px]" style={rise(7)}>
        {p.sources.includes("calendar")
          ? `${first}'s name comes from your calendar invite.`
          : p.account && !p.sources.includes("said")
            ? `${first} is on your payees as ${p.account}.`
            : `${first}'s name comes from what was said in your notes.`}{" "}
        Aftercall doesn't recognise voices.
      </Footnote>
    </Page>
  );
}

/** A decision made together, with the words behind it on hover or focus; ↵ opens them in the transcript. */
function DecisionRow({ decision: d, meta, onOpenMeeting }: { decision: PersonDecision; meta: string; onOpenMeeting: (id: string, at?: number) => void }) {
  const quoteId = useId();
  const reveal = useQuoteReveal(!!d.evidence);
  const ev = d.evidence;
  return (
    <li
      tabIndex={ev ? 0 : undefined}
      aria-describedby={ev ? quoteId : undefined}
      onKeyDown={(e) => {
        if (ev && e.key === "Enter" && e.target === e.currentTarget) {
          e.preventDefault();
          onOpenMeeting(d.meetingId, ev.at);
        }
      }}
      className="rounded-sm"
      {...reveal.bind}
    >
      <span className="flex items-baseline justify-between gap-4">
        <span className="selectable">{d.text}</span>
        <MeetingLink onClick={() => onOpenMeeting(d.meetingId)}>{meta}</MeetingLink>
      </span>
      {ev && <QuoteReveal evidence={ev} open={reveal.open} descId={quoteId} onJump={() => onOpenMeeting(d.meetingId, ev.at)} className="pr-40 pb-0.5" />}
    </li>
  );
}

function MeetingLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="shrink-0 rounded-sm font-sans text-[13px] leading-[18px] text-muted underline decoration-border underline-offset-[3px] hover:text-ink">
      {children}
    </button>
  );
}

function ItemColumn({
  title,
  avatar,
  items,
  empty,
  now,
  meetingsById,
  meta,
  onOpenMeeting,
  onToggleItem,
}: {
  title: string;
  avatar: ReactNode;
  items: PersonItem[];
  empty: string;
  now: number;
  meetingsById: Record<string, Meeting>;
  meta: (meetingId: string) => string;
  onOpenMeeting: (id: string, at?: number) => void;
  onToggleItem: (meetingId: string, itemId: string) => void;
}) {
  const sorted = [...items].sort((a, b) => Number(a.done) - Number(b.done));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="m-0 flex items-center gap-2 text-[14px] leading-5 font-semibold text-ink">
        {avatar}
        {title}{" "}
        <span className="font-medium text-muted">
          <RollingNumber value={openCount(items)} /> open
        </span>
      </h3>
      {sorted.length === 0 ? (
        <p className="m-0 border-t border-hairline pt-3 text-ink-2">{empty}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col border-t border-hairline p-0">
          {sorted.map((it) => {
            const m = meetingsById[it.meetingId];
            const due = it.done ? "" : dueLabel(parseDue(it.due, m ? meetingTime(m, now) : null), now) || it.due || "no date";
            return (
              <ItemRow
                key={`${it.meetingId}-${it.itemId}`}
                item={it}
                due={due}
                overdue={due.startsWith("Due ")}
                meta={meta(it.meetingId)}
                onOpen={() => onOpenMeeting(it.meetingId)}
                onJump={(at) => onOpenMeeting(it.meetingId, at)}
                onToggle={() => onToggleItem(it.meetingId, it.itemId)}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ItemRow({
  item,
  due,
  overdue,
  meta,
  onOpen,
  onJump,
  onToggle,
}: {
  item: PersonItem;
  due: string;
  overdue: boolean;
  meta: string;
  onOpen: () => void;
  /** Opens the meeting's transcript at the item's quote. */
  onJump: (at: number) => void;
  onToggle: () => void;
}) {
  const textId = useId();
  const quoteId = useId();
  const reveal = useQuoteReveal(!!item.evidence);
  return (
    <li className="flex items-start gap-3 border-b border-hairline py-3" {...reveal.bind}>
      <Tick checked={item.done} onChange={onToggle} aria-labelledby={textId} aria-describedby={item.evidence ? quoteId : undefined} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={textId} className="text-[15px] leading-[22px] text-ink">
          <Strike on={item.done}>{item.text}</Strike>
        </span>
        <span className="flex">
          <MeetingLink onClick={onOpen}>{meta}</MeetingLink>
        </span>
        {item.evidence && <QuoteReveal evidence={item.evidence} open={reveal.open} descId={quoteId} onJump={() => onJump(item.evidence!.at)} />}
      </span>
      {due && <span className={cx("text-[13px] leading-[22px] whitespace-nowrap", overdue ? "font-medium text-caution" : due === "no date" ? "text-muted" : "text-ink-2")}>{due}</span>}
    </li>
  );
}

function AskAbout({ first, onAsk, style }: { first: string; onAsk: (q: string) => void; style?: CSSProperties }) {
  const [q, setQ] = useState("");
  const id = useId();
  const submit = () => q.trim() && onAsk(q.trim());
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-2.5" style={style}>
      <SectionTitle id={`${id}-h`} count="across your meetings">
        Ask about {first}
      </SectionTitle>
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor={id} className="sr-only">
          Ask about {first}
        </label>
        <input
          id={id}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`What did ${first} ask me for?`}
          autoComplete="off"
          className="selectable h-[52px] w-full rounded-md border border-border bg-well pr-32 pl-4 text-[15px] text-ink outline-none placeholder:text-muted focus:border-verdigris focus:shadow-[0_0_0_1px_var(--verdigris)]"
        />
        <span aria-hidden="true" className="absolute inset-y-0 right-[82px] flex items-center font-mono text-[11px] text-muted">
          ⌘J
        </span>
        <Button type="submit" variant="primary" disabled={!q.trim()} className="absolute top-2 right-2">
          Ask
        </Button>
      </form>
      <Footnote lock>Only the excerpts needed leave this Mac</Footnote>
    </section>
  );
}
