import { useState, type ReactNode } from "react";
import * as m from "motion/react-m";
import { Bot, ChevronDown, ChevronRight, CircleCheck, House, MessageCircle, MoreHorizontal, Plus, Search, Settings, Users, Wallet } from "lucide-react";
import { formatClock, formatUsdc } from "@aftercall/core";
import type { SavedRecording } from "./recorder";
import { recordingTitle, recordingWhen } from "./RecordingScreen";
import type { Project } from "./projects";
import { IconButton, LayoutMotion, Menu, RollingNumber, cx, springs } from "./ui";

export interface SidebarMeeting {
  id: string;
  title: string;
  when: string;
  toApprove: number;
}

/** A recording in progress, as the live row shows it. */
export interface SidebarLive {
  seconds: number;
  paused: boolean;
}

const icon = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

/**
 * The selected row's background. One shared layoutId, so it slides from row to
 * row when the screen changes (a jump with reduced motion).
 */
function Highlight() {
  return <m.span layoutId="sidebar-selected" aria-hidden="true" transition={springs.snappy} className="absolute inset-0 -z-10 rounded-sm bg-elevated shadow-1" />;
}

export function Sidebar({
  projects,
  recordings,
  sample,
  account,
  balance,
  current,
  selectedMeetingId,
  selectedProjectId,
  pendingByMeeting,
  meetingTitles,
  openActions,
  live,
  onOpenLive,
  onOpenHome,
  onOpenSearch,
  onOpenAsk,
  onOpenActions,
  onOpenPeople,
  onOpenMeetings,
  onOpenProject,
  onSelectMeeting,
  onNewRecording,
  onNewProject,
  onRenameProject,
  onDeleteProject,
  onOpenWallet,
  onOpenSettings,
  onOpenAgents,
}: {
  projects: Project[];
  /** Real recordings, under the project they were recorded for. */
  recordings: SavedRecording[];
  /** The built-in sample meeting, shown apart and labelled. */
  sample: SidebarMeeting | null;
  account: string | null;
  balance: bigint | null;
  /** The screen on show, by name ("home", "search", "ask", "actions", "people", "meetings", "project", "wallet", "agents", "settings"). Other names highlight no nav row. */
  current: string;
  selectedMeetingId: string | null;
  /** With current "project": which project's overview is open. */
  selectedProjectId?: string | null;
  pendingByMeeting: Record<string, number>;
  meetingTitles: Record<string, string>;
  /** Open action items across meetings, next to "Action items". */
  openActions: number;
  /** While recording, New recording becomes the live row: a breathing dot and the time. */
  live?: SidebarLive;
  /** The live row opens the recording; without it, the row calls onNewRecording. */
  onOpenLive?: () => void;
  onOpenHome: () => void;
  /** Opens the ⌘K palette. */
  onOpenSearch: () => void;
  onOpenAsk: () => void;
  onOpenActions: () => void;
  onOpenPeople: () => void;
  onOpenMeetings: () => void;
  onOpenProject: (id: string) => void;
  onSelectMeeting: (id: string) => void;
  onNewRecording: () => void;
  onNewProject: () => void;
  onRenameProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onOpenWallet: () => void;
  onOpenSettings: () => void;
  onOpenAgents: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // Recordings whose project was renamed or deleted still show, under "Other".
  const known = new Set(projects.map((p) => p.name));
  const orphans = recordings.filter((r) => !known.has(r.project));
  const groups = [
    ...projects.map((p) => ({ id: p.id, name: p.name, recordings: recordings.filter((r) => r.project === p.name) })),
    ...(orphans.length ? [{ id: "other", name: "Other", recordings: orphans }] : []),
  ];
  const anyMeetings = recordings.length > 0 || sample !== null;

  const meetingRow = (mt: SidebarMeeting) => {
    const selected = mt.id === selectedMeetingId;
    const toApprove = pendingByMeeting[mt.id] ?? mt.toApprove;
    return (
      <button
        key={mt.id}
        onClick={() => onSelectMeeting(mt.id)}
        aria-current={selected ? "page" : undefined}
        className={cx("relative isolate flex items-center gap-2 rounded-sm px-2.5 py-1.5 text-left hover:bg-elevated", selected ? "font-semibold text-ink" : "text-ink-2 hover:text-ink")}
      >
        {selected && <Highlight />}
        <span className="flex-1 truncate">{mt.title}</span>
        {toApprove > 0 ? (
          <span role="img" aria-label={`${toApprove} to approve`} className="size-[7px] shrink-0 rounded-full bg-caution" />
        ) : (
          <span className="shrink-0 font-mono text-[11px] font-normal text-muted">{mt.when}</span>
        )}
      </button>
    );
  };

  const navRow = (label: string, place: string, onClick: () => void, glyph: ReactNode, right?: ReactNode) => {
    const selected = current === place;
    return (
      <button
        onClick={onClick}
        aria-current={selected ? "page" : undefined}
        className={cx("relative isolate flex items-center gap-2.5 rounded-sm px-2.5 py-[7px] text-left hover:bg-elevated", selected ? "font-semibold text-ink" : "text-ink-2 hover:text-ink")}
      >
        {selected && <Highlight />}
        {glyph}
        <span className="flex-1">{label}</span>
        {right}
      </button>
    );
  };
  const shortcut = (keys: string) => <span className="font-mono text-[11px] font-normal text-muted">{keys}</span>;

  return (
    <LayoutMotion>
      <m.nav layoutScroll aria-label="Aftercall" className="flex w-[248px] shrink-0 flex-col gap-[22px] overflow-y-auto bg-ground px-3.5 pb-[18px]">
        {/* Space for the macOS traffic lights; the strip drags the window. */}
        <div data-tauri-drag-region className="-mb-[22px] h-9 shrink-0" />

        <div className="flex items-center justify-between gap-2 px-2 pt-1.5">
          <span className="font-serif text-[21px] leading-6 font-medium tracking-[-0.01em]">Aftercall</span>
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted" title={account ?? undefined}>
            {account && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-verdigris" />}
            <span className="truncate">{account ?? "Not connected"}</span>
          </span>
        </div>

        {live ? (
          <button
            onClick={onOpenLive ?? onNewRecording}
            className="press flex h-[38px] shrink-0 items-center gap-2.5 rounded-[10px] bg-record-tint px-3 text-left font-semibold text-record"
          >
            <span
              aria-hidden="true"
              className="size-[9px] shrink-0 rounded-full"
              style={{ background: live.paused ? "var(--faint)" : "var(--record)", animation: live.paused ? undefined : "ac-breathe 2s ease-in-out infinite" }}
            />
            <span className="flex-1">{live.paused ? "Paused" : "Recording"}</span>
            <span className="font-mono text-xs font-medium tabular-nums">{formatClock(live.seconds)}</span>
          </button>
        ) : (
          <button
            onClick={onNewRecording}
            className="press lift flex h-[38px] shrink-0 items-center gap-2.5 rounded-[10px] bg-elevated px-3 text-left font-semibold text-ink shadow-1"
          >
            <span aria-hidden="true" className="size-[9px] shrink-0 rounded-full bg-record" />
            <span className="flex-1">New recording</span>
            {shortcut("⌘⇧R")}
          </button>
        )}

        <div className="flex flex-col gap-0.5">
          {navRow("Today", "home", onOpenHome, <House {...icon} />)}
          {navRow("Search", "search", onOpenSearch, <Search {...icon} />, shortcut("⌘K"))}
          {navRow("Ask your meetings", "ask", onOpenAsk, <MessageCircle {...icon} />, shortcut("⌘J"))}
          {navRow("Action items", "actions", onOpenActions, <CircleCheck {...icon} />, openActions > 0 ? shortcut(String(openActions)) : undefined)}
          {navRow("People", "people", onOpenPeople, <Users {...icon} />)}
        </div>

        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between gap-2 pb-1.5 pl-2.5">
            <span className="text-[13px] font-semibold text-ink-2">Projects</span>
            <span className="flex items-center gap-0.5">
              {anyMeetings && (
                <button
                  onClick={onOpenMeetings}
                  aria-current={current === "meetings" ? "page" : undefined}
                  className={cx("rounded-sm px-1.5 text-xs hover:text-ink", current === "meetings" ? "font-semibold text-ink" : "text-muted")}
                >
                  All meetings
                </button>
              )}
              <IconButton aria-label="New project" variant="quiet" size="sm" tooltipSide="bottom" onClick={onNewProject}>
                <Plus size={14} strokeWidth={2} />
              </IconButton>
            </span>
          </div>

          {groups.map((g, gi) => {
            const meetings = g.recordings.map((r) => ({ id: r.id, title: meetingTitles[r.id] ?? recordingTitle(r), when: r.label ?? recordingWhen(r), toApprove: 0 }));
            const isOpen = open[g.id] ?? (meetings.some((mt) => mt.id === selectedMeetingId) || gi === 0);
            const Chevron = isOpen ? ChevronDown : ChevronRight;
            const isProject = g.id !== "other";
            const selected = isProject && current === "project" && selectedProjectId === g.id;
            return (
              <div key={g.id} className="flex flex-col gap-0.5">
                <div className={cx("group relative isolate flex items-center rounded-sm hover:bg-elevated", selected || isOpen ? "font-semibold text-ink" : "text-ink-2")}>
                  {selected && <Highlight />}
                  <button
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? "Hide" : "Show"} meetings in ${g.name}`}
                    onClick={() => setOpen((o) => ({ ...o, [g.id]: !isOpen }))}
                    className="flex h-[34px] w-6 shrink-0 items-center justify-end text-faint hover:text-ink"
                  >
                    <Chevron size={12} strokeWidth={2} aria-hidden="true" />
                  </button>
                  {isProject ? (
                    <button
                      onClick={() => onOpenProject(g.id)}
                      aria-current={selected ? "page" : undefined}
                      className="flex min-w-0 flex-1 items-center py-[7px] pr-2 pl-2 text-left hover:text-ink"
                    >
                      <span className="truncate">{g.name}</span>
                    </button>
                  ) : (
                    <span className="min-w-0 flex-1 truncate py-[7px] pr-2 pl-2">{g.name}</span>
                  )}
                  <span className={cx("pr-2.5 font-mono text-[11px] font-normal text-muted", isProject && "transition-opacity group-focus-within:opacity-0 group-hover:opacity-0")}>
                    {meetings.length}
                  </span>
                  {isProject && (
                    <span className="absolute top-1/2 right-1 -translate-y-1/2">
                      <Menu
                        label={`${g.name} options`}
                        align="end"
                        width={180}
                        trigger={(p) => (
                          <IconButton
                            {...p}
                            aria-label={`${g.name} options`}
                            tooltip={false}
                            size="sm"
                            variant="quiet"
                            className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
                          >
                            <MoreHorizontal size={14} />
                          </IconButton>
                        )}
                        items={[
                          { label: "Open overview", onSelect: () => onOpenProject(g.id) },
                          { label: "Rename", onSelect: () => onRenameProject(g.id) },
                          null,
                          { label: "Delete project", tone: "danger", onSelect: () => onDeleteProject(g.id) },
                        ]}
                      />
                    </span>
                  )}
                </div>
                {isOpen && (
                  <div className="ml-[15px] flex flex-col gap-0.5 border-l border-hairline pl-2.5">
                    {meetings.length ? meetings.map(meetingRow) : <span className="px-2.5 py-1 text-[13px] text-muted">No meetings yet</span>}
                  </div>
                )}
              </div>
            );
          })}

          {sample && (
            <div className="mt-3 flex flex-col gap-0.5">
              <span className="px-2.5 pb-1 text-xs font-medium text-muted">Sample</span>
              {meetingRow(sample)}
            </div>
          )}
        </div>

        <div className="mt-auto flex flex-col gap-0.5">
          {navRow(
            "Agent wallet",
            "wallet",
            onOpenWallet,
            <Wallet {...icon} />,
            balance === null ? undefined : <RollingNumber value={formatUsdc(balance)} className="font-mono text-xs font-normal text-ink" />,
          )}
          {navRow("Connected agents", "agents", onOpenAgents, <Bot {...icon} />)}
          {navRow("Settings", "settings", onOpenSettings, <Settings {...icon} />)}
        </div>
      </m.nav>
    </LayoutMotion>
  );
}
