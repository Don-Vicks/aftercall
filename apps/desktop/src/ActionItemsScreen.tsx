import { useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  buildPeople,
  clockTime,
  dueGroup,
  dueLabel,
  isYou,
  meetingTime,
  parseDue,
  relativeDay,
  shortDate,
  startOfDay,
  type ActionItem,
  type AgentMark,
  type DueGroup,
  type ItemFields,
  type Meeting,
} from "@aftercall/core";
import { Avatar, Menu, Strike, TabPanel, Tabs, Tick, cx, toast } from "./ui";
import { EditItemButton, EditedMark, ItemEditor, useItemEditing, type EditItem, type OriginalOf } from "./ActionItemEditor";
import { Empty, Footnote, Page, PageHeader, rise } from "./PagePieces";
import { plural } from "./library";

type Tab = "mine" | "others" | "agents";

interface Row {
  key: string;
  meeting: Meeting;
  item: ActionItem;
  /** The owner's name as the people list knows them (full name from the invite). */
  ownerName: string;
  due: number | null;
  group: DueGroup;
}

const GROUPS: { id: DueGroup; title: string }[] = [
  { id: "overdue", title: "Overdue" },
  { id: "today", title: "Today" },
  { id: "week", title: "This week" },
  { id: "later", title: "Later" },
  { id: "none", title: "No date" },
];

/** "CC" for Claude Code, "CX" for Codex. */
function agentInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length > 1) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  const w = words[0];
  return (w[0] + (w.length > 1 ? w[w.length - 1] : "")).toUpperCase();
}

/** "14:20" today, "30 Oct" before. */
function markTime(mark: AgentMark, now: number): string {
  const t = Date.parse(mark.at);
  if (Number.isNaN(t)) return "";
  return startOfDay(t) === startOfDay(now) ? clockTime(t) : shortDate(t, now);
}

/** What an agent did with an item, in the board's words. */
function agentLine(a: ActionItem, now: number): { lead: string; rest: string } | null {
  if (a.completed) {
    return a.done
      ? { lead: `Done by ${a.completed.agent}`, rest: ` · ${markTime(a.completed, now)} · ` }
      : { lead: "Reopened by you", rest: ` · ${a.completed.agent} finished it at ${markTime(a.completed, now)} · ` };
  }
  if (a.claimed) return a.done ? { lead: "Closed by you", rest: " · " } : { lead: `${a.claimed.agent} is on it`, rest: ` · since ${markTime(a.claimed, now)} · ` };
  return null;
}

/**
 * Every action item across meetings: yours, what others owe you, and what connected
 * agents took on. Ticking or editing one here changes it in its meeting (saved in its notes.json).
 */
