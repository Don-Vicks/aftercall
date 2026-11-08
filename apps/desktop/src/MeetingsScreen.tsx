import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, ShieldCheck } from "lucide-react";
import { awaitsYou, buildPeople, clockTime, firstName, groupRows, isYou, meetingTime, shortDate, weekGroup, type Meeting, type PeopleIndex } from "@aftercall/core";
import type { SavedRecording } from "./recorder";
import { isProcessing, recordingTitle } from "./RecordingScreen";
import { AvatarStack, Button, Menu, Pill, Spinner, cx, type MenuTriggerProps } from "./ui";
import { Empty, Page, PageHeader, SearchBox, rise } from "./PagePieces";
import { minutes, plural } from "./library";

interface Row {
  id: string;
  title: string;
  project: string;
  time: number | null;
  seconds: number;
  /** Set once the recording has notes. */
  meeting?: Meeting;
  sample: boolean;
}

type Status = { kind: "processing" | "waiting" | "approve" | "mine" | "others" | "done"; text: string };

const PAGE = 20;

/** The status words on a meeting row, most urgent first. */
function statusOf(row: Row, me: readonly string[], index: PeopleIndex): Status {
  const m = row.meeting;
  if (!m) return isProcessing(row.id) ? { kind: "processing", text: "Making notes…" } : { kind: "waiting", text: "Waiting for notes" };
  const proposed = m.followUps.filter(awaitsYou).length;
  const blocked = m.followUps.filter((f) => f.status === "blocked").length;
  if (proposed) return { kind: "approve", text: `${proposed} to approve` };
  if (blocked) return { kind: "approve", text: `${blocked} blocked` };
  const open = m.actionItems.filter((a) => !a.done);
  const mine = open.filter((a) => isYou(a.owner, me) || a.owner === "Unassigned").length;
  if (mine) return { kind: "mine", text: `${mine} for you` };
  if (open.length) {
    const owners = [...new Set(open.map((a) => a.owner))];
    const person = owners.length === 1 ? index.people.find((p) => p.theyOwe.some((i) => i.meetingId === m.id && i.owner === owners[0])) : undefined;
    return { kind: "others", text: owners.length === 1 ? `Waiting on ${firstName(person?.name ?? owners[0])}` : `Waiting on ${owners.length} people` };
  }
  return { kind: "done", text: "All done" };
}

const needsYou = (s: Status) => s.kind === "approve" || s.kind === "waiting";

/**
 * Every recording on this Mac, newest first, grouped by week: search, filter by
 * project or person, and the few states that matter (needs you, verified, payments).
 */
