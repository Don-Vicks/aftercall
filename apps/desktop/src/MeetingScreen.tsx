import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search, ShieldCheck } from "lucide-react";
import { formatClock, formatDuration, type Meeting } from "@aftercall/core";
import { FollowUps, type FollowUpHandlers } from "./FollowUps";
import { Pill, SectionLabel, cx } from "./ui";

type Tab = "notes" | "transcript";

export function MeetingScreen({
  meeting,
  leftToday,
  onToggleItem,
  onOpenVerify,
  handlers,
  onDelete,
  openAt,
}: {
  meeting: Meeting;
  /** What the agent wallet can still pay today, when connected. */
  leftToday: bigint | null;
  onToggleItem: (id: string) => void;
  onOpenVerify: () => void;
  handlers: Omit<FollowUpHandlers, "onJumpTo">;
  /** Real meetings can be deleted from this Mac. */
  onDelete?: () => void;
  /** Opens on the transcript at this second (from search). */
  openAt?: number;
}) {
  const [tab, setTab] = useState<Tab>(openAt === undefined ? "notes" : "transcript");
  const [target, setTarget] = useState<{ at: number; quote: string } | null>(openAt === undefined ? null : { at: openAt, quote: "" });

  const jumpTo = (at: number, quote: string) => {
    setTarget({ at, quote });
    setTab("transcript");
  };

  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
      <article className="mx-auto flex max-w-[680px] flex-col gap-9 px-12 pb-16">
        <header className="flex flex-col gap-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="t-label text-muted">
              {meeting.project} · {meeting.startedAt} · {formatDuration(meeting.durationSec)}
            </span>
            <button onClick={onOpenVerify} className="rounded-full">
              {meeting.verified ? (
                <Pill tone="verdigris" icon={<ShieldCheck size={13} strokeWidth={1.75} />}>
                  Verified
                </Pill>
              ) : (
                <Pill tone="caution">Not verified</Pill>
              )}
            </button>
          </div>
          <h1 className="t-display selectable m-0">{meeting.title}</h1>
          <Tabs tab={tab} onChange={setTab} />
        </header>

        {tab === "notes" ? (
          <Notes meeting={meeting} leftToday={leftToday} onToggleItem={onToggleItem} handlers={{ ...handlers, onJumpTo: jumpTo }} />
        ) : (
          <Transcript meeting={meeting} target={target} />
        )}
        {onDelete && (
          <div className="border-t border-hairline pt-4">
            <button onClick={onDelete} className="font-semibold text-muted hover:text-record">
              Delete meeting from this Mac
            </button>
          </div>
        )}
      </article>
    </main>
  );
}

function Tabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div role="tablist" aria-label="Meeting views" className="flex gap-5 border-b border-hairline">
      {(["notes", "transcript"] as const).map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={tab === t}
          onClick={() => onChange(t)}
          className={cx(
            "pb-2.5 font-semibold capitalize",
            tab === t ? "text-ink shadow-[inset_0_-2px_0_var(--verdigris)]" : "text-muted hover:text-ink",
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function Notes({
  meeting,
  leftToday,
  onToggleItem,
  handlers,
}: {
  meeting: Meeting;
  leftToday: bigint | null;
  onToggleItem: (id: string) => void;
  handlers: FollowUpHandlers;
}) {
  return (
    <>
      <div className="-mt-3 flex flex-col gap-3.5">
        <p className="t-reading selectable m-0">{meeting.summary}</p>
        <p className="m-0 text-muted">Processed in NEAR AI secure hardware. Audio deleted after transcription.</p>
      </div>

      <section aria-labelledby="dec" className="flex flex-col gap-3">
        <SectionLabel id="dec">Decisions</SectionLabel>
        <ol className="t-reading selectable m-0 flex list-decimal flex-col gap-1 pl-[22px]">
          {meeting.decisions.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="act" className="flex flex-col gap-1">
        <div className="mb-2">
          <SectionLabel id="act">Action items</SectionLabel>
        </div>
        {meeting.actionItems.map((item, i) => (
          <div
            key={item.id}
            className={cx("flex items-baseline gap-3 py-2.5", i < meeting.actionItems.length - 1 && "border-b border-hairline")}
          >
            <input type="checkbox" id={item.id} checked={item.done} onChange={() => onToggleItem(item.id)} className="size-[15px]" />
            <label htmlFor={item.id} className="flex flex-1 flex-wrap justify-between gap-x-3 gap-y-1 text-[15px] leading-5">
              <span className={cx(item.done && "text-muted line-through")}>{item.text}</span>
              <span className={cx("text-[13px]", item.closedNote ? "text-verdigris" : "text-muted")}>
                {item.closedNote ?? `${item.owner}${item.due ? ` · ${item.due}` : ""}`}
              </span>
            </label>
          </div>
        ))}
      </section>

      <FollowUps followUps={meeting.followUps} leftToday={leftToday} {...handlers} />
    </>
  );
}

function Transcript({ meeting, target }: { meeting: Meeting; target: { at: number; quote: string } | null }) {
  const [query, setQuery] = useState("");
  const targetRef = useRef<HTMLDivElement>(null);
  const evidence = meeting.followUps.filter((f) => f.status !== "dismissed").map((f) => f.evidence);

  useEffect(() => {
    targetRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [target]);

  const lines = meeting.transcript.filter((l) => !query || l.text.toLowerCase().includes(query.toLowerCase()));

  return (
    <section className="-mt-3 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 max-w-[420px] text-muted">
          Whisper in NEAR AI secure hardware. “You” is your microphone and “Others” is the call's audio; Aftercall never identifies voices.
        </p>
        <label className="flex h-8 items-center gap-2 rounded-sm border border-border bg-well px-2.5 text-muted">
          <Search size={14} strokeWidth={1.5} aria-hidden="true" />
          <span className="sr-only">Search transcript</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transcript"
            className="w-[180px] border-0 bg-transparent text-ink outline-none placeholder:text-muted"
          />
        </label>
      </div>

      <div className="selectable flex flex-col font-serif text-[17px] leading-7">
        {lines.map((line) => {
          const quotes = evidence.filter((e) => e.at === line.at && line.text.includes(e.quote));
          const isTarget = line.at === target?.at;
          return (
            <div key={line.at} ref={isTarget ? targetRef : undefined} className="grid grid-cols-[56px_minmax(0,1fr)] gap-4 py-2.5">
              <span className={cx("font-mono text-xs leading-7", isTarget ? "text-verdigris" : "text-muted")}>{formatClock(line.at)}</span>
              <div className="flex flex-col gap-1.5">
                <p className="m-0">
                  <span className={cx("t-label mr-2.5 inline-block font-sans", line.speaker === "you" ? "text-verdigris" : "text-muted")}>
                    {line.speaker === "you" ? "You" : "Others"}
                  </span>
                  <Highlighted text={line.text} quotes={quotes.map((q) => q.quote)} strong={isTarget ? target?.quote : undefined} />
                </p>
                {isTarget && quotes.length > 0 && <span className="t-label font-sans text-verdigris">Evidence for a follow-up</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Marks every evidence quote in a line; the one you jumped to is emphasised. */
function Highlighted({ text, quotes, strong }: { text: string; quotes: string[]; strong?: string }) {
  const spans = quotes
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
      <mark
        key={start}
        className={cx(
          "rounded-[3px] py-px text-ink",
          q === strong ? "bg-verdigris-tint shadow-[inset_0_-1px_0_var(--verdigris)]" : "bg-transparent shadow-[inset_0_-1px_0_var(--faint)]",
        )}
      >
        {q}
      </mark>,
    );
    cursor = start + q.length;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}
