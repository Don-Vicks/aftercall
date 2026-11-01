import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { ChevronRight, Lock, Search, ShieldCheck, Users } from "lucide-react";
import { formatClock, formatDuration, meetingLabel, othersOn, speakerLabel, type ActionItem, type Attendee, type Dropped, type ExportOptions, type FollowUp, type ItemFields, type Meeting, type TranscriptLine } from "@aftercall/core";
import { ExportMenu } from "./ExportMenu";
import { EditItemButton, EditedMark, ItemEditor, useItemEditing } from "./ActionItemEditor";
import { FollowUps, followUpTitle, type FollowUpHandlers } from "./FollowUps";
import { Avatar, AvatarStack, Button, Input, MeProvider, Pill, SectionTitle, Strike, TabPanel, Tabs, Tick, cx, enter, exit, useIsYou } from "./ui";
import { grow } from "./SettingsParts";

type Tab = "notes" | "transcript";

/** The board's entrance: each block rises in 40 ms after the one before. */
const rise = (i: number, ms = 320): CSSProperties => ({ animation: `ac-in ${ms}ms ${Math.min(i, 10) * 40}ms var(--ease) both` });

export function MeetingScreen({
  meeting,
  dropped = [],
  me = [],
  leftToday,
  onToggleItem,
  onEditItem,
  originalOf,
  onOpenVerify,
  handlers,
  onDelete,
  openAt,
  autopilotOn,
  onOpenAgents,
  onOpenAutopilot,
  sample,
  onNear,
}: {
  meeting: Meeting;
  /** Which kind of sample this is, so an export says so. */
  sample?: ExportOptions["sample"];
  /** The meeting's proof is recorded on NEAR, so an export can say anyone can check it. */
  onNear?: boolean;
  /** What the model proposed that the app dropped for lack of an exact quote (notes.json). */
  dropped?: Dropped[];
  /** Your names (NEAR account, name): action items owned by these show as "You". */
  me?: readonly string[];
  /** What the agent wallet can still pay today, when connected. */
  leftToday: bigint | null;
  onToggleItem: (id: string) => void;
  /** Saves your edit of an item's text, owner and due date; null restores what the model signed. */
  onEditItem?: (id: string, fields: ItemFields | null) => void;
  /** The signed item behind an action item. */
  originalOf?: (id: string) => ItemFields | null;
  onOpenVerify: () => void;
  handlers: Omit<FollowUpHandlers, "onJumpTo">;
  /** Real meetings can be deleted from this Mac. */
  onDelete?: () => void;
  /** Opens on the transcript at this second (from search). */
  openAt?: number;
  /** Whether an autopilot rule is on. */
  autopilotOn?: boolean;
  onOpenAgents?: () => void;
  onOpenAutopilot?: () => void;
}) {
  const [tab, setTab] = useState<Tab>(openAt === undefined ? "notes" : "transcript");
  const [target, setTarget] = useState<{ at: number; quote: string } | null>(openAt === undefined ? null : { at: openAt, quote: "" });
  const [showFollowUp, setShowFollowUp] = useState<string | null>(null);
  const others = othersOn(meeting);

  const jumpTo = (at: number, quote: string) => {
    setTarget({ at, quote });
    setTab("transcript");
  };
  const openFollowUp = (id: string) => {
    setShowFollowUp(id);
    setTab("notes");
  };

  return (
    <MeProvider me={me}>
      <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
        <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
        <article className="mx-auto flex max-w-[680px] flex-col gap-9 px-12 pt-3 pb-24">
          <header className="flex flex-col gap-3" style={rise(0)}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="t-eyebrow text-muted">
                {meeting.project} · {meetingLabel(meeting)} · {formatDuration(meeting.durationSec)}
              </span>
              <span className="flex items-center gap-1.5">
                <ExportMenu meeting={meeting} sample={sample} onNear={onNear} me={me} />
                <button
                  type="button"
                  onClick={onOpenVerify}
                  aria-label={meeting.verified ? "Verified. Show the checks" : "Not verified. Show the checks"}
                  className="press rounded-full"
                >
                  {meeting.verified ? (
                    <Pill tone="verdigris" icon={<ShieldCheck size={12} strokeWidth={2} aria-hidden="true" />}>
                      Verified
                    </Pill>
                  ) : (
                    <Pill tone="caution">Not verified</Pill>
                  )}
                </button>
              </span>
            </div>
            <h1 className="t-display selectable m-0">{meeting.title}</h1>
            {others.length > 0 && <People others={others} />}
            <Tabs
              id="meeting"
              label="Meeting views"
              className="mt-2"
              items={[
                { id: "notes", label: "Notes" },
                { id: "transcript", label: "Transcript" },
              ]}
              value={tab}
              onChange={setTab}
            />
          </header>

          <TabPanel tabsId="meeting" value={tab} className={cx("flex flex-col", tab === "notes" ? "gap-9" : "gap-7")}>
            {tab === "notes" ? (
              <Notes
                meeting={meeting}
                dropped={dropped}
                leftToday={leftToday}
                onToggleItem={onToggleItem}
                onEditItem={onEditItem}
                originalOf={originalOf}
                handlers={{ ...handlers, onJumpTo: jumpTo }}
                show={showFollowUp}
                autopilotOn={autopilotOn}
                onOpenAgents={onOpenAgents}
                onOpenAutopilot={onOpenAutopilot}
              />
            ) : (
              <Transcript meeting={meeting} others={others} target={target} onOpenFollowUp={openFollowUp} />
            )}
          </TabPanel>

          {onDelete && (
            <div className="border-t border-hairline pt-4">
              <Button variant="quiet" className="px-0! hover:text-record" onClick={onDelete}>
                Delete meeting from this Mac
              </Button>
            </div>
          )}
        </article>
      </main>
    </MeProvider>
  );
}

