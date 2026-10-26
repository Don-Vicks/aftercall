import { useEffect, useState, type ReactNode } from "react";
import { Bot, ChevronDown, ChevronRight, House, MoreHorizontal, Plus, Search, Settings, Wallet } from "lucide-react";
import { formatUsdc } from "@aftercall/core";
import type { SavedRecording } from "./recorder";
import { recordingTitle, recordingWhen } from "./RecordingScreen";
import type { Project } from "./projects";
import { cx } from "./ui";

export interface SidebarMeeting {
  id: string;
  title: string;
  when: string;
  toApprove: number;
}

export function Sidebar({
  projects,
  recordings,
  sample,
  account,
  balance,
  selectedMeetingId,
  pendingByMeeting,
  meetingTitles,
  homeSelected,
  searchSelected,
  walletSelected,
  settingsSelected,
  agentsSelected,
  onOpenHome,
  onOpenSearch,
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
  selectedMeetingId: string | null;
  pendingByMeeting: Record<string, number>;
  meetingTitles: Record<string, string>;
  homeSelected: boolean;
  searchSelected: boolean;
  walletSelected: boolean;
  settingsSelected: boolean;
  agentsSelected: boolean;
  onOpenHome: () => void;
  onOpenSearch: () => void;
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
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // A click anywhere else, or Escape, closes the project menu.
  useEffect(() => {
    if (!menuFor) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e.target instanceof Element && e.target.closest("[data-project-menu]")) return;
      setMenuFor(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [menuFor]);

  // Recordings whose project was renamed or deleted still show, under "Other".
  const known = new Set(projects.map((p) => p.name));
  const orphans = recordings.filter((r) => !known.has(r.project));
  const groups = [
    ...projects.map((p) => ({ id: p.id, name: p.name, recordings: recordings.filter((r) => r.project === p.name) })),
    ...(orphans.length ? [{ id: "other", name: "Other", recordings: orphans }] : []),
  ];

  const meetingRow = (m: SidebarMeeting) => {
    const selected = m.id === selectedMeetingId;
    const toApprove = pendingByMeeting[m.id] ?? m.toApprove;
    return (
      <button
        key={m.id}
        onClick={() => onSelectMeeting(m.id)}
        aria-current={selected ? "page" : undefined}
        className={cx("flex items-center gap-2 rounded-sm px-2 py-[7px] text-left", selected ? "bg-elevated text-ink" : "text-muted hover:text-ink")}
      >
        <span className={cx("flex-1 truncate", selected && "font-semibold")}>{m.title}</span>
        {toApprove > 0 ? (
          <span role="img" aria-label={`${toApprove} to approve`} className="size-[7px] shrink-0 rounded-full bg-caution" />
        ) : (
          <span className="shrink-0 font-mono text-[11px]">{m.when}</span>
        )}
      </button>
    );
  };

  const navRow = (label: string, selected: boolean, onClick: () => void, right?: ReactNode, icon?: ReactNode) => (
    <button
      onClick={onClick}
      aria-current={selected ? "page" : undefined}
      className={cx("flex items-center gap-2.5 rounded-sm px-2 py-[7px] text-left", selected ? "bg-elevated font-semibold text-ink" : "text-muted hover:text-ink")}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {right}
    </button>
  );

  return (
    <nav aria-label="Projects" className="flex w-[248px] shrink-0 flex-col gap-7 overflow-y-auto bg-ground px-4 pb-6">
      {/* Space for the macOS traffic lights; the strip drags the window. */}
      <div data-tauri-drag-region className="h-9 shrink-0" />

      <div className="flex items-baseline justify-between gap-2 px-2">
        <span className="font-serif text-xl leading-6 font-medium tracking-[-0.01em]">Aftercall</span>
        <span className="truncate font-mono text-[11px] text-muted" title={account ?? undefined}>
          {account ?? "not connected"}
        </span>
      </div>

      <button
        onClick={onNewRecording}
        className="flex h-9 items-center gap-2.5 rounded-sm bg-elevated px-3 text-left font-semibold shadow-[inset_0_0_0_1px_var(--hairline)] hover:shadow-[inset_0_0_0_1px_var(--border)]"
      >
        <span aria-hidden="true" className="size-2 rounded-full bg-record" />
        New recording
        <span className="ml-auto font-mono text-[11px] font-normal text-muted">⌘⇧R</span>
      </button>

      <div className="-mt-3 flex flex-col gap-0.5">
        {navRow("Home", homeSelected, onOpenHome, undefined, <House size={14} strokeWidth={1.75} aria-hidden="true" />)}
        {navRow("Search", searchSelected, onOpenSearch, <span className="font-mono text-[11px] text-muted">⌘K</span>, <Search size={14} strokeWidth={1.75} aria-hidden="true" />)}
      </div>

      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="t-label text-muted">Projects</span>
          <button onClick={onNewProject} aria-label="New project" className="text-muted hover:text-ink">
            <Plus size={14} strokeWidth={2} />
          </button>
        </div>
        {groups.map((g, gi) => {
          const meetings = g.recordings.map((r) => ({ id: r.id, title: meetingTitles[r.id] ?? recordingTitle(r), when: recordingWhen(r), toApprove: 0 }));
          const isOpen = open[g.id] ?? (meetings.some((m) => m.id === selectedMeetingId) || gi === 0);
          const Chevron = isOpen ? ChevronDown : ChevronRight;
          return (
            <div key={g.id} className="relative flex flex-col gap-0.5">
              <div className="group flex items-center rounded-sm hover:bg-elevated/60">
                <button
                  aria-expanded={isOpen}
                  onClick={() => setOpen((o) => ({ ...o, [g.id]: !isOpen }))}
                  className={cx("flex min-w-0 flex-1 items-center gap-2 px-2 py-[7px] text-left", isOpen ? "font-semibold text-ink" : "text-muted")}
                >
                  <Chevron size={12} strokeWidth={2} className="shrink-0 text-faint" aria-hidden="true" />
                  <span className="flex-1 truncate">{g.name}</span>
                  <span className="font-mono text-[11px] font-normal text-muted group-hover:hidden">{meetings.length}</span>
                </button>
                {g.id !== "other" && (
                  <button
                    data-project-menu
                    aria-label={`${g.name} options`}
                    onClick={() => setMenuFor(menuFor === g.id ? null : g.id)}
                    className="hidden px-2 text-muted hover:text-ink group-hover:block"
                  >
                    <MoreHorizontal size={14} />
                  </button>
                )}
              </div>
              {menuFor === g.id && (
                <div role="menu" data-project-menu className="absolute top-8 right-0 z-20 flex w-36 flex-col rounded-md bg-elevated p-1 shadow-float">
                  <button role="menuitem" onClick={() => { setMenuFor(null); onRenameProject(g.id); }} className="rounded-sm px-2.5 py-1.5 text-left hover:bg-hairline">
                    Rename
                  </button>
                  <button role="menuitem" onClick={() => { setMenuFor(null); onDeleteProject(g.id); }} className="rounded-sm px-2.5 py-1.5 text-left text-record hover:bg-hairline">
                    Delete
                  </button>
                </div>
              )}
              {isOpen && (
                <div className="ml-3.5 flex flex-col gap-0.5 border-l border-hairline pl-2.5">
                  {meetings.length ? meetings.map(meetingRow) : <span className="px-2 py-[7px] text-muted">No meetings yet</span>}
                </div>
              )}
            </div>
          );
        })}

        {sample && (
          <div className="mt-3 flex flex-col gap-0.5">
            <span className="t-label px-2 pb-1 text-muted">Sample</span>
            {meetingRow(sample)}
          </div>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-0.5">
        {navRow("Agent wallet", walletSelected, onOpenWallet, balance === null ? undefined : <span className="font-mono text-xs text-ink">{formatUsdc(balance)}</span>, <Wallet size={14} strokeWidth={1.75} aria-hidden="true" />)}
        {navRow("Connected agents", agentsSelected, onOpenAgents, undefined, <Bot size={14} strokeWidth={1.75} aria-hidden="true" />)}
        {navRow("Settings", settingsSelected, onOpenSettings, undefined, <Settings size={14} strokeWidth={1.75} aria-hidden="true" />)}
      </div>
    </nav>
  );
}
