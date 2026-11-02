import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { ArrowRight, Check, KeyRound, Link2, Mic, ShieldCheck } from "lucide-react";
import { formatClock, formatUsdc, startsIn, type CalendarEvent, type FollowUp, type Meeting, type PaymentFollowUp } from "@aftercall/core";
import type { SavedRecording } from "./recorder";
import { recordingTitle } from "./RecordingScreen";
import { isDesktop } from "./recorder";
import { nearAiKey } from "./nearai";
import { near } from "./near";
import { calendar } from "./calendar";
import { MeetingRow, meetingRow, shortWhen } from "./MeetingRow";
import { Avatar, AvatarStack, Button, Card, LayoutMotion, Pill, RollingNumber, SectionTitle, Spinner, cx, deferred, enter, exit, springs, type DeferredHandle } from "./ui";
import { sampleScripts, type SampleScript } from "./sampleRecordings";

/** A recording in progress, for the live card. Wired by the live-recording work. */
export interface HomeLive {
  seconds: number;
  paused: boolean;
  /** The calendar event's title, when there is one. */
  title?: string;
  project?: string;
}

/** The approve handlers App already gives the meeting page, reused for rows on Home. */
export interface InlineHandlers {
  onApprove: (followUpId: string) => void;
  onDismiss: (followUpId: string) => void;
  /** Non-null when a payment goes out on another chain: that needs a fresh quote seen on the meeting page. */
  routeFor?: (f: PaymentFollowUp) => unknown;
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Sections rise in one after another (a fade with reduced motion). */
const rise = (i: number): CSSProperties => ({ animation: `ac-in 320ms var(--ease) ${i * 40}ms both` });

const hhmm = (unix: number) => new Date(unix * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function HomeScreen({
  meetings,
  recordings,
  sampleId,
  live,
  onOpenLive,
  onNewRecording,
  onOpenSample,
  onOpenMeeting,
  onOpenSettings,
  onOpenWallet,
  handlersFor,
}: {
  meetings: Meeting[];
  recordings: SavedRecording[];
  /** The built-in sample meeting, labelled wherever it shows. */
  sampleId?: string;
  /** While recording: a live card takes the Record card's place. */
  live?: HomeLive;
  onOpenLive?: () => void;
  onNewRecording: () => void;
  /** Opens a fictional sample call as a recording, to try the notes pipeline without a real call. */
  onOpenSample: (sampleId: string) => void;
  onOpenMeeting: (id: string) => void;
  onOpenSettings: () => void;
  onOpenWallet: () => void;
  handlersFor: (meeting: Meeting) => InlineHandlers;
}) {
  const [setup, setSetup] = useState<{ nearAi: boolean; near: boolean } | null>(null);
  const [upcoming, setUpcoming] = useState<CalendarEvent[]>([]);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!isDesktop) return setSetup({ nearAi: false, near: false });
    (async () => {
      const nearAi = await nearAiKey.has().catch(() => false);
      const connected = await near
        .getConfig()
        .then((c) => (c ? near.status().then((s) => s.registered && s.keyAdded) : false))
        .catch(() => false);
      setSetup({ nearAi, near: connected });
    })();
  }, []);

  // What's left on today's calendar, re-read every minute so "Starts in" stays true.
  useEffect(() => {
    const read = () => {
      setNow(Math.floor(Date.now() / 1000));
      calendar.upcoming(3).then(setUpcoming);
    };
    read();
    const t = setInterval(read, 60_000);
    return () => clearInterval(t);
  }, []);

  const today = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  const firstLaunch = recordings.length === 0 && !live;

  if (firstLaunch) {
    return (
      <Page>
        <header className="flex flex-col gap-1.5" style={rise(0)}>
          <span className="t-eyebrow text-muted">{today}</span>
          <h1 className="t-display m-0">Welcome. Let’s take your first notes.</h1>
          <p className="m-0 text-ink-2">Record a call, and your private notes and follow-ups land here.</p>
        </header>
        <RecordCard first onClick={onNewRecording} style={rise(1)} />
        <section aria-labelledby="h-samples" className="flex flex-col gap-3.5" style={rise(2)}>
          <div className="flex flex-col gap-1">
            <SectionTitle id="h-samples" count="Open a sample recording">
              No call handy?
            </SectionTitle>
            <p className="m-0 text-ink-2">Two short made-up calls, recorded like a real one. Make notes from them through NEAR AI.</p>
          </div>
          <div className="flex flex-wrap gap-3.5">
            {sampleScripts.map((s) => (
              <SampleCard key={s.id} script={s} onOpen={() => onOpenSample(s.id)} />
            ))}
          </div>
        </section>
        {setup && <SetupList setup={setup} onOpenSettings={onOpenSettings} style={rise(3)} />}
      </Page>
    );
  }

  const byId = new Map(meetings.map((mt) => [mt.id, mt]));
  const recent = [
    ...recordings.map((r) => meetingRow(r, byId.get(r.id))),
    ...meetings.filter((mt) => !recordings.some((r) => r.id === mt.id)).map((mt) => meetingRow(undefined, mt, { sample: mt.id === sampleId })),
  ].slice(0, 5);

  // "Every meeting this week verified": only when it's true of every meeting with notes since Monday.
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const thisWeek = recordings.filter((r) => r.startedAt * 1000 >= monday.getTime() && byId.has(r.id));
  const allVerified = thisWeek.length > 0 && thisWeek.every((r) => byId.get(r.id)?.verified);

  const nudge = setup && !setup.nearAi ? "nearAi" : setup && !setup.near ? "near" : null;
  let section = 0;

  return (
    <Page>
      <header className="flex flex-wrap items-end justify-between gap-6" style={rise(section++)}>
        <div className="flex flex-col gap-1.5">
          <span className="t-eyebrow text-muted">{today}</span>
          <h1 className="t-display m-0">{greeting()}</h1>
        </div>
        {allVerified && (
          <span className="flex items-center gap-2 text-[13px] text-ink-2">
            <ShieldCheck size={14} strokeWidth={2} className="text-verdigris" aria-hidden="true" />
            Every meeting this week verified
          </span>
        )}
      </header>

      {live ? <LiveCard live={live} onOpen={onOpenLive} style={rise(section++)} /> : <RecordCard onClick={onNewRecording} style={rise(section++)} />}

      {upcoming.length > 0 && <ComingUp events={upcoming} now={now} recording={Boolean(live)} onRecord={onNewRecording} style={rise(section++)} />}

      <NeedsYou meetings={meetings} recordings={recordings} sampleId={sampleId} handlersFor={handlersFor} onOpenMeeting={onOpenMeeting} onOpenWallet={onOpenWallet} style={rise(section++)} />

      {recent.length > 0 && (
        <section aria-labelledby="h-recent" className="flex flex-col gap-1.5" style={rise(section++)}>
          <SectionTitle id="h-recent" className="mb-2">
            Recent
          </SectionTitle>
          {recent.map((row) => (
            <MeetingRow key={row.id} row={row} onOpen={onOpenMeeting} />
          ))}
        </section>
      )}

      {nudge && (
        <div className="flex items-center gap-3.5 rounded-md px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--hairline)]" style={rise(section++)}>
          <span aria-hidden="true" className="inline-flex text-faint">
            {nudge === "nearAi" ? <KeyRound size={18} strokeWidth={1.75} /> : <Link2 size={18} strokeWidth={1.75} />}
          </span>
          <span className="flex-1 text-ink-2">
            {nudge === "nearAi" ? (
              <>
                <strong className="font-semibold text-ink">Connect NEAR AI</strong> so recordings become private notes, made in NEAR AI’s secure hardware.
              </>
            ) : (
              <>
                <strong className="font-semibold text-ink">Connect your NEAR account</strong> to record proofs and pay from your agent wallet.
              </>
            )}
          </span>
          <Button size="sm" onClick={onOpenSettings}>
            Connect
          </Button>
        </div>
      )}
    </Page>
  );
}

