import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  askMeetings,
  buildPeople,
  firstName,
  formatClock,
  formatUsdc,
  meetingTime,
  openCount,
  pickExcerpts,
  plainNearAiError,
  type AskAnswer,
  type AskResult,
  type Excerpt,
  type Meeting,
} from "@aftercall/core";
import { aboutCost } from "./costs";
import { isDesktop } from "./recorder";
import { nearAiKey, nearAiTransport } from "./nearai";
import { Avatar, Button, Pill, Spinner, Tooltip, cx } from "./ui";
import { Footnote, rise } from "./PagePieces";
import { plural } from "./library";
import { PAY_STATUS } from "./PersonScreen";

type Phase = "search" | "none" | "preview" | "nokey" | "attest" | "send" | "answer" | "done" | "error";

interface Turn {
  id: number;
  question: string;
  phase: Phase;
  excerpts: Excerpt[];
  meetings: number;
  answer?: AskAnswer;
  result?: AskResult;
  error?: string;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Questions this person's own meetings can answer, from what's in them. */
function suggestions(meetings: Meeting[], me: readonly string[]): string[] {
  const { people } = buildPeople(meetings, { me });
  const out: string[] = [];
  const owed = [...people].filter((p) => openCount(p.youOwe) > 0).sort((a, b) => openCount(b.youOwe) - openCount(a.youOwe))[0];
  if (owed) out.push(`What do I owe ${firstName(owed.name)}?`);
  const owing = [...people].filter((p) => openCount(p.theyOwe) > 0 && p !== owed).sort((a, b) => openCount(b.theyOwe) - openCount(a.theyOwe))[0];
  if (owing) out.push(`What did ${firstName(owing.name)} promise?`);
  const paid = meetings.filter((m) => m.followUps.some((f) => f.kind === "payment" && f.status === "paid"));
  const when = paid
    .map((m) => meetingTime(m))
    .filter((t): t is number => t !== null)
    .sort((a, b) => b - a)[0];
  if (when !== undefined) out.push(`Every payment I approved in ${MONTH_NAMES[new Date(when).getMonth()]}`);
  else if (meetings.some((m) => m.followUps.some((f) => f.kind === "payment" && f.status === "proposed"))) out.push("Which payments are waiting for me?");
  return out.slice(0, 3);
}

/**
 * Ask your meetings. The question is searched on this Mac; only the matching lines
 * (at most 8, each cut to 400 characters) go to NEAR AI, end-to-end encrypted to a
 * Qwen TEE whose attestation is checked first. The answer shows the quotes it came from.
 */
export function AskScreen({
  meetings,
  me,
  initialQuestion,
  onOpenMeeting,
  onOpenSettings,
}: {
  meetings: Meeting[];
  me: readonly string[];
  /** Asked once on open (from "Ask about Ada"). */
  initialQuestion?: string;
  onOpenMeeting: (id: string, at?: number) => void;
  onOpenSettings: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const askedInitial = useRef(false);
  const chips = useMemo(() => suggestions(meetings, me), [meetings, me]);
  // Busy until the signature is checked, so one question is in flight at a time.
  const busy = turns.some((t) => t.phase === "search" || t.phase === "attest" || t.phase === "send" || (t.phase === "answer" && !t.result));
  const inputId = useId();

  const patch = (id: number, p: Partial<Turn>) => setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...p } : t)));

  /** One question at a time, even if a chip is clicked twice before the screen updates. */
  const running = useRef(false);
  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || running.current) return;
    running.current = true;
    const id = ++seq.current;
    setDraft("");
    setTurns((all) => [...all, { id, question: q, phase: "search", excerpts: [], meetings: 0 }]);
    try {
      // The search is instant; the step stays on screen long enough to read.
      const picked = pickExcerpts(meetings, q, { me });
      await new Promise((r) => setTimeout(r, reducedMotion() ? 0 : 500));
      patch(id, { excerpts: picked.excerpts, meetings: picked.meetings });
      if (picked.excerpts.length === 0) return patch(id, { phase: "none" });
      if (!isDesktop) return patch(id, { phase: "preview" });
      if (!(await nearAiKey.has().catch(() => false))) return patch(id, { phase: "nokey" });
      const result = await askMeetings(
        nearAiTransport,
        { question: q, excerpts: picked.excerpts },
        {
          onStage: (s) => s !== "signature" && patch(id, { phase: s }),
          onAnswer: (answer) => patch(id, { phase: "answer", answer }),
        },
      );
      patch(id, { phase: "done", result, answer: result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      patch(id, message.includes("NO_NEARAI_KEY") ? { phase: "nokey" } : { phase: "error", error: plainNearAiError(e) });
    } finally {
      running.current = false;
    }
  };

  useEffect(() => {
    if (initialQuestion && !askedInitial.current) {
      askedInitial.current = true;
      ask(initialQuestion);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === "j") input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [turns.length]);

  const asked = new Set(turns.map((t) => t.question));
  const byId = Object.fromEntries(meetings.map((m) => [m.id, m]));

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 shrink-0 bg-raised" />
      <div className="mx-auto flex w-full max-w-[816px] flex-1 flex-col gap-6 px-12 pt-2">
        <header className="flex flex-col gap-1.5" style={rise(0)}>
          <span className="t-eyebrow text-muted">{plural(meetings.length, "meeting")} · searched on this Mac</span>
          <h1 className="t-display m-0 text-ink">Ask your meetings</h1>
          <p className="m-0 text-ink-2">Ask in plain words. Every answer shows the quotes it came from.</p>
        </header>

        {chips.length > 0 && (
          <div role="group" aria-label="Suggestions" className="flex flex-wrap gap-2" style={rise(1)}>
            {chips.map((c) => {
              const done = asked.has(c);
              return (
                <button
                  key={c}
                  type="button"
                  disabled={done || busy}
                  onClick={() => ask(c)}
                  className={cx(
                    "inline-flex h-8 items-center gap-1.5 rounded-full px-[13px] text-[13px] font-medium transition-opacity duration-(--dur-2)",
                    done ? "text-ink-2 shadow-[inset_0_0_0_1px_var(--hairline)]" : "press lift bg-elevated text-ink shadow-1",
                    busy && !done && "opacity-50",
                  )}
                >
                  {done && <Check size={13} strokeWidth={2.5} className="text-verdigris" aria-hidden="true" />}
                  {c}
                </button>
              );
            })}
          </div>
        )}

        <section aria-label="Conversation" className="flex flex-1 flex-col gap-9 pt-1">
          {meetings.length === 0 && <p className="t-reading m-0 text-ink-2">No meetings yet. Record one, then ask about it here.</p>}
          {turns.map((t) => (
            <TurnView key={t.id} turn={t} meetingsById={byId} onOpenMeeting={onOpenMeeting} onOpenSettings={onOpenSettings} />
          ))}
          <div ref={end} />
        </section>

        <form
          className="sticky bottom-0 mt-auto flex flex-col gap-2.5 bg-raised pt-4 pb-7"
          style={rise(3)}
          onSubmit={(e) => {
            e.preventDefault();
            ask(draft);
          }}
        >
          <div className="relative">
            <label htmlFor={inputId} className="sr-only">
              Ask your meetings
            </label>
            <input
              ref={input}
              id={inputId}
              autoFocus={!initialQuestion}
              autoComplete="off"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about a person, a promise or a payment"
              disabled={meetings.length === 0}
              className="selectable h-[52px] w-full rounded-md border border-border bg-well pr-32 pl-4 text-[15px] text-ink outline-none placeholder:text-muted focus:border-verdigris focus:shadow-[0_0_0_1px_var(--verdigris)] disabled:opacity-50"
            />
            <span aria-hidden="true" className="absolute inset-y-0 right-[82px] flex items-center font-mono text-[11px] text-muted">
              ⌘J
            </span>
            <Button type="submit" variant="primary" disabled={busy || !draft.trim()} className="absolute top-2 right-2">
              Ask
            </Button>
          </div>
          <Footnote lock>Only the excerpts needed leave this Mac</Footnote>
        </form>
      </div>
    </main>
  );
}

