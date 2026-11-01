import { useId, useState, type CSSProperties } from "react";
import type { ActionItem, Meeting } from "@aftercall/core";
import type { SavedRecording } from "./recorder";
import type { Project } from "./projects";
import { MeetingRow, meetingRow, shortWhen } from "./MeetingRow";
import { Avatar, Button, SectionTitle, Strike, Tick, cx, useIsYou } from "./ui";

const rise = (i: number): CSSProperties => ({ animation: `ac-in 320ms var(--ease) ${i * 40}ms both` });
const SHOWN = 5;

/** "today", or "since 28 Oct". */
const sinceLabel = (unix: number) => (new Date(unix * 1000).toDateString() === new Date().toDateString() ? "today" : `since ${shortWhen(unix)}`);

/**
 * A project at a glance: what's still open across its meetings, the meetings
 * themselves, and the people in them.
 */
export function ProjectScreen({
  project,
  recordings,
  meetings,
  account,
  onToggleItem,
  onOpenMeeting,
  onRecord,
  onRename,
}: {
  project: Project;
  /** This project's recordings, newest first. */
  recordings: SavedRecording[];
  /** Meetings with notes, by recording id. */
  meetings: Record<string, Meeting>;
  account: string | null;
  onToggleItem: (meetingId: string, itemId: string) => void;
  onOpenMeeting: (id: string) => void;
  /** Opens the record sheet with this project picked. */
  onRecord: () => void;
  onRename: () => void;
}) {
  const [all, setAll] = useState(false);
  /** Items ticked on this page stay, struck through, until you leave it. */
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());
  const sorted = [...recordings].sort((a, b) => b.startedAt - a.startedAt);
  const withNotes = sorted.filter((r) => meetings[r.id]);
  const since = sorted.length ? sorted[sorted.length - 1] : undefined;

  const listed = withNotes.flatMap((r) =>
    meetings[r.id].actionItems.filter((a) => !a.done || kept.has(`${r.id}:${a.id}`)).map((a) => ({ key: `${r.id}:${a.id}`, item: a, meeting: meetings[r.id], when: shortWhen(r.startedAt) })),
  );
  const open = listed.filter((o) => !o.item.done);
  const openMeetings = new Set(open.map((o) => o.meeting.id)).size;
  const rows = sorted.map((r) => meetingRow(r, meetings[r.id], { withProject: false, long: false }));

  // People: who the calendar says was invited, and the payees follow-ups named.
  const people = new Map<string, { name: string; detail: string; count: number }>();
  for (const r of withNotes) {
    const mt = meetings[r.id];
    for (const a of mt.invited ?? []) {
      const name = a.name || a.email;
      if (!name) continue;
      const p = people.get(name.toLowerCase()) ?? { name, detail: "", count: 0 };
      p.count++;
      people.set(name.toLowerCase(), p);
    }
    for (const f of mt.followUps) {
      if (f.kind !== "payment" || !f.payeeListed || people.has(f.payeeName.toLowerCase())) continue;
      people.set(f.payeeName.toLowerCase(), { name: f.payeeName, detail: "On your payee list", count: 0 });
    }
  }
  const others = [...people.values()].map((p) => ({ ...p, detail: p.detail || `${p.count} ${p.count === 1 ? "meeting" : "meetings"}` }));

  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
      <div className="mx-auto flex max-w-[760px] flex-col gap-10 px-12 pt-5 pb-[72px]">
        <header className="flex flex-wrap items-end justify-between gap-6" style={rise(0)}>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="t-eyebrow text-muted">
              Project · {sorted.length === 0 ? "no meetings yet" : `${sorted.length} ${sorted.length === 1 ? "meeting" : "meetings"} ${sinceLabel(since!.startedAt)}`}
            </span>
            <h1 className="t-display m-0 break-words">{project.name}</h1>
          </div>
          <div className="flex gap-2">
            <Button variant="quiet" onClick={onRename}>
              Rename
            </Button>
            <Button onClick={onRecord} icon={<span aria-hidden="true" className="size-2 rounded-full bg-record" />}>
              Record in {project.name}
            </Button>
          </div>
        </header>

        {sorted.length === 0 ? (
          <p className="m-0 text-ink-2" style={rise(1)}>
            Meetings you record in {project.name} show up here, with their open action items and the people in them.
          </p>
        ) : (
          <>
            <section aria-labelledby="h-open" className="flex flex-col gap-1.5" style={rise(1)}>
              <SectionTitle id="h-open" className="mb-1" count={open.length ? `${open.length} across ${openMeetings} ${openMeetings === 1 ? "meeting" : "meetings"}` : undefined}>
                Open action items
              </SectionTitle>
              {listed.length === 0 ? (
                <p className="m-0 text-ink-2">Nothing open. Action items from these meetings show up here until they’re done.</p>
              ) : (
                <div className="flex flex-col border-t border-hairline">
                  {listed.map((o) => (
                    <OpenItem
                      key={o.key}
                      item={o.item}
                      meeting={o.meeting}
                      when={o.when}
                      account={account}
                      onToggle={() => {
                        setKept((k) => new Set(k).add(o.key));
                        onToggleItem(o.meeting.id, o.item.id);
                      }}
                      onOpen={() => onOpenMeeting(o.meeting.id)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="h-meet" className="flex flex-col gap-1.5" style={rise(2)}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <SectionTitle id="h-meet" count={sorted.length}>
                  Meetings
                </SectionTitle>
                {rows.length > SHOWN && (
                  <button onClick={() => setAll((v) => !v)} className="text-[13px] font-semibold text-verdigris hover:text-verdigris-hover">
                    {all ? "Show fewer" : `Show all ${rows.length}`}
                  </button>
                )}
              </div>
              {(all ? rows : rows.slice(0, SHOWN)).map((row) => (
                <MeetingRow key={row.id} row={row} onOpen={onOpenMeeting} />
              ))}
            </section>

            {others.length > 0 && (
              <section aria-labelledby="h-people" className="flex flex-col gap-3.5" style={rise(3)}>
                <SectionTitle id="h-people" count={others.length + 1}>
                  People in this project
                </SectionTitle>
                <ul className="m-0 flex list-none flex-wrap gap-x-8 gap-y-4 p-0">
                  <Person name="You" detail={account ?? "This Mac"} mono={Boolean(account)} you />
                  {others.map((p) => (
                    <Person key={p.name} name={p.name} detail={p.detail} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function OpenItem({ item, meeting, when, account, onToggle, onOpen }: { item: ActionItem; meeting: Meeting; when: string; account: string | null; onToggle: () => void; onOpen: () => void }) {
  const id = useId();
  const isYou = useIsYou();
  const yours = isYou(item.owner) || (account !== null && item.owner === account);
  return (
    <div className="flex items-center gap-3 border-b border-hairline py-3">
      <Tick checked={item.done} onChange={onToggle} aria-labelledby={id} />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span id={id} className="text-[15px]">
          <Strike on={item.done}>{item.text}</Strike>
        </span>
        <span className="text-[13px]">
          {item.claimed && <span className="font-medium text-verdigris">{item.claimed.agent} is on it · </span>}
          <button onClick={onOpen} className="text-muted hover:text-ink">
            {meeting.title} · {when.replace(/^Today .*/, "today")}
          </button>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-[13px] text-ink-2">
        <Avatar name={item.owner} you={yours || undefined} size={26} decorative />
        <span>{item.due ?? (yours ? "You" : item.owner)}</span>
      </span>
    </div>
  );
}

function Person({ name, detail, mono, you }: { name: string; detail: string; mono?: boolean; you?: boolean }) {
  return (
    <li className="flex min-w-[150px] items-center gap-2.5">
      <Avatar name={name} you={you} size={34} decorative />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{you ? "You" : name}</span>
        <span className={cx("truncate text-xs text-muted", mono && "font-mono")}>{detail}</span>
      </span>
    </li>
  );
}