function Page({ children }: { children: ReactNode }) {
  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
      <div className="mx-auto flex max-w-[760px] flex-col gap-10 px-12 pt-5 pb-[72px]">{children}</div>
    </main>
  );
}

/** Looks like the Record button, inside a card that is itself the button. */
function StartLabel({ big }: { big?: boolean }) {
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-2 rounded-[10px] bg-record font-semibold text-white", big ? "h-10 px-4" : "h-[38px] px-3.5")}>
      <span aria-hidden="true" className="size-2 rounded-full bg-white" />
      Start
      <span className="font-mono text-[11px] font-normal opacity-80">⌘⇧R</span>
    </span>
  );
}

function RecordCard({ first, onClick, style }: { first?: boolean; onClick: () => void; style?: CSSProperties }) {
  return (
    <Card as="button" interactive pad="none" onClick={onClick} style={style} className={cx("flex w-full items-center", first ? "gap-[22px] p-7" : "gap-5 px-6 py-[22px]")}>
      <span aria-hidden="true" className={cx("inline-flex shrink-0 items-center justify-center rounded-full bg-record-tint text-record", first ? "size-[60px]" : "size-[52px]")}>
        <Mic size={first ? 26 : 22} strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cx("font-serif font-medium tracking-[-0.01em]", first ? "text-2xl leading-[30px]" : "t-heading")}>{first ? "Record your first meeting" : "Record a meeting"}</span>
        <span className="text-ink-2">
          {first ? "Start your call in any app, then press record. Let everyone know you’re taking notes." : "Start your call in any app, then press record."}
        </span>
      </span>
      <StartLabel big={first} />
    </Card>
  );
}