function Step({ busy, children, aside }: { busy: boolean; children: ReactNode; aside?: string }) {
  return (
    <li className="flex items-center gap-2.5 text-ink-2" style={{ animation: "ac-in 240ms var(--ease) both" }}>
      <span aria-hidden="true" className="inline-flex size-[18px] shrink-0 items-center justify-center">
        {busy ? (
          <Spinner size={14} />
        ) : (
          <svg width="18" height="18" viewBox="0 0 18 18">
            <circle cx="9" cy="9" r="9" fill="var(--verdigris-tint)" style={{ transformOrigin: "9px 9px", animation: "ac-fill 320ms cubic-bezier(.3,1.5,.5,1) both" }} />
            <path
              d="M5.2 9.3l2.5 2.5 5-5.3"
              fill="none"
              stroke="var(--verdigris)"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="14"
              style={{ animation: "ac-draw 240ms 120ms var(--ease) both" }}
            />
          </svg>
        )}
      </span>
      <span>{children}</span>
      {aside && <span className="text-[13px] text-muted">{aside}</span>}
    </li>
  );
}

function TurnView({
  turn: t,
  meetingsById,
  onOpenMeeting,
  onOpenSettings,
}: {
  turn: Turn;
  meetingsById: Record<string, Meeting>;
  onOpenMeeting: (id: string, at?: number) => void;
  onOpenSettings: () => void;
}) {
  const n = t.excerpts.length;
  const found = `${plural(n, "excerpt")} in ${plural(t.meetings, "meeting")}`;
  const sending = t.phase === "attest" || t.phase === "send";
  const answered = t.phase === "answer" || t.phase === "done" || !!t.answer;
  const words = useReveal(t.answer?.answer ?? "", answered);
  const revealed = !t.answer?.answer || words >= t.answer.answer.split(" ").length;

  return (
    <div className="flex flex-col gap-3.5" aria-live="polite">
      <div className="flex items-end justify-end gap-2" style={{ animation: "ac-in 280ms var(--ease) both" }}>
        <p className="selectable m-0 max-w-[78%] rounded-[18px_18px_6px_18px] bg-verdigris-tint px-4 py-2.5 text-[15px] leading-[22px] text-ink">{t.question}</p>
        <Avatar name="You" you size={24} />
      </div>

      {(t.phase === "search" || sending) && (
        <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
          <Step busy={t.phase === "search"} aside={t.phase === "search" ? undefined : found}>
            {t.phase === "search" ? "Searching your meetings on this Mac…" : "Searched your meetings on this Mac"}
          </Step>
          {sending && (
            <Step busy>{t.phase === "attest" ? `Checking the Qwen TEE's secure hardware before sending ${plural(n, "excerpt")}…` : `Sending ${plural(n, "excerpt")}, encrypted to the Qwen TEE…`}</Step>
          )}
        </ol>
      )}

      {t.phase === "none" && (
        <div className="flex flex-col gap-2.5" style={{ animation: "ac-in 280ms var(--ease) both" }}>
          <p className="t-reading m-0 text-ink">Nothing in your meetings matches that, so nothing left this Mac.</p>
          <Footnote lock>Searched on this Mac · no excerpts sent</Footnote>
        </div>
      )}

      {t.phase === "nokey" && (
        <div className="flex flex-col items-start gap-3" style={{ animation: "ac-in 280ms var(--ease) both" }}>
          <p className="t-reading m-0 text-ink">Found {found} on this Mac. To answer, Aftercall needs your NEAR AI key; nothing was sent.</p>
          <Button onClick={onOpenSettings}>Add your NEAR AI key</Button>
        </div>
      )}

      {t.phase === "preview" && (
        <div className="flex flex-col gap-3" style={{ animation: "ac-in 280ms var(--ease) both" }}>
          <p className="t-reading m-0 text-ink">
            Found {found}. This browser preview can't reach NEAR AI, so nothing was sent. In the Mac app, these lines go end-to-end encrypted to the attested Qwen model, which answers from them.
          </p>
          <div className="flex flex-col gap-2">
            {t.excerpts.map((e, i) => (
              <QuoteCard key={e.n} excerpt={e} quote={e.text} index={i} meeting={meetingsById[e.meetingId]} onOpen={() => onOpenMeeting(e.meetingId, e.at)} />
            ))}
          </div>
          <Footnote lock>Searched on this Mac · {plural(n, "excerpt")} would be sent</Footnote>
        </div>
      )}

      {t.phase === "error" && (
        <div className="flex flex-col gap-2.5" style={{ animation: "ac-in 280ms var(--ease) both" }}>
          <p role="alert" className="selectable m-0 text-[15px] leading-[22px] text-record">
            {t.error}
          </p>
          <Footnote lock>Searched on this Mac · {found}</Footnote>
        </div>
      )}

      {answered && t.answer && (
        <>
          {t.answer.answer ? (
            <p className="selectable m-0 font-serif text-[19px] leading-[29px] text-ink">
              {t.answer.answer.split(" ").slice(0, words).join(" ")}
              {!revealed && <span aria-hidden="true" className="ml-[3px] inline-block h-5 w-0.5 rounded-[1px] bg-verdigris align-[-3px]" />}
            </p>
          ) : (
            <p className="t-reading m-0 text-ink">The answer quoted words that aren't in your meetings, so it isn't shown.</p>
          )}
          {revealed && t.answer.quotes.length > 0 && (
            <div className="flex flex-col gap-2">
              {t.answer.quotes.map((q, i) => (
                <QuoteCard key={`${q.n}-${i}`} excerpt={q} quote={q.quote} index={i} meeting={meetingsById[q.meetingId]} onOpen={() => onOpenMeeting(q.meetingId, q.at)} />
              ))}
            </div>
          )}
          {revealed && <AnswerFooter result={t.result} sent={t.answer.sent} delay={t.answer.quotes.length * 90 + 80} />}
          {revealed && <AnswerMeta quotes={t.answer.quotes.length} dropped={t.answer.dropped} result={t.result} delay={t.answer.quotes.length * 90 + 120} />}
        </>
      )}
    </div>
  );
}