const nameOf = (a: Attendee) => a.name || a.email;

/** "You and Ada", "You, Ada and Theo", "You, Ada, Theo and 2 more". */
function peopleLine(names: string[]): string {
  const shown = names.length > 3 ? names.slice(0, 2) : names;
  const rest = names.length - shown.length;
  const all = ["You", ...shown];
  if (rest > 0) return `${all.join(", ")} and ${rest} more`;
  return `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`;
}

/** Who was invited, from the calendar: avatars and their names. */
function People({ others }: { others: Attendee[] }) {
  const names = others.map(nameOf);
  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden="true" className="inline-flex">
        <AvatarStack people={["You", ...names]} max={4} size={28} ring="raised" />
      </span>
      <span className="text-ink-2">{peopleLine(names)}</span>
    </div>
  );
}

function Notes({
  meeting,
  dropped,
  leftToday,
  onToggleItem,
  onEditItem,
  originalOf,
  handlers,
  show,
  autopilotOn,
  onOpenAgents,
  onOpenAutopilot,
}: {
  meeting: Meeting;
  dropped: Dropped[];
  leftToday: bigint | null;
  onToggleItem: (id: string) => void;
  onEditItem?: (id: string, fields: ItemFields | null) => void;
  originalOf?: (id: string) => ItemFields | null;
  handlers: FollowUpHandlers;
  /** A follow-up to scroll to, from a chip in the transcript. */
  show: string | null;
  autopilotOn?: boolean;
  onOpenAgents?: () => void;
  onOpenAutopilot?: () => void;
}) {
  const open = meeting.actionItems.filter((a) => !a.done).length;
  const agents = meeting.actionItems.some((a) => a.claimed || a.completed);

  useEffect(() => {
    if (show) document.getElementById(`followup-${show}`)?.scrollIntoView({ block: "center" });
  }, [show]);

  return (
    <>
      <p className="t-reading selectable m-0" style={rise(1)}>
        {meeting.summary}
      </p>

      {meeting.yourNotes && (
        <section aria-labelledby="your-notes" className="flex flex-col gap-2.5" style={rise(2)}>
          <h2 id="your-notes" className="t-section m-0 flex items-center gap-2 text-ink">
            <Avatar name="You" you size={22} decorative />
            Your notes <span className="font-medium text-muted">typed during the call</span>
          </h2>
          <div className="selectable py-1 pl-[30px] font-serif text-[17px] leading-[27px] whitespace-pre-line text-ink">{meeting.yourNotes}</div>
        </section>
      )}

      {meeting.decisions.length > 0 && (
        <section aria-labelledby="decisions" className="flex flex-col gap-2.5" style={rise(3)}>
          <SectionTitle id="decisions" count={meeting.decisions.length}>
            Decisions
          </SectionTitle>
          <ol className="t-reading selectable m-0 flex list-decimal flex-col gap-1.5 pl-[22px] leading-7">
            {meeting.decisions.map((d, i) => (
              <li key={`${i}-${d}`}>{d}</li>
            ))}
          </ol>
        </section>
      )}

      {meeting.actionItems.length > 0 && (
        <section aria-labelledby="actions" className="flex flex-col gap-1.5" style={rise(4)}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <SectionTitle id="actions" count={`${open} open`}>
              Action items
            </SectionTitle>
            {agents && onOpenAgents && (
              <button type="button" onClick={onOpenAgents} className="text-[13px] font-semibold text-verdigris hover:text-verdigris-hover">
                Connected agents
              </button>
            )}
          </div>
          <ul className="m-0 flex list-none flex-col border-t border-hairline p-0">
            {meeting.actionItems.map((item) => (
              <ActionRow
                key={item.id}
                rowKey={`${meeting.id}:${item.id}`}
                item={item}
                onToggle={() => onToggleItem(item.id)}
                onEdit={onEditItem && ((fields) => onEditItem(item.id, fields))}
                original={originalOf?.(item.id) ?? null}
              />
            ))}
          </ul>
          {agents && <p className="m-0 mt-1.5 text-[13px] text-ink-2">Agents can claim and finish action items. They can't send, pay or change your rules.</p>}
        </section>
      )}

      <div style={rise(5)}>
        <FollowUps
          meetingId={meeting.id}
          followUps={meeting.followUps}
          leftToday={leftToday}
          invited={meeting.invited}
          autopilotOn={autopilotOn}
          onOpenAutopilot={onOpenAutopilot}
          {...handlers}
        />
      </div>

      {dropped.length > 0 && (
        <div style={rise(6)}>
          <DroppedItems items={dropped} />
        </div>
      )}
    </>
  );
}

const KIND: Record<Dropped["kind"], string> = { decision: "Decision", "action item": "Action item", "follow-up": "Follow-up" };

/**
 * What the model proposed but the app dropped because its quote wasn't word for word
 * in the transcript. Closed by default; nothing here was sent, paid or added.
 */
function DroppedItems({ items }: { items: Dropped[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const still = useReducedMotion();
  return (
    <section aria-label="Dropped items" className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        className="press inline-flex w-fit items-center gap-1.5 rounded-sm text-[13px] leading-[19px] text-ink-2 hover:text-ink"
      >
        <ChevronRight size={14} strokeWidth={2} aria-hidden="true" className={cx("text-muted transition-transform duration-(--dur-2) ease-calm", open && "rotate-90")} />
        <span>
          <span className="font-semibold">{items.length === 1 ? "1 item dropped" : `${items.length} items dropped`}</span> · no exact quote in the transcript
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <m.div
            key="dropped"
            id={id}
            initial={still ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto", transition: still ? enter : grow }}
            exit={still ? { opacity: 0, transition: exit } : { opacity: 0, height: 0, transition: exit }}
            className="overflow-hidden"
          >
            <ul className="m-0 mt-2.5 flex list-none flex-col border-t border-hairline p-0">
              {items.map((d, i) => (
                <li key={`${i}-${d.text}`} className="flex items-start gap-3 border-b border-hairline py-2.5 pl-5">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[12px] leading-4 text-muted">{KIND[d.kind]}</span>
                    <span className="selectable text-[14px] leading-5 text-ink-2">{d.text}</span>
                  </span>
                  <Pill tone="muted">Not acted on</Pill>
                </li>
              ))}
            </ul>
            <p className="m-0 mt-2 pl-5 text-[13px] leading-[19px] text-ink-2">
              {items.length === 1
                ? "The model proposed this, but its quote wasn't word for word in the transcript, so Aftercall left it out."
                : "The model proposed these, but their quotes weren't word for word in the transcript, so Aftercall left them out."}
            </p>
          </m.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/** "14:20" today, "28 Oct" before. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** One action item: the tick, the words, who and when, and what an agent did with it. Editable in place. */
function ActionRow({
  rowKey,
  item,
  onToggle,
  onEdit,
  original,
}: {
  rowKey: string;
  item: ActionItem;
  onToggle: () => void;
  onEdit?: (fields: ItemFields | null) => void;
  original: ItemFields | null;
}) {
  const textId = useId();
  const you = useIsYou();
  const edit = useItemEditing(rowKey);
  const working = !item.done && !!item.claimed;
  const owner = item.owner && item.owner !== "Unassigned" ? item.owner : null;

  if (edit.editing && onEdit) {
    return (
      <li className="flex border-b border-hairline py-[13px] pl-[34px]">
        <ItemEditor
          item={item}
          original={original}
          onSave={(fields) => {
            onEdit(fields);
            edit.close();
          }}
          onRestore={() => {
            onEdit(null);
            edit.close();
          }}
          onCancel={edit.close}
        />
      </li>
    );
  }

  let sub: ReactNode = null;
  if (item.done && item.completed) {
    sub = (
      <>
        <span className="font-medium text-verdigris">Done by {item.completed.agent}</span>
        {item.completed.note && <span className="text-ink-2"> · “{item.completed.note}”</span>}
      </>
    );
  } else if (working) {
    sub = (
      <>
        <span className="font-medium text-verdigris">{item.claimed!.agent} is on it</span>
        <span className="text-muted"> · since {when(item.claimed!.at)}</span>
      </>
    );
  } else if (item.closedNote) {
    sub = <span className="text-muted">{item.closedNote}</span>;
  } else if (owner && !you(owner)) {
    sub = <span className="text-muted">{owner}</span>;
  }

  return (
    <li className="group flex items-center gap-3 border-b border-hairline py-[13px]">
      <Tick checked={item.done} onChange={onToggle} working={working} aria-labelledby={textId} />
      <span className={cx("flex min-w-0 flex-1 flex-col gap-0.5", onEdit && "pr-7")}>
        <span className="self-start text-[15px] leading-[21px] text-ink">
          <span id={textId} className="selectable">
            <Strike on={item.done}>{item.text}</Strike>
          </span>
          <EditedMark item={item} />
        </span>
        {sub && <span className="truncate text-[13px] leading-[18px]">{sub}</span>}
      </span>
      <span className="relative inline-flex shrink-0 items-center gap-1.5 text-[13px] text-muted">
        {onEdit && <EditItemButton id={edit.buttonId} text={item.text} onClick={edit.open} />}
        {owner && <Avatar name={owner} size={20} />}
        {item.due}
      </span>
    </li>
  );
}

/** Consecutive lines from the same side, shown as one turn of bubbles. */
interface Turn {
  speaker: TranscriptLine["speaker"];
  lines: TranscriptLine[];
}

function turnsOf(lines: TranscriptLine[]): Turn[] {
  const turns: Turn[] = [];
  for (const line of lines) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === line.speaker) last.lines.push(line);
    else turns.push({ speaker: line.speaker, lines: [line] });
  }
  return turns;
}

/** Bubble corners as the board draws them: the small corner faces the speaker's side. */
function corners(you: boolean, i: number, n: number): string {
  const single = n === 1 || i === 0;
  if (you) return single ? "18px 18px 6px 18px" : i === n - 1 ? "18px 6px 18px 18px" : "18px 6px 6px 18px";
  return single ? "18px 18px 18px 6px" : i === n - 1 ? "6px 18px 18px 18px" : "6px 18px 18px 6px";
}

function Transcript({
  meeting,
  others,
  target,
  onOpenFollowUp,
}: {
  meeting: Meeting;
  others: Attendee[];
  target: { at: number; quote: string } | null;
  onOpenFollowUp: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const targetRef = useRef<HTMLParagraphElement>(null);
  const live = meeting.followUps.filter((f) => f.status !== "dismissed");
  const named = others.length === 1;
  const them = speakerLabel("others", others);

  useEffect(() => {
    targetRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [target]);

  const q = query.trim().toLowerCase();
  const lines = meeting.transcript.filter((l) => !q || l.text.toLowerCase().includes(q));
  const turns = turnsOf(lines);

  return (
    <>
      <div className="-mt-2 flex flex-wrap items-center gap-3">
        <label className="relative flex min-w-[240px] flex-[1_1_260px] items-center">
          <span className="sr-only">Find in transcript</span>
          <Search size={15} strokeWidth={2} aria-hidden="true" className="pointer-events-none absolute left-3 text-muted" />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find in this call" className="h-[38px]! rounded-[10px]! border-hairline! pl-9!" />
        </label>
        <details className="text-[13px] text-ink-2">
          <summary className="cursor-pointer font-semibold text-ink-2 hover:text-ink">How are names shown?</summary>
          <p className="m-0 mt-1.5 max-w-[320px]">
            Your mic is You. The other side gets a name only when your calendar invited exactly one other person. Aftercall never identifies voices.
          </p>
        </details>
      </div>

      <div className="flex flex-col gap-[18px]">
        {turns.length === 0 && <p className="m-0 text-ink-2">{q ? `Nothing in this call matches “${query.trim()}”.` : "This meeting has no transcript."}</p>}
        {turns.map((turn, ti) => {
          const you = turn.speaker === "you";
          const label = you ? "You" : them;
          return (
            <div key={`${turn.lines[0].at}-${ti}`} className={cx("flex flex-col gap-1.5", you ? "items-end" : "items-start")} style={rise(ti, 280)}>
              <span className="inline-flex items-center gap-2 text-[12px] text-muted">
                {you ? (
                  <>
                    <span className="font-mono">{formatClock(turn.lines[0].at)}</span>
                    <span className="font-semibold text-ink-2">You</span>
                    <Avatar name="You" you size={24} decorative />
                  </>
                ) : (
                  <>
                    {named ? <Avatar name={label} size={24} decorative /> : <OthersMark />}
                    <span className="font-semibold text-ink-2">{label}</span>
                    {named && <span>from your calendar</span>}
                    <span className="font-mono">{formatClock(turn.lines[0].at)}</span>
                  </>
                )}
              </span>
              {turn.lines.map((line, i) => {
                const evidence = live.filter((f) => f.evidence.at === line.at && line.text.includes(f.evidence.quote));
                const isTarget = line.at === target?.at;
                return (
                  <BubbleWithChips key={`${line.at}-${i}`} evidence={evidence} you={you} onOpenFollowUp={onOpenFollowUp}>
                    <p
                      ref={isTarget ? targetRef : undefined}
                      className={cx(
                        "selectable m-0 max-w-[78%] scroll-mt-16 px-4 py-3 font-serif text-[17px] leading-[26px] text-ink",
                        you ? "bg-verdigris-tint" : "bg-elevated shadow-1",
                      )}
                      style={{ borderRadius: corners(you, i, turn.lines.length), boxShadow: isTarget ? "0 0 0 2px var(--verdigris)" : undefined }}
                    >
                      <Highlighted text={line.text} quotes={evidence.map((f) => f.evidence.quote)} />
                    </p>
                  </BubbleWithChips>
                );
              })}
            </div>
          );
        })}
      </div>

      <p className="m-0 flex items-center gap-2 text-[13px] text-ink-2">
        <Lock size={14} strokeWidth={2} aria-hidden="true" className="text-faint" />
        Transcribed in NEAR AI secure hardware. The audio was deleted afterwards.
      </p>
    </>
  );
}

/** The other side when the calendar can't say who it was: a neutral mark, not initials. */
function OthersMark() {
  return (
    <span aria-hidden="true" className="inline-flex size-6 items-center justify-center rounded-full bg-elevated text-ink-2 shadow-[inset_0_0_0_1px_var(--hairline)]">
      <Users size={12} strokeWidth={2} />
    </span>
  );
}

/** A bubble, and under it a chip for each follow-up it is the evidence for. */
function BubbleWithChips({ evidence, you, onOpenFollowUp, children }: { evidence: FollowUp[]; you: boolean; onOpenFollowUp: (id: string) => void; children: ReactNode }) {
  if (evidence.length === 0) return <>{children}</>;
  return (
    <>
      {children}
      <span className={cx("flex max-w-[78%] flex-wrap gap-1.5", you ? "justify-end" : "justify-start pl-1")}>
        {evidence.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onOpenFollowUp(f.id)}
            aria-label={`${followUpTitle(f)}: show the follow-up`}
            className="press inline-flex h-6 items-center gap-1.5 rounded-full bg-elevated px-[9px] text-[12px] font-semibold text-ink shadow-1"
          >
            <span className="font-mono font-normal text-muted">{formatClock(f.evidence.at)}</span>
            {followUpTitle(f)}
          </button>
        ))}
      </span>
    </>
  );
}

/** Marks every evidence quote in a line. */
function Highlighted({ text, quotes }: { text: string; quotes: string[] }) {
  const spans = [...new Set(quotes)]
    .map((q) => ({ q, start: text.indexOf(q) }))
    .filter((x) => x.start >= 0)
    .sort((a, b) => a.start - b.start);
  if (spans.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const { q, start } of spans) {
    if (start < cursor) continue;
    parts.push(text.slice(cursor, start));
    parts.push(
      <mark key={start} className="rounded-[4px] bg-caution-tint px-0.5 text-ink">
        {q}
      </mark>,
    );
    cursor = start + q.length;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}
