import { ShieldCheck } from "lucide-react";
import type { Meeting } from "@aftercall/core";
import type { SavedRecording } from "./recorder";
import { recordingTitle } from "./RecordingScreen";
import { AvatarStack, cx, type Surface } from "./ui";

/** Everyone in a meeting, you first: the invite's people when the recording matched a calendar event. */
export function meetingPeople(m?: Pick<Meeting, "invited">): string[] {
  const names = (m?.invited ?? []).map((a) => a.name || a.email).filter(Boolean);
  return ["You", ...new Set(names)];
}

/** "3 min" for 192 seconds; "45 s" under a minute. */
export function shortDuration(sec: number): string {
  return sec >= 60 ? `${Math.round(sec / 60)} min` : `${Math.max(0, Math.round(sec))} s`;
}

/** "Today 14:02" for today, otherwise "28 Oct". */
export function shortWhen(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  if (d.toDateString() === new Date().toDateString()) return `Today ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

export interface MeetingRowData {
  id: string;
  title: string;
  meta: string;
  people: string[];
  status: { text: string; tone: "caution" | "ink" | "muted" };
  verified: boolean;
}

/**
 * A recording (and its meeting, once it has notes) as one row. `withProject` puts
 * the project first in the meta line (Home); a project's own page leaves it out.
 */
export function meetingRow(r: SavedRecording | undefined, m: Meeting | undefined, { withProject = true, long = true, sample = false } = {}): MeetingRowData {
  const title = m?.title ?? (r ? recordingTitle(r) : "Meeting");
  const project = m?.project ?? r?.project ?? "";
  const when = r ? shortWhen(r.startedAt) : (m?.startedAt ?? "");
  const seconds = r?.seconds ?? m?.durationSec ?? 0;
  const meta = [withProject ? project : "", when, shortDuration(seconds), sample || r?.label ? "Sample" : ""].filter(Boolean).join(" · ");
  let status: MeetingRowData["status"];
  if (!m) status = { text: "Waiting for notes", tone: "muted" };
  else {
    const toApprove = m.followUps.filter((f) => f.status === "proposed").length;
    const open = m.actionItems.filter((a) => !a.done).length;
    if (toApprove) status = { text: `${toApprove} to approve`, tone: "caution" };
    else if (open) status = { text: long ? `${open} action ${open === 1 ? "item" : "items"} open` : `${open} open`, tone: "ink" };
    else status = { text: "All done", tone: "muted" };
  }
  return { id: r?.id ?? m?.id ?? title, title, meta, people: meetingPeople(m), status, verified: Boolean(m?.verified) };
}

/** A meeting in a list: who was there, what it was, what's left, and whether it's verified. */
export function MeetingRow({ row, onOpen, ring = "raised" }: { row: MeetingRowData; onOpen: (id: string) => void; ring?: Surface }) {
  return (
    <button onClick={() => onOpen(row.id)} className="-mx-3 flex items-center gap-4 rounded-[10px] p-3 text-left text-ink hover:bg-elevated">
      <span aria-hidden="true" className="flex w-16 shrink-0">
        <AvatarStack people={row.people} max={3} size={32} ring={ring} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate font-semibold">{row.title}</span>
        <span className="truncate text-[13px] text-muted">{row.meta}</span>
      </span>
      <span className={cx("shrink-0 text-[13px]", row.status.tone === "caution" ? "font-medium text-caution" : row.status.tone === "ink" ? "text-ink-2" : "text-muted")}>
        {row.status.text}
      </span>
      {row.verified ? (
        <ShieldCheck size={16} strokeWidth={2} role="img" aria-label="Verified" className="shrink-0 text-verdigris" />
      ) : (
        <span aria-hidden="true" className="w-4 shrink-0" />
      )}
    </button>
  );
}