export function MeetingsScreen({
  meetings,
  recordings,
  me,
  sampleIds,
  onOpen,
}: {
  meetings: Meeting[];
  recordings: SavedRecording[];
  me: readonly string[];
  sampleIds: ReadonlySet<string>;
  onOpen: (id: string) => void;
}) {
  const [now] = useState(() => Date.now());
  const index = useMemo(() => buildPeople(meetings, { me, now }), [meetings, me, now]);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState<string | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [onlyNeeds, setOnlyNeeds] = useState(false);
  const [onlyVerified, setOnlyVerified] = useState(false);
  const [onlyPayments, setOnlyPayments] = useState(false);
  const [oldestFirst, setOldestFirst] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const rows: Row[] = useMemo(() => {
    const byId = Object.fromEntries(meetings.map((m) => [m.id, m]));
    const fromRecordings = recordings.map((r) => ({
      id: r.id,
      title: byId[r.id]?.title ?? recordingTitle(r),
      project: r.project,
      time: r.startedAt * 1000,
      seconds: r.seconds,
      meeting: byId[r.id],
      sample: r.label === "Sample" || sampleIds.has(r.id),
    }));
    const others = meetings
      .filter((m) => !recordings.some((r) => r.id === m.id))
      .map((m) => ({ id: m.id, title: m.title, project: m.project, time: meetingTime(m, now), seconds: m.durationSec, meeting: m, sample: sampleIds.has(m.id) }));
    return [...fromRecordings, ...others].sort((a, b) => (b.time ?? -Infinity) - (a.time ?? -Infinity));
  }, [meetings, recordings, sampleIds, now]);

  const status = new Map(rows.map((r) => [r.id, statusOf(r, me, index)]));
  const projects = [...new Set(rows.map((r) => r.project))].sort();
  const personIds = person ? new Set(index.byId[person]?.meetingIds ?? []) : null;
  const q = query.trim().toLowerCase();
  const matches = (r: Row) => {
    if (!q) return true;
    const m = r.meeting;
    const faces = (index.byMeeting[r.id] ?? []).map((id) => index.byId[id]?.name ?? "");
    const text = [r.title, r.project, ...faces, ...(m ? [m.summary, ...m.decisions, ...m.actionItems.map((a) => `${a.text} ${a.owner}`)] : [])];
    return text.some((s) => s.toLowerCase().includes(q));
  };
  const filtered = rows.filter(
    (r) =>
      matches(r) &&
      (!project || r.project === project) &&
      (!personIds || personIds.has(r.id)) &&
      (!onlyNeeds || needsYou(status.get(r.id)!)) &&
      (!onlyVerified || (r.meeting?.verified ?? false)) &&
      (!onlyPayments || (r.meeting?.followUps.some((f) => f.kind === "payment" && f.status !== "dismissed") ?? false)),
  );
  const ordered = oldestFirst ? [...filtered].reverse() : filtered;
  const shown = ordered.slice(0, limit);
  const groups = groupRows(shown, (r) => weekGroup(r.time, now));
  const needsCount = rows.filter((r) => needsYou(status.get(r.id)!)).length;
  const filtering = !!(q || project || person || onlyNeeds || onlyVerified || onlyPayments);
  const clear = () => {
    setQuery("");
    setProject(null);
    setPerson(null);
    setOnlyNeeds(false);
    setOnlyVerified(false);
    setOnlyPayments(false);
  };

  return (
    <Page width={920} className="gap-8">
      <PageHeader
        eyebrow={rows.length ? `${plural(rows.length, "meeting")}${projects.length ? ` · ${projects.join(", ")}` : ""}` : undefined}
        title="All meetings"
        intro="Every call you've recorded, newest first, encrypted on this Mac."
      />

      {rows.length === 0 ? (
        <div style={rise(1)}>
          <Empty title="No meetings yet">Record a call with ⌘⇧R, or open a sample call from Today. Each one shows up here with its notes.</Empty>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3" style={rise(1)}>
            <div className="flex flex-wrap items-center gap-3">
              <SearchBox className="min-w-0 flex-[1_1_320px]" label="Search all meetings" placeholder="Search titles, notes and people" value={query} onChange={setQuery} />
              <Menu
                label="Sort meetings"
                align="end"
                trigger={(p) => (
                  <button {...p} type="button" className="press inline-flex h-10 items-center gap-1.5 rounded-sm px-2.5 text-[13px] font-semibold text-ink-2 hover:text-ink">
                    {oldestFirst ? "Oldest first" : "Newest first"}
                    <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
                items={[
                  { label: "Newest first", icon: <Mark on={!oldestFirst} />, onSelect: () => setOldestFirst(false) },
                  { label: "Oldest first", icon: <Mark on={oldestFirst} />, onSelect: () => setOldestFirst(true) },
                ]}
              />
            </div>
            <div role="group" aria-label="Filters" className="flex flex-wrap gap-2">
              <Menu
                label="Filter by project"
                trigger={(p) => (
                  <MenuChip trigger={p} on={!!project}>
                    {project ?? "Project"}
                  </MenuChip>
                )}
                items={[
                  { label: "All projects", icon: <Mark on={!project} />, onSelect: () => setProject(null) },
                  null,
                  ...projects.map((name) => ({ label: name, icon: <Mark on={project === name} />, onSelect: () => setProject(name) })),
                ]}
              />
              <Menu
                label="Filter by person"
                width={240}
                trigger={(p) => (
                  <MenuChip trigger={p} on={!!person}>
                    {person ? (index.byId[person]?.name ?? "People") : "People"}
                  </MenuChip>
                )}
                items={[
                  { label: "Everyone", icon: <Mark on={!person} />, onSelect: () => setPerson(null) },
                  ...(index.people.length ? [null] : []),
                  ...index.people.slice(0, 20).map((p) => ({ label: p.name, icon: <Mark on={person === p.id} />, onSelect: () => setPerson(p.id) })),
                ]}
              />
              <span aria-hidden="true" className="mx-1 my-1.5 h-5 w-px bg-hairline" />
              <ToggleChip on={onlyNeeds} onClick={() => setOnlyNeeds((v) => !v)}>
                Needs you <span className="font-mono text-[12px] font-normal text-muted">{needsCount}</span>
              </ToggleChip>
              <ToggleChip on={onlyVerified} onClick={() => setOnlyVerified((v) => !v)}>
                <ShieldCheck size={13} strokeWidth={2} className="text-verdigris" aria-hidden="true" />
                Verified
              </ToggleChip>
              <ToggleChip on={onlyPayments} onClick={() => setOnlyPayments((v) => !v)}>
                Has payments
              </ToggleChip>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div style={rise(2)}>
              <Empty
                title="No meetings match"
                action={
                  <Button size="sm" onClick={clear}>
                    Clear search and filters
                  </Button>
                }
              >
                {filtering ? "Try fewer filters, or another word." : null}
              </Empty>
            </div>
          ) : (
            <div className="-mx-3 overflow-x-auto px-3" style={rise(2)}>
              <div className="flex min-w-[720px] flex-col gap-7">
                {groups.map(({ group, rows: list }) => (
                  <section key={group.key} aria-labelledby={`mt-${group.key}`} className="flex flex-col gap-0.5">
                    <h2 id={`mt-${group.key}`} className="t-section m-0 mb-1.5 text-ink">
                      {group.title} <span className="font-medium text-muted">{list.length}</span>
                    </h2>
                    {list.map((r) => (
                      <MeetingRow
                        key={r.id}
                        row={r}
                        status={status.get(r.id)!}
                        faces={(index.byMeeting[r.id] ?? []).map((id) => index.byId[id]?.name).filter((n): n is string => !!n)}
                        now={now}
                        onOpen={() => onOpen(r.id)}
                      />
                    ))}
                  </section>
                ))}
              </div>
            </div>
          )}

          {ordered.length > limit && (
            <div className="flex justify-center" style={rise(3)}>
              <Button onClick={() => setLimit((n) => n + PAGE)}>
                Show {oldestFirst ? "later" : "earlier"} meetings <span className="font-mono text-[12px] font-normal text-muted">{ordered.length - limit} more</span>
              </Button>
            </div>
          )}
        </>
      )}
    </Page>
  );
}