export function ActionItemsScreen({
  meetings,
  me,
  onToggleItem,
  onEditItem,
  originalOf,
  onOpenMeeting,
  onOpenAgents,
}: {
  meetings: Meeting[];
  me: readonly string[];
  onToggleItem: (meetingId: string, itemId: string) => void;
  onEditItem?: EditItem;
  originalOf?: OriginalOf;
  onOpenMeeting: (id: string) => void;
  onOpenAgents: () => void;
}) {
  const [now] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>("mine");
  const [project, setProject] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  /** Items ticked or unticked on this visit stay where they were, struck through, until you leave. */
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const index = useMemo(() => buildPeople(meetings, { me, now }), [meetings, me, now]);

  const rows: Row[] = useMemo(
    () =>
      meetings.flatMap((m) =>
        m.actionItems.map((a) => {
          const due = parseDue(a.due, meetingTime(m, now));
          const owner = index.people.find((p) => p.theyOwe.some((i) => i.meetingId === m.id && i.itemId === a.id));
          return { key: `${m.id}:${a.id}`, meeting: m, item: a, ownerName: owner?.name ?? a.owner, due, group: dueGroup(due, now) };
        }),
      ),
    [meetings, index, now],
  );

  const inProject = rows.filter((r) => !project || r.meeting.project === project);
  const mine = (r: Row) => isYou(r.item.owner, me) || r.item.owner === "Unassigned";
  const byTab: Record<Tab, Row[]> = {
    mine: inProject.filter(mine),
    others: inProject.filter((r) => !mine(r)),
    agents: inProject.filter((r) => r.item.claimed || r.item.completed),
  };
  const projects = [...new Set(meetings.map((m) => m.project))].sort();
  const openOf = (list: Row[]) => list.filter((r) => !r.item.done).length;

  const toggle = (r: Row) => {
    setTouched((s) => new Set(s).add(r.key));
    onToggleItem(r.meeting.id, r.item.id);
  };

  /** The tab an edited item moved to, so focus can go there when its row has left this one. */
  const movedTo = useRef<Tab | null>(null);

  /** Saves an edit; when the new owner moves the item to the other tab, says where it went. */
  const edit = (r: Row, fields: ItemFields | null) => {
    if (!onEditItem) return;
    onEditItem(r.meeting.id, r.item.id, fields);
    const now = fields ?? originalOf?.(r.meeting.id, r.item.id);
    const owner = now?.owner ?? r.item.owner;
    const wasMine = mine(r);
    const nowMine = isYou(owner, me) || owner === "Unassigned";
    movedTo.current = tab !== "agents" && wasMine !== nowMine ? (nowMine ? "mine" : "others") : null;
    if (movedTo.current) toast({ text: `“${now?.text ?? r.item.text}” moved to ${nowMine ? "Mine" : "Others owe me"}` });
  };

  /** The row left this tab: focus the tab that now holds it. */
  const focusMoved = () => {
    if (movedTo.current) document.getElementById(`actions-tab-${movedTo.current}`)?.focus();
  };

  const list = byTab[tab];
  const visible = (r: Row) => !r.item.done || touched.has(r.key);
  const sections =
    tab === "agents"
      ? [
          { id: "claimed", title: "Claimed", caution: false, rows: list.filter((r) => !r.item.completed && (!r.item.done || touched.has(r.key))) },
          { id: "completed", title: "Completed", caution: false, rows: list.filter((r) => r.item.completed || (r.item.done && !touched.has(r.key))) },
        ]
      : GROUPS.map((g) => ({
          id: g.id,
          title: g.title,
          caution: g.id === "overdue",
          rows: list.filter((r) => visible(r) && r.group === g.id).sort((a, b) => (a.due ?? 0) - (b.due ?? 0)),
        }));
  const done = tab === "agents" ? [] : list.filter((r) => !visible(r));
  let n = 0;

  return (
    <Page className="gap-7">
      <PageHeader eyebrow={`Across ${plural(meetings.length, "meeting")}`} title="Action items" intro="What your meetings said someone would do, and who's doing it." />

      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline" style={rise(1)}>
        <Tabs
          id="actions"
          label="Whose action items"
          className="border-b-0"
          value={tab}
          onChange={(t) => {
            setTab(t);
            setShowDone(false);
          }}
          items={[
            { id: "mine", label: "Mine", count: openOf(byTab.mine) },
            { id: "others", label: "Others owe me", count: openOf(byTab.others) },
            { id: "agents", label: "Agents", count: byTab.agents.filter((r) => r.item.claimed && !r.item.completed && !r.item.done).length },
          ]}
        />
        {projects.length > 1 && (
          <Menu
            label="Filter by project"
            align="end"
            trigger={(p) => (
              <button {...p} type="button" className="press mb-1 inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-[13px] font-semibold text-ink-2 hover:text-ink">
                {project ?? "All projects"}
                <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
            items={[{ label: "All projects", onSelect: () => setProject(null) }, null, ...projects.map((name) => ({ label: name, onSelect: () => setProject(name) }))]}
          />
        )}
      </div>

      <TabPanel tabsId="actions" value={tab} className="-mt-3 flex flex-col">
        {sections.every((s) => s.rows.length === 0) && (
          <div style={rise(2)}>
            <Empty title={tab === "mine" ? "Nothing open for you" : tab === "others" ? "No one owes you anything open" : "No agent has taken an item yet"}>
              {tab === "agents"
                ? "With Connected agents on, Claude Code or Codex can claim an action item and mark it done. You'll see it here."
                : meetings.length === 0
                  ? "Action items appear once a recorded meeting has notes."
                  : done.length
                    ? `${plural(done.length, "item")} already done.`
                    : "Your meetings haven't named any here yet."}
            </Empty>
          </div>
        )}
        {sections.map((s, si) =>
          s.rows.length === 0 ? null : (
            <section key={s.id} aria-labelledby={`ai-${s.id}`} className="flex flex-col">
              <h2
                id={`ai-${s.id}`}
                className={cx(
                  "t-section m-0 border-b border-hairline pb-2",
                  si === 0 || sections.slice(0, si).every((x) => x.rows.length === 0) ? "mt-1" : "mt-7",
                  s.caution ? "text-caution" : "text-ink",
                )}
                style={rise(Math.min(n++, 10))}
              >
                {s.title} <span className="font-medium text-muted">{s.rows.length}</span>
              </h2>
              {s.rows.map((r) => (
                <ItemRow
                  key={r.key}
                  row={r}
                  tab={tab}
                  now={now}
                  index={Math.min(n++, 10)}
                  onToggle={() => toggle(r)}
                  onEdit={onEditItem && ((fields) => edit(r, fields))}
                  onEditGone={focusMoved}
                  original={originalOf?.(r.meeting.id, r.item.id) ?? null}
                  onOpenMeeting={() => onOpenMeeting(r.meeting.id)}
                />
              ))}
            </section>
          ),
        )}

        {done.length > 0 && (
          <div className="mt-6 flex flex-col">
            <button
              type="button"
              className="press inline-flex items-center gap-1.5 self-start rounded-sm text-[13px] font-semibold text-ink-2 hover:text-ink"
              aria-expanded={showDone}
              onClick={() => setShowDone((v) => !v)}
            >
              {showDone ? "Hide" : "Show"} {plural(done.length, "done item")}
              <ChevronDown size={12} strokeWidth={2} aria-hidden="true" className={cx("transition-transform duration-(--dur-1)", showDone && "rotate-180")} />
            </button>
            {showDone && (
              <section aria-label="Done" className="mt-2 flex flex-col border-t border-hairline">
                {done.map((r, i) => (
                  <ItemRow
                    key={r.key}
                    row={r}
                    tab={tab}
                    now={now}
                    index={Math.min(i, 10)}
                    onToggle={() => toggle(r)}
                    onEdit={onEditItem && ((fields) => edit(r, fields))}
                    onEditGone={focusMoved}
                    original={originalOf?.(r.meeting.id, r.item.id) ?? null}
                    onOpenMeeting={() => onOpenMeeting(r.meeting.id)}
                  />
                ))}
              </section>
            )}
          </div>
        )}

        {(tab === "agents" || list.length > 0) && (
          <p className="m-0 mt-4 text-[13px] leading-[19px] text-ink-2" style={rise(Math.min(n, 10) + 1)}>
            {tab === "agents" ? (
              <>
                Agents can claim and finish action items. They can't send, pay or change your notes or rules.{" "}
                <button type="button" onClick={onOpenAgents} className="rounded-sm font-semibold text-verdigris hover:text-verdigris-hover">
                  Connected agents
                </button>
              </>
            ) : (
              "Ticking or editing an item here changes it in its meeting too."
            )}
          </p>
        )}
      </TabPanel>

      {tab !== "agents" && rows.some((r) => r.item.due && r.due === null) && (
        <Footnote>Dates like “soon” can't be placed on a day, so those items sit under No date with the words that were said.</Footnote>
      )}
    </Page>
  );
}

function AgentBadge({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-elevated font-mono text-[11px] font-medium text-ink-2 shadow-[inset_0_0_0_1px_var(--hairline),0_0_0_2px_var(--raised)]"
    >
      {agentInitials(name)}
    </span>
  );
}

function ItemRow({
  row: r,
  tab,
  now,
  index,
  onToggle,
  onEdit,
  onEditGone,
  original,
  onOpenMeeting,
}: {
  row: Row;
  tab: Tab;
  now: number;
  index: number;
  onToggle: () => void;
  onEdit?: (fields: ItemFields | null) => void;
  /** After an edit moved the row off this tab. */
  onEditGone?: () => void;
  original: ItemFields | null;
  onOpenMeeting: () => void;
}) {
  const textId = useId();
  const editing = useItemEditing(r.key, onEditGone);
  const a = r.item;
  const agent = a.completed?.agent ?? a.claimed?.agent;
  const line = agentLine(a, now);
  const mt = meetingTime(r.meeting, now);
  const when = mt === null ? "" : ` · ${relativeDay(mt, now)}`;
  const label = a.done ? "" : r.due !== null ? dueLabel(r.due, now) : (a.due ?? "");
  const overdue = !a.done && r.group === "overdue";
  const unassigned = a.owner === "Unassigned";
  const quote = a.completed?.note;

  if (editing.editing && onEdit) {
    return (
      <div className="flex border-b border-hairline py-3 pl-[34px]">
        <ItemEditor
          item={a}
          original={original}
          onSave={(fields) => {
            onEdit(fields);
            editing.close();
          }}
          onRestore={() => {
            onEdit(null);
            editing.close();
          }}
          onCancel={editing.close}
        />
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-3 border-b border-hairline py-3" style={{ animation: `ac-in 280ms ${index * 40}ms var(--ease) both` }}>
      <Tick checked={a.done} onChange={onToggle} aria-labelledby={textId} />
      <span className={cx("flex min-w-0 flex-1 flex-col gap-0.5", onEdit && "pr-7")}>
        <span className="max-w-full self-start text-[15px] leading-[21px] text-ink">
          <span id={textId} className="selectable">
            <Strike on={a.done}>{a.text}</Strike>
          </span>
          <EditedMark item={a} />
        </span>
        <span className="truncate text-[13px] leading-[19px]">
          {tab === "others" && (
            <>
              <span className="font-medium text-ink">{r.ownerName}</span>
              <span className="text-muted"> · </span>
            </>
          )}
          {tab === "mine" && unassigned && <span className="text-muted">No owner named · </span>}
          {line && (tab === "agents" || tab === "mine") && (
            <>
              <span className="font-medium text-verdigris">{line.lead}</span>
              <span className="text-muted">{line.rest}</span>
            </>
          )}
          <button type="button" onClick={onOpenMeeting} className="rounded-sm text-ink-2 underline decoration-border decoration-1 underline-offset-[3px] hover:text-ink">
            {r.meeting.title}
          </button>
          <span className="text-muted">{when}</span>
        </span>
        {tab === "agents" && a.done && quote && <span className="selectable font-serif text-[15px] leading-[22px] text-ink-2 italic">“{quote}”</span>}
      </span>
      <span className={cx("w-24 shrink-0 text-right text-[13px] whitespace-nowrap", a.done ? "text-muted" : overdue ? "font-medium text-caution" : r.due === null ? "text-muted" : "text-ink-2")}>
        <span className="relative">
          {onEdit && <EditItemButton id={editing.buttonId} text={a.text} onClick={editing.open} />}
          {label}
        </span>
      </span>
      <span
        className="flex w-[52px] shrink-0 justify-end"
        role="img"
        aria-label={tab === "agents" && agent ? agent : agent && tab === "mine" ? `You, with ${agent} on it` : tab === "others" ? r.ownerName : "You"}
      >
        {tab === "agents" && agent ? (
          <AgentBadge name={agent} />
        ) : (
          <>
            <Avatar name={tab === "others" ? r.ownerName : "You"} you={tab !== "others"} size={28} ring="raised" decorative />
            {tab === "mine" && agent && (
              <span className="-ml-1.5 inline-flex">
                <AgentBadge name={agent} />
              </span>
            )}
          </>
        )}
      </span>
    </div>
  );
}
