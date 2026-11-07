import { useId, useMemo, useRef, useState, type FocusEvent } from "react";
import { ChevronDown } from "lucide-react";
import {
  boardPlace,
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
  type BoardState,
  type DueGroup,
  type ItemFields,
  type Meeting,
} from "@aftercall/core";
import { Avatar, Button, Menu, Strike, TabPanel, Tabs, Tick, cx, toast } from "./ui";
import { AllDone, QuoteReveal, useAllDone, useQuoteReveal } from "./Quote";
import { EditItemButton, EditedMark, ItemEditor, editButtonId, focusEditButton, type EditItem, type OriginalOf } from "./ActionItemEditor";
import { Empty, Footnote, Page, PageHeader, rise } from "./PagePieces";
import { HandToAgent } from "./HandToAgent";
import { WorkLink } from "./WorkLink";
import { ShortcutsHint, rovingRowClass, useRovingList } from "./primitives/useRovingList";
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
  /** Opens a meeting; with `at`, on its transcript at that second. */
  onOpenMeeting: (id: string, at?: number) => void;
  onOpenAgents: () => void;
}) {
  const [now] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>("mine");
  const [project, setProject] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  /** Items ticked or unticked on this visit stay where they were, struck through, until you leave. */
  const [touched, setTouched] = useState<Set<string>>(new Set());
  /**
   * The row being edited, with the item as it was when the editor opened. Kept here,
   * not in the row, so the row keeps its place (and your draft) when an agent completes
   * the item meanwhile; see `boardPlace`.
   */
  const [editing, setEditing] = useState<{ key: string; held: BoardState } | null>(null);
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

  const openEditor = (r: Row) => setEditing({ key: r.key, held: { done: r.item.done, completed: r.item.completed } });
  /** Closes the editor. An item an agent finished meanwhile stays where it was, struck through, like one you ticked. */
  const closeEditor = (r: Row) => {
    if (editing?.key === r.key && editing.held.done !== r.item.done) setTouched((s) => new Set(s).add(r.key));
    setEditing(null);
    focusEditButton(r.key, focusMoved);
  };

  const list = byTab[tab];
  const place = (r: Row) => boardPlace(r.item, tab === "agents", { touched: touched.has(r.key), held: editing?.key === r.key ? editing.held : undefined });
  const visible = (r: Row) => place(r) === "open";
  const sections =
    tab === "agents"
      ? [
          { id: "claimed", title: "Claimed", caution: false, rows: list.filter((r) => place(r) === "claimed") },
          { id: "completed", title: "Completed", caution: false, rows: list.filter((r) => place(r) === "completed") },
        ]
      : GROUPS.map((g) => ({
          id: g.id,
          title: g.title,
          caution: g.id === "overdue",
          rows: list.filter((r) => visible(r) && r.group === g.id).sort((a, b) => (a.due ?? 0) - (b.due ?? 0)),
        }));
  const done = tab === "agents" ? [] : list.filter((r) => !visible(r));
  const openHere = tab === "agents" ? 1 : openOf(list);
  const allDone = useAllDone(openHere, list.length, `${tab}:${project ?? ""}`);
  const empty = sections.every((s) => s.rows.length === 0);
  let n = 0;

  // j/k through the rows as they're shown, x ticks, e edits, ↵ shows the quote's moment.
  const ordered = [...sections.flatMap((s) => s.rows), ...(showDone ? done : [])];
  const byKey = new Map(ordered.map((r) => [r.key, r]));
  const roving = useRovingList(
    ordered.map((r) => r.key),
    {
      onTick: (k) => byKey.has(k) && toggle(byKey.get(k)!),
      onEdit: onEditItem && ((k) => byKey.has(k) && openEditor(byKey.get(k)!)),
      onOpen: (k) => {
        const r = byKey.get(k);
        if (r) onOpenMeeting(r.meeting.id, r.item.evidence?.at);
      },
    },
    { enabled: editing === null, title: "Action items", words: { onOpen: "Open its moment in the transcript" } },
  );

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
            setEditing(null);
          }}
          items={[
            { id: "mine", label: "Mine", count: openOf(byTab.mine) },
            { id: "others", label: "Others owe me", count: openOf(byTab.others) },
            { id: "agents", label: "Agents", count: byTab.agents.filter((r) => r.item.claimed && !r.item.completed && !r.item.done).length },
          ]}
        />
        <span className="mb-1 ml-auto flex items-center gap-1">
          {!empty && <ShortcutsHint onClick={roving.openHelp} />}
        </span>
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
        {empty && (
          <div style={rise(2)}>
            <EmptyState tab={tab} meetings={meetings.length} done={done.length} openMine={openOf(byTab.mine)} onShowDone={() => setShowDone(true)} onMine={() => setTab("mine")} />
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
                  editing={editing?.key === r.key}
                  onOpenEditor={() => openEditor(r)}
                  onCloseEditor={() => closeEditor(r)}
                  original={originalOf?.(r.meeting.id, r.item.id) ?? null}
                  onOpenMeeting={() => onOpenMeeting(r.meeting.id)}
                  onJump={(at) => onOpenMeeting(r.meeting.id, at)}
                  roving={roving.row(r.key)}
                />
              ))}
            </section>
          ),
        )}

        {tab !== "agents" && !empty && (
          <AllDone show={openHere === 0} animate={allDone.animate}>
            {tab === "mine" ? "Nothing of yours is open." : "Nothing anyone owes you is open."}
          </AllDone>
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
                    editing={editing?.key === r.key}
                    onOpenEditor={() => openEditor(r)}
                    onCloseEditor={() => closeEditor(r)}
                    original={originalOf?.(r.meeting.id, r.item.id) ?? null}
                    onOpenMeeting={() => onOpenMeeting(r.meeting.id)}
                    onJump={(at) => onOpenMeeting(r.meeting.id, at)}
                    roving={roving.row(r.key)}
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
                When you allow it, agents can claim and finish action items. They can't send, pay, or change anything else in your notes or rules.{" "}
                <button type="button" onClick={onOpenAgents} className="rounded-sm font-semibold text-verdigris hover:text-verdigris-hover">
                  Coding agents
                </button>
              </>
            ) : (
              "Ticking or editing an item here changes it in its meeting too."
            )}
          </p>
        )}
      </TabPanel>

      {roving.sheet}

      {tab !== "agents" && rows.some((r) => r.item.due && r.due === null) && (
        <Footnote>Dates like “soon” can't be placed on a day, so those items sit under No date with the words that were said.</Footnote>
      )}
    </Page>
  );
}

