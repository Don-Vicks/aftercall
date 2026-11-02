import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Bot, CornerDownLeft, Flag, FolderPlus, Lock, MessageCircle, Search, Settings, ShieldCheck, Users, Wallet } from "lucide-react";
import { formatClock, formatUsdc, meetingLabel, search, type Hit, type Meeting } from "@aftercall/core";
import type { SavedRecording } from "./recorder";
import { recordingTitle } from "./RecordingScreen";
import { meetingPeople, shortDuration, shortWhen } from "./MeetingRow";
import { Avatar, AvatarStack, Dialog, cx } from "./ui";
import { EmptyCircle, CheckCircle } from "./primitives/Check";

/** Something the palette can do, as an option in its list. */
interface Option {
  id: string;
  group: "Actions" | "Meetings" | "Results";
  run: () => void;
  render: (active: boolean) => ReactNode;
  /** Results only: the transcript line, so the row aligns to its top. */
  tall?: boolean;
}

export interface PaletteAction {
  id: string;
  label: ReactNode;
  /** Plain words to match the query against. */
  keywords: string;
  icon: ReactNode;
  /** A record dot instead of an icon tile. */
  record?: boolean;
  right?: ReactNode;
  run: () => void;
}

const MAX_RESULTS = 5;
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim();

/**
 * ⌘K: actions, meetings and search results in one list, driven from the keyboard.
 * Focus stays in the field (a combobox); arrow keys move the active option, Enter
 * opens it, ⌘Enter opens the full Search page with the same words, Escape closes.
 * Searches only the meetings on this Mac.
 */