function Mark({ on }: { on: boolean }) {
  return <Check size={14} strokeWidth={2} className={on ? "text-verdigris" : "invisible"} aria-hidden="true" />;
}

const chip = (on: boolean) =>
  cx("press inline-flex h-8 items-center gap-1.5 rounded-full text-[13px] font-semibold", on ? "bg-raised text-ink shadow-[inset_0_0_0_1.5px_var(--ink)]" : "lift bg-elevated text-ink shadow-1");

function MenuChip({ trigger, on, children }: { trigger: MenuTriggerProps; on: boolean; children: ReactNode }) {
  return (
    <button {...trigger} type="button" className={cx(chip(on), "pr-2.5 pl-3")}>
      {children}
      <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

function ToggleChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cx(chip(on), "px-3")}>
      {children}
    </button>
  );
}

function MeetingRow({ row: r, status, faces, now, onOpen }: { row: Row; status: Status; faces: string[]; now: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="press -mx-3 grid min-h-[52px] w-[calc(100%+24px)] grid-cols-[92px_minmax(0,1fr)_100px_92px_52px_136px_16px] items-center gap-3.5 rounded-[10px] px-3 text-left text-ink hover:bg-elevated"
    >
      <span className="flex items-baseline gap-2 font-mono whitespace-nowrap">
        {r.time === null ? (
          <span className="text-[13px] text-muted">No date</span>
        ) : (
          <>
            <span className="text-[13px]">{shortDate(r.time, now)}</span>
            <span className="text-[12px] text-muted">{clockTime(r.time)}</span>
          </>
        )}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-[15px] font-semibold">{r.title}</span>
        {r.sample && (
          <Pill tone="muted" className="h-5 px-2">
            Sample
          </Pill>
        )}
      </span>
      <span className="truncate text-[13px] text-ink-2">{r.project}</span>
      <AvatarStack people={["You", ...faces]} max={3} size={28} ring="raised" />
      <span className="text-right font-mono text-[13px] text-muted">{minutes(r.seconds)}</span>
      <StatusWords status={status} />
      <span className="inline-flex text-verdigris">{r.meeting?.verified && <ShieldCheck size={16} strokeWidth={2} role="img" aria-label="Verified" />}</span>
    </button>
  );
}

function StatusWords({ status }: { status: Status }) {
  const dot = (color: string) => <span aria-hidden="true" className={cx("size-[7px] shrink-0 rounded-full", color)} />;
  switch (status.kind) {
    case "processing":
      return (
        <span className="inline-flex items-center gap-2 text-[13px] whitespace-nowrap text-ink-2">
          <Spinner size={12} />
          {status.text}
        </span>
      );
    case "approve":
      return (
        <span className="inline-flex items-center gap-2 text-[13px] font-medium whitespace-nowrap text-caution">
          {dot("bg-caution")}
          {status.text}
        </span>
      );
    case "mine":
      return (
        <span className="inline-flex items-center gap-2 text-[13px] font-medium whitespace-nowrap text-ink">
          {dot("bg-verdigris")}
          {status.text}
        </span>
      );
    case "done":
      return <span className="text-[13px] whitespace-nowrap text-muted">{status.text}</span>;
    default:
      return <span className="truncate text-[13px] whitespace-nowrap text-ink-2">{status.text}</span>;
  }
}