/** Words of the answer shown so far: one every 65 ms once it arrives (all at once with reduced motion). */
function useReveal(text: string, on: boolean): number {
  const total = text ? text.split(" ").length : 0;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!on || !total) return;
    if (reducedMotion()) return setShown(total);
    setShown(1);
    const t = setInterval(() => setShown((n) => (n >= total ? (clearInterval(t), n) : n + 1)), 65);
    return () => clearInterval(t);
  }, [on, total]);
  return shown;
}

function QuoteCard({ excerpt: e, quote, index, meeting, onOpen }: { excerpt: Excerpt; quote: string; index: number; meeting?: Meeting; onOpen: () => void }) {
  // A payment's own quote shows the amount and where the payment stands.
  const pay = meeting?.followUps.find((f) => f.kind === "payment" && f.evidence.at === e.at && f.status !== "dismissed");
  return (
    <div className="lift flex flex-col gap-1.5 rounded-md bg-elevated px-4 py-3 shadow-1" style={{ animation: `ac-in 280ms ${index * 90}ms var(--ease) both` }}>
      <div className="flex min-w-0 items-center gap-2 text-[13px] leading-[18px]">
        <Avatar name={e.who} you={e.speaker === "you"} size={22} decorative />
        <span className="font-semibold text-ink">{e.who}</span>
        <span className="truncate text-muted">
          {e.meeting} · {e.when}
        </span>
        <span className="font-mono text-[12px] text-muted">{formatClock(e.at)}</span>
        {pay?.kind === "payment" && pay.amount !== null && <span className="font-mono text-[12px] whitespace-nowrap text-ink">{formatUsdc(pay.amount)} USDC</span>}
        {pay?.kind === "payment" && (
          <Pill tone={PAY_STATUS[pay.status][0]} icon={pay.status === "paid" ? <Check size={11} strokeWidth={2.5} /> : undefined}>
            {PAY_STATUS[pay.status][1]}
            {pay.status === "paid" && pay.doneAt ? ` ${pay.doneAt}` : ""}
          </Pill>
        )}
        <button type="button" onClick={onOpen} className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-sm font-semibold text-verdigris hover:text-verdigris-hover">
          Open in transcript <ArrowRight size={12} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>
      <p className="selectable m-0 font-serif text-[17px] leading-[26px] text-ink italic">“{quote}”</p>
    </div>
  );
}