function LiveCard({ live, onOpen, style }: { live: HomeLive; onOpen?: () => void; style?: CSSProperties }) {
  return (
    <Card as="button" interactive pad="none" tone="record" onClick={onOpen} style={style} className="flex w-full items-center gap-5 px-6 py-[22px]">
      <span aria-hidden="true" className="inline-flex size-[52px] shrink-0 items-center justify-center rounded-full bg-raised">
        <span
          className="size-3 rounded-full"
          style={{ background: live.paused ? "var(--faint)" : "var(--record)", animation: live.paused ? undefined : "ac-breathe 2s ease-in-out infinite" }}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="t-heading">
          {live.paused ? "Paused" : "Recording"} <span className="font-mono text-[20px] tracking-[-0.01em] tabular-nums">{formatClock(live.seconds)}</span>
        </span>
        <span className="truncate text-ink-2">{live.title ? [live.title, live.project].filter(Boolean).join(" · ") : "Open it to pause, stop or write your notes."}</span>
      </span>
      <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-sm border border-border px-3.5 font-semibold text-ink">
        Open
        <ArrowRight size={14} aria-hidden="true" />
      </span>
    </Card>
  );
}

function ComingUp({ events, now, recording, onRecord, style }: { events: CalendarEvent[]; now: number; recording: boolean; onRecord: () => void; style?: CSSProperties }) {
  return (
    <section aria-labelledby="h-upcoming" className="flex flex-col gap-3.5" style={style}>
      <SectionTitle id="h-upcoming" count="from your calendar">
        Coming up
      </SectionTitle>
      <div className="flex flex-col">
        {events.map((e, i) => {
          const soon = startsIn(e, now);
          const people = e.attendees.map((a) => a.name || a.email).filter(Boolean);
          return (
            <div key={`${e.title}-${e.start}`} className="flex items-center gap-4 border-b border-hairline px-1 py-3.5">
              <span className={cx("w-[52px] shrink-0 font-mono text-[13px]", i === 0 ? "text-ink" : "text-ink-2")}>{hhmm(e.start)}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-semibold">{e.title || "Untitled event"}</span>
                <span className={cx("text-[13px]", soon ? "font-medium text-verdigris" : "text-muted")}>{soon ?? `Until ${hhmm(e.end)}`}</span>
              </span>
              {people.length > 0 && <AvatarStack people={people} max={3} size={28} ring="raised" />}
              {!recording && (
                <Button size="sm" variant={i === 0 && soon ? "primary" : "secondary"} onClick={onRecord} icon={<span aria-hidden="true" className="size-[7px] rounded-full bg-current" />}>
                  Record
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

type Need =
  | { key: string; kind: "followup"; meeting: Meeting; f: FollowUp; sample: boolean }
  | { key: string; kind: "notes"; recording: SavedRecording };

function needTitle(f: FollowUp): ReactNode {
  if (f.kind === "email") return <>Send the recap to {f.toName || f.to || "the group"}</>;
  return (
    <>
      Pay {f.payeeName}
      {f.amount !== null && <span className="font-mono font-medium"> {formatUsdc(f.amount)} USDC</span>}
    </>
  );
}

const needText = (f: FollowUp) => (f.kind === "email" ? `the recap to ${f.toName || f.to || "the group"}` : `${f.payeeName}${f.amount === null ? "" : ` ${formatUsdc(f.amount)} USDC`}`);

/**
 * What waits on you, approvable in place. Approve and Dismiss each wait 5 seconds
 * with Undo before they run (the same handlers as the meeting page). Payments that
 * need a closer look (another chain, no amount, payee not listed) open the meeting.
 */
function NeedsYou({
  meetings,
  recordings,
  sampleId,
  handlersFor,
  onOpenMeeting,
  onOpenWallet,
  style,
}: {
  meetings: Meeting[];
  recordings: SavedRecording[];
  sampleId?: string;
  handlersFor: (meeting: Meeting) => InlineHandlers;
  onOpenMeeting: (id: string) => void;
  onOpenWallet: () => void;
  style?: CSSProperties;
}) {
  // Rows close up as they leave, and the clear line opens; with reduced motion they only fade.
  const still = useReducedMotion();
  /** Rows whose Approve or Dismiss is waiting out its Undo. */
  const [held, setHeld] = useState<Record<string, "approve" | "dismiss">>({});
  const handles = useRef<Record<string, DeferredHandle>>({});
  const release = (key: string) =>
    setHeld((all) => {
      const { [key]: _gone, ...rest } = all;
      return rest;
    });

  const items: Need[] = [];
  for (const mt of meetings) {
    for (const f of mt.followUps) {
      if (f.status === "proposed" || f.status === "sending" || (f.status === "blocked" && f.kind === "payment")) {
        items.push({ key: `${mt.id}:${f.id}`, kind: "followup", meeting: mt, f, sample: mt.id === sampleId });
      }
    }
  }
  const order = (n: Need) => (n.kind === "notes" ? 2 : n.f.status === "blocked" ? 1 : 0);
  for (const r of recordings) if (!r.notes) items.push({ key: `notes:${r.id}`, kind: "notes", recording: r });
  const shown = items.filter((n) => held[n.key] !== "dismiss").sort((a, b) => order(a) - order(b));

  const approve = (n: Extract<Need, { kind: "followup" }>) => {
    const h = handlersFor(n.meeting);
    setHeld((all) => ({ ...all, [n.key]: "approve" }));
    handles.current[n.key] = deferred({
      id: `approve:${n.key}`,
      text: (s) => `${n.f.kind === "email" ? "Sending" : "Paying"} ${needText(n.f)} in ${s}…`,
      ms: 5000,
      run: () => {
        release(n.key);
        h.onApprove(n.f.id);
      },
      undo: () => release(n.key),
    });
  };
  const dismiss = (n: Extract<Need, { kind: "followup" }>) => {
    const h = handlersFor(n.meeting);
    setHeld((all) => ({ ...all, [n.key]: "dismiss" }));
    deferred({
      id: `dismiss:${n.key}`,
      text: `Dismissed ${n.f.kind === "email" ? needText(n.f) : `paying ${needText(n.f)}`}`,
      ms: 5000,
      run: () => {
        release(n.key);
        h.onDismiss(n.f.id);
      },
      undo: () => release(n.key),
    });
  };

  return (
    <section aria-labelledby="h-needs" className="flex flex-col gap-3.5" style={style}>
      <SectionTitle id="h-needs" count={shown.length ? <RollingNumber value={shown.length} /> : undefined}>
        Needs you
      </SectionTitle>
      <LayoutMotion>
        <div className="flex flex-col gap-2.5">
          {/* Not on first render: the clear line folds in only when the last item is handled here. */}
          <AnimatePresence initial={false}>
            {shown.length === 0 ? (
              <m.p
                key="clear"
                role="status"
                initial={{ opacity: 0, y: -6, scale: 0.97, height: still ? "auto" : 0 }}
                animate={{ opacity: 1, y: 0, scale: 1, height: "auto", transition: { ...springs.bouncy, height: springs.gentle, opacity: enter } }}
                exit={{ opacity: 0, transition: exit }}
                className="m-0 flex origin-top-left items-center gap-2 text-ink-2"
              >
                <Check size={14} strokeWidth={2.25} className="text-verdigris" aria-hidden="true" />
                <span>
                  <span className="font-semibold text-ink">Nothing needs you.</span> Follow-ups to approve show up here.
                </span>
              </m.p>
            ) : (
              shown.slice(0, 6).map((n) => (
                <m.div
                  key={n.key}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0, transition: springs.gentle }}
                  exit={{ opacity: 0, scale: 0.98, ...(still ? {} : { height: 0 }), transition: exit }}
                >
                  {n.kind === "notes" ? (
                    <NeedRow
                      avatar={
                        <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-well text-ink-2">
                          <Mic size={16} strokeWidth={1.75} />
                        </span>
                      }
                      title={recordingTitle(n.recording)}
                      detail={<span className="text-ink-2">Recorded {shortWhen(n.recording.startedAt)} · {n.recording.project}. Ready to make notes.</span>}
                    >
                      <Button size="sm" onClick={() => onOpenMeeting(n.recording.id)}>
                        Make notes
                      </Button>
                    </NeedRow>
                  ) : (
                    <FollowUpRow
                      need={n}
                      held={held[n.key] === "approve"}
                      approvable={approvable(n.f, handlersFor(n.meeting))}
                      onApprove={() => approve(n)}
                      onUndo={() => handles.current[n.key]?.cancel()}
                      onDismiss={() => dismiss(n)}
                      onOpen={() => (n.f.status === "blocked" && !n.sample ? onOpenWallet() : onOpenMeeting(n.meeting.id))}
                    />
                  )}
                </m.div>
              ))
            )}
          </AnimatePresence>
        </div>
      </LayoutMotion>
    </section>
  );
}

/** Approve from the row only when nothing more needs checking first. */
function approvable(f: FollowUp, h: InlineHandlers): boolean {
  if (f.autopilotAt) return false;
  if (f.kind === "email") return Boolean(f.to);
  return f.amount !== null && f.payeeListed && !h.routeFor?.(f);
}

function NeedRow({ avatar, title, detail, tone = "default", children }: { avatar: ReactNode; title: ReactNode; detail: ReactNode; tone?: "default" | "caution"; children: ReactNode }) {
  return (
    <Card pad="none" tone={tone} className="lift flex items-center gap-4 px-[18px] py-4">
      {avatar}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-semibold">{title}</span>
        <span className="truncate">{detail}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">{children}</span>
    </Card>
  );
}

function FollowUpRow({
  need,
  held,
  approvable,
  onApprove,
  onUndo,
  onDismiss,
  onOpen,
}: {
  need: Extract<Need, { kind: "followup" }>;
  held: boolean;
  approvable: boolean;
  onApprove: () => void;
  onUndo: () => void;
  onDismiss: () => void;
  onOpen: () => void;
}) {
  const { f, meeting, sample } = need;
  const where = `${meeting.title}${sample ? " · sample" : ""}`;
  const person = f.kind === "email" ? f.toName || f.to || "Recap" : f.payeeName;
  const avatar = <Avatar name={person} size={36} decorative />;

  if (f.status === "blocked") {
    return (
      <NeedRow tone="caution" avatar={avatar} title={needTitle(f)} detail={<span className="text-caution">Over your caps. Only your wallet can approve it.</span>}>
        <Pill tone="caution" className="bg-raised">
          Blocked
        </Pill>
        <Button size="sm" onClick={onOpen} className="ml-1.5 border-caution text-caution! hover:bg-raised!">
          Review
        </Button>
      </NeedRow>
    );
  }

  const detail = f.error ? (
    <span className="text-record">{f.error}</span>
  ) : f.autopilotAt ? (
    <span className="text-ink-2">Autopilot runs this soon · {where}</span>
  ) : f.autopilotHeld && f.status === "proposed" ? (
    <span className="text-ink-2">Autopilot held this for your approval · {where}</span>
  ) : (
    <span className="t-quote text-[14px] text-ink-2">
      “{f.evidence.quote}” <span className="font-sans not-italic">· {where}</span>
    </span>
  );

  return (
    <NeedRow avatar={avatar} title={needTitle(f)} detail={detail}>
      {f.status === "sending" ? (
        <span role="status" className="flex items-center gap-2 px-2 text-ink-2">
          <Spinner size={14} /> {f.kind === "email" ? "Sending…" : "Paying…"}
        </span>
      ) : held ? (
        <>
          <span className="px-2 text-ink-2">Approved</span>
          <Button size="sm" variant="ghost" onClick={onUndo}>
            Undo
          </Button>
        </>
      ) : approvable ? (
        <>
          <Button size="sm" variant="quiet" onClick={onDismiss}>
            Dismiss
          </Button>
          <Button size="sm" variant="primary" onClick={onApprove}>
            {f.error ? "Try again" : "Approve"}
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" variant="quiet" onClick={onDismiss}>
            Dismiss
          </Button>
          <Button size="sm" onClick={onOpen}>
            Review
          </Button>
        </>
      )}
    </NeedRow>
  );
}

/** Bars from the sample's script: verdigris while you speak, ink while they do. Decorative. */
function wave(script: SampleScript, bars = 48): { h: number; you: boolean }[] {
  let x = script.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return Array.from({ length: bars }, (_, i) => {
    x = (x * 9301 + 49297) % 233280;
    const t = ((i + 0.5) / bars) * script.seconds;
    const line = [...script.lines].reverse().find((l) => l.at <= t);
    return { h: Math.round(5 + (x / 233280) * 21), you: line?.speaker === "you" };
  });
}

function SampleCard({ script, onOpen }: { script: SampleScript; onOpen: () => void }) {
  const others = [...new Set(script.lines.filter((l) => l.speaker === "others").map((l) => l.name))];
  const first = others.map((n) => n.replace(/\(.*\)/, "").trim().split(/\s+/)[0]);
  const withWhom = first.length < 2 ? first.join("") : `${first.slice(0, -1).join(", ")} and ${first[first.length - 1]}`;
  return (
    <Card as="button" interactive pad="none" onClick={onOpen} className="flex min-w-[260px] flex-[1_1_280px] flex-col gap-3.5 px-5 py-[18px]">
      <span className="flex items-center justify-between gap-3">
        <span aria-hidden="true">
          <AvatarStack people={["You", ...others]} max={3} size={32} ring="elevated" />
        </span>
        <Pill tone="muted">Sample</Pill>
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="t-title">{script.title}</span>
        <span className="text-[13px] text-ink-2">
          With {withWhom} · <span className="font-mono">{Math.round(script.seconds)} s</span> · fictional
        </span>
      </span>
      <span aria-hidden="true" className="flex h-7 items-center gap-0.5">
        {wave(script).map((b, i) => (
          <span key={i} className={cx("max-w-1 flex-1 rounded-[2px]", b.you ? "bg-verdigris" : "bg-ink-2")} style={{ height: b.h }} />
        ))}
      </span>
      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-verdigris">
        Open sample <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
      </span>
    </Card>
  );
}

function SetupList({ setup, onOpenSettings, style }: { setup: { nearAi: boolean; near: boolean }; onOpenSettings: () => void; style?: CSSProperties }) {
  type Row = { id: string; icon: ReactNode; title: string; detail: string };
  const rows = ([
    !setup.nearAi && { id: "nearai", icon: <KeyRound size={16} strokeWidth={1.75} />, title: "Connect NEAR AI", detail: "So recordings become private notes, made in NEAR AI’s secure hardware." },
    !setup.near && {
      id: "near",
      icon: <Link2 size={16} strokeWidth={1.75} />,
      title: "Connect your NEAR account",
      detail: "So each meeting gets a public proof and follow-ups can pay from your agent wallet.",
    },
  ] as (Row | false)[]).filter((r): r is Row => Boolean(r));
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="h-setup" className="flex flex-col gap-3.5" style={style}>
      <SectionTitle id="h-setup" count={`${rows.length} left`}>
        Finish setting up
      </SectionTitle>
      <Card pad="none" className="flex flex-col">
        {rows.map((r, i) => (
          <div key={r.id} className={cx("flex items-center gap-3.5 px-5 py-4", i < rows.length - 1 && "border-b border-hairline")}>
            <span aria-hidden="true" className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-full bg-well text-ink-2">
              {r.icon}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="t-title">{r.title}</span>
              <span className="text-[13px] text-ink-2">{r.detail}</span>
            </span>
            <Button size="sm" variant={i === 0 ? "primary" : "secondary"} onClick={onOpenSettings}>
              Connect
            </Button>
          </div>
        ))}
      </Card>
    </section>
  );
}