export function CommandPalette({
  meetings,
  recordings,
  balance,
  sampleId,
  onClose,
  onNewRecording,
  onNewProject,
  onOpenWallet,
  onOpenSettings,
  onOpenAgents,
  onOpenAsk,
  onOpenPeople,
  onOpenMeeting,
  onOpenSearch,
}: {
  /** Meetings with notes, plus the sample. */
  meetings: Meeting[];
  /** Every recording, for its date, length and project. */
  recordings: SavedRecording[];
  balance: bigint | null;
  sampleId?: string;
  onClose: () => void;
  onNewRecording: () => void;
  onNewProject: () => void;
  onOpenWallet: () => void;
  onOpenSettings: () => void;
  onOpenAgents: () => void;
  onOpenAsk: () => void;
  onOpenPeople: () => void;
  /** `at` jumps to that second of the transcript. */
  onOpenMeeting: (id: string, at?: number) => void;
  /** The full Search page, with what was typed. */
  onOpenSearch: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const base = useId();
  const q = norm(query);

  /** Closes the palette first, then does the thing, so focus lands on the new screen. */
  const go = (fn: () => void) => () => {
    onClose();
    fn();
  };

  const actions: PaletteAction[] = [
    { id: "record", label: "New recording", keywords: "new recording record start call", icon: null, record: true, right: <Kbd>⌘⇧R</Kbd>, run: onNewRecording },
    {
      id: "wallet",
      label: "Open agent wallet",
      keywords: "agent wallet balance usdc pay payees deposit withdraw caps",
      icon: <Wallet size={15} strokeWidth={1.75} />,
      right: balance === null ? undefined : <span className="font-mono text-xs text-muted">{formatUsdc(balance)} USDC</span>,
      run: onOpenWallet,
    },
    { id: "ask", label: "Ask your meetings", keywords: "ask question meetings", icon: <MessageCircle size={15} strokeWidth={1.75} />, right: <Kbd>⌘J</Kbd>, run: onOpenAsk },
    { id: "project", label: "New project", keywords: "new project folder", icon: <FolderPlus size={15} strokeWidth={1.75} />, run: onNewProject },
    { id: "people", label: "People", keywords: "people person contacts", icon: <Users size={15} strokeWidth={1.75} />, run: onOpenPeople },
    { id: "agents", label: "Coding agents", keywords: "coding agents connected mcp claude codex", icon: <Bot size={15} strokeWidth={1.75} />, run: onOpenAgents },
    { id: "settings", label: "Settings", keywords: "settings near ai account calendar autopilot recovery", icon: <Settings size={15} strokeWidth={1.75} />, run: onOpenSettings },
  ];

  const byRecording = useMemo(() => new Map(recordings.map((r) => [r.id, r])), [recordings]);
  const results = useMemo(() => search(meetings, query), [meetings, query]);

  const options: Option[] = [];
  // Actions: all of them before you type, then the ones whose words match.
  for (const a of q ? actions.filter((a) => q.split(/\s+/).every((w) => norm(a.keywords).includes(w))) : actions.slice(0, 3)) {
    options.push({ id: `a-${a.id}`, group: "Actions", run: go(a.run), render: (on) => <ActionRow action={a} active={on} /> });
  }
  // Meetings: the latest before you type, then those whose title or project matches, or that hold a result.
  const hits = [...results.actions, ...results.decisions, ...results.transcript];
  const holdsHit = new Set(hits.map((h) => h.meetingId));
  const meetingRows = [
    ...recordings
      .filter((r) => !q || holdsHit.has(r.id) || norm(`${recordingTitle(r)} ${r.project} ${meetings.find((mt) => mt.id === r.id)?.title ?? ""}`).includes(q))
      .map((r) => ({ id: r.id, title: meetings.find((mt) => mt.id === r.id)?.title ?? recordingTitle(r), meta: `${r.project} · ${shortWhen(r.startedAt)} · ${shortDuration(r.seconds)}`, mt: meetings.find((mt) => mt.id === r.id) })),
    ...meetings
      .filter((mt) => !byRecording.has(mt.id) && (!q || holdsHit.has(mt.id) || norm(`${mt.title} ${mt.project}`).includes(q)))
      .map((mt) => ({ id: mt.id, title: mt.title, meta: `${mt.project} · ${meetingLabel(mt)}${mt.id === sampleId ? " · sample" : ""}`, mt })),
  ].slice(0, q ? 4 : 3);
  for (const row of meetingRows) {
    options.push({ id: `m-${row.id}`, group: "Meetings", run: go(() => onOpenMeeting(row.id)), render: (on) => <MeetingOption row={row} active={on} /> });
  }
  // Results: what's owed, what was decided, then what was said.
  for (const [i, h] of hits.slice(0, MAX_RESULTS).entries()) {
    options.push({
      id: `r-${i}`,
      group: "Results",
      tall: h.kind === "transcript",
      run: go(() => onOpenMeeting(h.meetingId, h.kind === "transcript" ? h.at : undefined)),
      render: (on) => <ResultOption hit={h} query={query} active={on} />,
    });
  }

  const at = Math.min(active, Math.max(0, options.length - 1));
  const optionId = (i: number) => `${base}-opt-${i}`;
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    document.getElementById(optionId(at))?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (options.length) setActive((at + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      go(() => onOpenSearch(query))();
    } else if (e.key === "Enter") {
      e.preventDefault();
      options[at]?.run();
    }
  };

  const groups = (["Actions", "Meetings", "Results"] as const).map((g) => ({ g, items: options.map((o, i) => ({ o, i })).filter(({ o }) => o.group === g) })).filter((x) => x.items.length);
  const total = hits.length;

  return (
    <Dialog placement="top" aria-label="Command palette" onClose={onClose} initialFocus={input}>
      <label className="relative flex h-[60px] shrink-0 items-center gap-3 border-b border-hairline px-5">
        <Search size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-muted" />
        <span className="sr-only">Search meetings and actions</span>
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={`${base}-list`}
          aria-activedescendant={options.length ? optionId(at) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search meetings, or type a command"
          className="selectable h-10 min-w-0 flex-1 border-0 bg-transparent p-0 text-[17px] leading-6 text-ink outline-none placeholder:text-muted"
        />
        <Kbd>esc</Kbd>
      </label>

      <div id={`${base}-list`} role="listbox" aria-label={q ? `Results for ${query.trim()}` : "Suggestions"} className="flex min-h-0 flex-col gap-1.5 overflow-y-auto p-2">
        {groups.map(({ g, items }) => (
          <div key={g} role="group" aria-labelledby={`${base}-${g}`} className="flex flex-col gap-0.5">
            <span id={`${base}-${g}`} className="px-3 pt-2 pb-1 text-xs leading-4 font-semibold text-muted">
              {g}
              {g === "Results" && total > items.length && <span className="font-medium"> {items.length} of {total}</span>}
            </span>
            {items.map(({ o, i }) => (
              <div
                key={o.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === at}
                onPointerMove={() => i !== at && setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={o.run}
                className={cx("press flex cursor-pointer gap-3 rounded-[10px] px-3", o.tall ? "items-start py-2.5" : "min-h-11 items-center py-1.5", i === at && "bg-verdigris-tint")}
              >
                {o.render(i === at)}
              </div>
            ))}
          </div>
        ))}
        {q.length >= 2 && options.length === 0 && <p className="m-0 px-3 py-6 text-center text-ink-2">Nothing matches “{query.trim()}”.</p>}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-[18px] gap-y-2 border-t border-hairline px-5 py-3 text-xs leading-4 text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>to move
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>↵</Kbd>to open
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>⌘↵</Kbd>to see all results
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          <Lock size={12} strokeWidth={2} aria-hidden="true" />
          Searched on this Mac
        </span>
      </div>
    </Dialog>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] bg-well px-[5px] font-mono text-[11px] text-ink-2 shadow-[inset_0_0_0_1px_var(--hairline)]">
      {children}
    </kbd>
  );
}

/** The ↵ that marks the active option. */
function Enter({ active, className }: { active: boolean; className?: string }) {
  if (!active) return null;
  return (
    <span aria-hidden="true" className={cx("inline-flex text-verdigris", className)} style={{ animation: "ac-pop 240ms var(--ease) both" }}>
      <CornerDownLeft size={15} strokeWidth={2} />
    </span>
  );
}

function ActionRow({ action, active }: { action: PaletteAction; active: boolean }) {
  return (
    <>
      <span aria-hidden="true" className={cx("inline-flex size-7 shrink-0 items-center justify-center rounded-sm", action.record ? "bg-record-tint" : "bg-well text-ink-2")}>
        {action.record ? <span className="size-[9px] rounded-full bg-record" /> : action.icon}
      </span>
      <span className="flex-1 font-semibold">{action.label}</span>
      <Enter active={active} />
      {action.right}
    </>
  );
}

function MeetingOption({ row, active }: { row: { title: string; meta: string; mt?: Meeting }; active: boolean }) {
  return (
    <>
      <span aria-hidden="true" className="inline-flex shrink-0">
        <AvatarStack people={meetingPeople(row.mt)} max={2} size={26} ring="elevated" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate font-semibold">{row.title}</span>
        <span className="truncate text-[13px] text-muted">{row.meta}</span>
      </span>
      <Enter active={active} />
      {row.mt?.verified && <ShieldCheck size={16} strokeWidth={2} role="img" aria-label="Verified" className="shrink-0 text-verdigris" />}
    </>
  );
}

function ResultOption({ hit, query, active }: { hit: Hit; query: string; active: boolean }) {
  if (hit.kind === "transcript") {
    const you = hit.speaker === "you";
    return (
      <>
        <span className="w-9 shrink-0 font-mono text-xs leading-[22px] text-muted">{formatClock(hit.at)}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-serif text-base leading-[22px] text-ink">
            “<Marked text={hit.snippet} query={query} />”
          </span>
          <span className="truncate text-[13px] text-muted">
            {you ? "You" : "Them"} · transcript · {hit.meeting}
          </span>
        </span>
        <Enter active={active} className="mt-1" />
        {you && <Avatar name="You" you size={22} />}
      </>
    );
  }
  if (hit.kind === "action") {
    return (
      <>
        <span aria-hidden="true" className="mx-1 inline-flex shrink-0">
          {hit.done ? <CheckCircle size={20} play={false} /> : <EmptyCircle size={20} />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate font-semibold">
            <Marked text={hit.text} query={query} />
          </span>
          <span className="truncate text-[13px] text-muted">
            Action item · {hit.done ? "done" : "open"} · {hit.meeting}
          </span>
        </span>
        <Enter active={active} />
        <span title={`Owner: ${hit.owner}`} className="inline-flex shrink-0">
          <Avatar name={hit.owner} size={22} />
        </span>
      </>
    );
  }
  return (
    <>
      <span aria-hidden="true" className="mx-1 inline-flex size-5 shrink-0 items-center justify-center text-ink-2">
        <Flag size={15} strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate font-semibold">
          <Marked text={hit.text} query={query} />
        </span>
        <span className="truncate text-[13px] text-muted">Decision · {hit.meeting}</span>
      </span>
      <Enter active={active} />
    </>
  );
}

/** The text with each match of the query marked, so you can see why a result came up. */
export function Marked({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, from)) {
    parts.push(text.slice(from, i), <mark key={i} className="rounded-[3px] bg-caution-tint px-0.5 text-ink">{text.slice(i, i + q.length)}</mark>);
    from = i + q.length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}