/** What an empty tab says: why it's empty, and where to go from here. */
function EmptyState({
  tab,
  meetings,
  done,
  openMine,
  onShowDone,
  onMine,
}: {
  tab: Tab;
  meetings: number;
  done: number;
  openMine: number;
  onShowDone: () => void;
  onMine: () => void;
}) {
  if (tab === "agents") {
    return (
      <Empty title="No agent has taken an item yet">
        With Coding agents on and claiming allowed, Claude Code or Codex can claim an action item and mark it done. You'll see it here.
      </Empty>
    );
  }
  if (meetings === 0) {
    return (
      <Empty title="No action items yet">
        Record a meeting and its notes list who said they'd do what, each with the exact words from the call. They gather here.
      </Empty>
    );
  }
  const showDone = done > 0 && (
    <Button variant="secondary" size="sm" onClick={onShowDone}>
      Show {plural(done, "done item")}
    </Button>
  );
  if (tab === "mine") {
    return done > 0 ? (
      <Empty title="All clear" action={showDone}>
        {done === 1 ? "Your one action item is done." : `All ${done} of your action items are done.`} New ones arrive with the next meeting's notes, each with the words that were said.
      </Empty>
    ) : (
      <Empty title="Nothing for you yet">When someone on a call says you'll do something, it lands here with the exact words that were said.</Empty>
    );
  }
  const toMine =
    openMine > 0 ? (
      <Button variant="secondary" size="sm" onClick={onMine}>
        See your {plural(openMine, "open item")}
      </Button>
    ) : (
      showDone
    );
  return done > 0 ? (
    <Empty title="Nobody owes you anything open" action={toMine}>
      {done === 1 ? "The one item someone else said they'd do is done." : `All ${done} items others said they'd do are done.`} New promises from your calls land here with their words.
    </Empty>
  ) : (
    <Empty title="Nobody owes you anything yet" action={toMine}>
      When someone on a call says “I'll send it” or “I'll check with legal”, it shows up here with their words, so you know what to chase.
    </Empty>
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
  editing,
  onOpenEditor,
  onCloseEditor,
  original,
  onOpenMeeting,
  onJump,
  roving,
}: {
  row: Row;
  tab: Tab;
  now: number;
  index: number;
  onToggle: () => void;
  onEdit?: (fields: ItemFields | null) => void;
  /** Whether this row's editor is open; the screen keeps that, so the row keeps its place while you edit. */
  editing: boolean;
  onOpenEditor: () => void;
  /** Closes the editor and puts focus back on the row's Edit button, or on the tab the row moved to. */
  onCloseEditor: () => void;
  original: ItemFields | null;
  onOpenMeeting: () => void;
  /** Opens the meeting's transcript at the item's quote. */
  onJump: (at: number) => void;
  /** The keyboard focus row's props (useRovingList). */
  roving?: ReturnType<ReturnType<typeof useRovingList>["row"]>;
}) {
  const textId = useId();
  const quoteId = useId();
  const a = r.item;
  const reveal = useQuoteReveal(!!a.evidence && !editing);
  const agent = a.completed?.agent ?? a.claimed?.agent;
  const line = agentLine(a, now);
  const mt = meetingTime(r.meeting, now);
  const when = mt === null ? "" : ` · ${relativeDay(mt, now)}`;
  const label = a.done ? "" : r.due !== null ? dueLabel(r.due, now) : (a.due ?? "");
  const overdue = !a.done && r.group === "overdue";
  const unassigned = a.owner === "Unassigned";
  const quote = a.completed?.note;

  if (editing && onEdit) {
    return (
      <div className="flex border-b border-hairline py-3 pl-[34px]">
        <ItemEditor
          item={a}
          original={original}
          onSave={(fields) => {
            onEdit(fields);
            onCloseEditor();
          }}
          onRestore={() => {
            onEdit(null);
            onCloseEditor();
          }}
          onCancel={onCloseEditor}
        />
      </div>
    );
  }

  return (
    <div
      {...roving}
      {...reveal.bind}
      onFocus={(e: FocusEvent) => {
        roving?.onFocus();
        (reveal.bind as { onFocus?: (e: FocusEvent) => void }).onFocus?.(e);
      }}
      className={cx("group border-b border-hairline py-3", roving && rovingRowClass)}
      style={{ animation: `ac-in 280ms ${index * 40}ms var(--ease) both` }}
    >
      <div className="flex items-center gap-3">
        <Tick checked={a.done} onChange={onToggle} aria-labelledby={textId} aria-describedby={a.evidence ? quoteId : undefined} />
        <span className={cx("flex min-w-0 flex-1 flex-col gap-0.5", !a.done ? "pr-14" : onEdit && "pr-7")}>
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
                {a.done && a.completed?.link && (
                  <>
                    <span className="text-muted"> · </span>
                    <WorkLink completion={a.completed} />
                  </>
                )}
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
            {!a.done && <HandToAgent meeting={r.meeting} item={a} />}
            {onEdit && <EditItemButton id={editButtonId(r.key)} text={a.text} onClick={onOpenEditor} />}
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
      {a.evidence && <QuoteReveal evidence={a.evidence} open={reveal.open} descId={quoteId} onJump={() => onJump(a.evidence!.at)} className="pr-[140px] pl-[34px]" />}
    </div>
  );
}
