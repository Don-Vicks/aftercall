import { useState } from "react";
import { ChevronDown, ChevronRight, House } from "lucide-react";
import { formatUsdc } from "@aftercall/core";
import { account, projects, walletBalance } from "./sample";
import type { SavedRecording } from "./recorder";
import { recordingTitle, recordingWhen } from "./RecordingScreen";
import { cx } from "./ui";

export function Sidebar({
  selectedMeetingId,
  pendingByMeeting,
  recordings,
  meetingTitles,
  homeSelected,
  onOpenHome,
  onSelectMeeting,
  onNewRecording,
  onOpenWallet,
  onOpenSettings,
}: {
  selectedMeetingId: string | null;
  /** Follow-ups waiting for approval, by meeting id. */
  pendingByMeeting: Record<string, number>;
  /** Real recordings, shown above the sample meetings of their project. */
  recordings: SavedRecording[];
  /** Titles of meetings that have notes, by id. */
  meetingTitles: Record<string, string>;
  homeSelected: boolean;
  onOpenHome: () => void;
  onSelectMeeting: (id: string) => void;
  onNewRecording: () => void;
  onOpenWallet: () => void;
  onOpenSettings: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({ fundraise: true });

  return (
    <nav aria-label="Projects" className="flex w-[248px] shrink-0 flex-col gap-7 bg-ground px-4 pb-6">
      {/* Space for the macOS traffic lights; the strip drags the window. */}
      <div data-tauri-drag-region className="h-9 shrink-0" />

      <div className="flex items-baseline justify-between px-2">
        <span className="font-serif text-xl leading-6 font-medium tracking-[-0.01em]">Aftercall</span>
        <span className="font-mono text-[11px] text-muted">{account}</span>
      </div>

      <button
        onClick={onNewRecording}
        className="flex h-9 items-center gap-2.5 rounded-sm bg-elevated px-3 text-left font-semibold shadow-[inset_0_0_0_1px_var(--hairline)] hover:shadow-[inset_0_0_0_1px_var(--border)]"
      >
        <span aria-hidden="true" className="size-2 rounded-full bg-record" />
        New recording
        <span className="ml-auto font-mono text-[11px] font-normal text-muted">⌘⇧R</span>
      </button>

      <button
        onClick={onOpenHome}
        aria-current={homeSelected ? "page" : undefined}
        className={cx("-mt-3 flex items-center gap-2.5 rounded-sm px-2 py-[7px] text-left", homeSelected ? "bg-elevated font-semibold text-ink" : "text-muted hover:text-ink")}
      >
        <House size={14} strokeWidth={1.75} aria-hidden="true" />
        Home
      </button>

      <div className="flex flex-col gap-0.5">
        <span className="t-label px-2 pb-2 text-muted">Projects</span>
        {projects.map((project) => {
          const ownRecordings = recordings.filter((r) => r.project === project.name);
          const meetings = [
            ...ownRecordings.map((r) => ({ id: r.id, title: meetingTitles[r.id] ?? recordingTitle(r), when: recordingWhen(r), toApprove: 0 })),
            ...project.meetings,
          ];
          // A project opens by itself when it holds the selected meeting.
          const isOpen = open[project.id] ?? meetings.some((m) => m.id === selectedMeetingId);
          const Chevron = isOpen ? ChevronDown : ChevronRight;
          return (
            <div key={project.id} className="flex flex-col gap-0.5">
              <button
                aria-expanded={isOpen}
                onClick={() => setOpen((o) => ({ ...o, [project.id]: !isOpen }))}
                className={cx(
                  "flex items-center gap-2 rounded-sm px-2 py-[7px] text-left hover:bg-elevated/60",
                  isOpen ? "font-semibold text-ink" : "text-muted",
                )}
              >
                <Chevron size={12} strokeWidth={2} className="text-faint" aria-hidden="true" />
                <span className="flex-1">{project.name}</span>
                <span className="font-mono text-[11px] font-normal text-muted">{project.meetingCount + ownRecordings.length}</span>
              </button>
              {isOpen && meetings.length > 0 && (
                <div className="ml-3.5 flex flex-col gap-0.5 border-l border-hairline pl-2.5">
                  {meetings.map((m) => {
                    const selected = m.id === selectedMeetingId;
                    const toApprove = pendingByMeeting[m.id] ?? m.toApprove ?? 0;
                    return (
                      <button
                        key={m.id}
                        onClick={() => onSelectMeeting(m.id)}
                        aria-current={selected ? "page" : undefined}
                        className={cx(
                          "flex items-center gap-2 rounded-sm px-2 py-[7px] text-left",
                          selected ? "bg-elevated text-ink" : "text-muted hover:text-ink",
                        )}
                      >
                        <span className={cx("flex-1", selected && "font-semibold")}>{m.title}</span>
                        {toApprove > 0 ? (
                          <span role="img" aria-label={`${toApprove} to approve`} className="size-[7px] rounded-full bg-caution" />
                        ) : (
                          <span className="font-mono text-[11px]">{m.when}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-auto flex flex-col gap-0.5">
        <button
          onClick={onOpenWallet}
          className="flex items-baseline justify-between rounded-sm px-2 py-[7px] text-muted hover:text-ink"
        >
          <span>Agent wallet</span>
          <span className="font-mono text-xs text-ink">{formatUsdc(walletBalance)}</span>
        </button>
        <button onClick={onOpenSettings} className="rounded-sm px-2 py-[7px] text-left text-muted hover:text-ink">
          Settings
        </button>
      </div>
    </nav>
  );
}