/**
 * "4 quotes checked, 1 dropped · about $0.0012, estimated": every quote the model gave
 * was looked for word for word; the ones not found aren't shown. No cost line when
 * NEAR AI didn't report the tokens.
 */
function AnswerMeta({ quotes, dropped, result, delay }: { quotes: number; dropped: number; result?: AskResult; delay: number }) {
  const checked = quotes + dropped;
  const cost = result ? aboutCost(result.cost) : null;
  if (checked === 0 && !cost) return null;
  return (
    <p className="m-0 -mt-1.5 pl-6 text-[12px] leading-4 text-muted" style={{ animation: `ac-in 280ms ${delay}ms var(--ease) both` }}>
      {checked > 0 && `${plural(checked, "quote")} checked, ${dropped === 0 ? "none" : dropped} dropped`}
      {checked > 0 && cost && " · "}
      {cost && `${cost}, estimated`}
    </p>
  );
}

function AnswerFooter({ result, sent, delay }: { result?: AskResult; sent: number; delay: number }) {
  const failed = result?.checks.filter((c) => !c.ok) ?? [];
  const details = result?.verified
    ? `${result.checks.length} checks passed: gateway and Qwen TEE attested, excerpts encrypted to that TEE, answer signed by it.`
    : `Failed: ${failed.map((c) => c.label).join(", ")}.`;
  return (
    <p className="m-0 flex flex-wrap items-center gap-2 text-[13px] leading-[18px] text-ink-2" style={{ animation: `ac-in 280ms ${delay}ms var(--ease) both` }}>
      <LockIcon />
      <span>
        Answered in NEAR AI secure hardware · {plural(sent, "excerpt")} sent, encrypted to the attested model
      </span>
      {!result ? (
        <Pill tone="muted" icon={<Spinner size={10} tone="current" />}>
          Checking signature
        </Pill>
      ) : result.verified ? (
        <Tooltip content={details}>
          <span tabIndex={0} className="rounded-full" style={{ animation: "ac-pop 420ms var(--ease) both" }}>
            <Pill tone="verdigris" icon={<ShieldCheck size={11} strokeWidth={2.2} />}>
              Verified
            </Pill>
            <span className="sr-only">{details}</span>
          </span>
        </Tooltip>
      ) : (
        <Tooltip content={details}>
          <span tabIndex={0} className="rounded-full">
            <Pill tone="caution" icon={<ShieldAlert size={11} strokeWidth={2.2} />}>
              Not verified
            </Pill>
            <span className="sr-only">{details}</span>
          </span>
        </Tooltip>
      )}
    </p>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-faint">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
