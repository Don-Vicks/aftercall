import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Check, KeyRound, Link2, Mic, Wallet } from "lucide-react";
import { formatDuration, formatUsdc, type Meeting } from "@aftercall/core";
import type { SavedRecording } from "./recorder";
import { recordingStartedAt, recordingTitle } from "./RecordingScreen";
import { isDesktop } from "./recorder";
import { nearAiKey } from "./nearai";
import { near } from "./near";
import { Button, Pill, SectionLabel, cx } from "./ui";

interface NeedsYou {
  id: string;
  meetingId: string;
  kind: "approve" | "blocked" | "notes";
  title: string;
  detail: string;
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Everything across meetings that waits on a person, most urgent first. */
function needsYou(meetings: Meeting[], recordings: SavedRecording[], sampleId?: string): NeedsYou[] {
  const items: NeedsYou[] = [];
  for (const m of meetings) {
    const where = m.id === sampleId ? `${m.title} · sample` : m.title;
    for (const f of m.followUps) {
      if (f.status === "blocked" && f.kind === "payment") {
        items.push({ id: `${m.id}-${f.id}`, meetingId: m.id, kind: "blocked", title: `Pay ${f.payeeName} ${f.amount === null ? "" : `${formatUsdc(f.amount)} USDC`}`, detail: `Blocked by your agent wallet · ${where}` });
      } else if (f.status === "proposed") {
        const title = f.kind === "email" ? `Recap to ${f.toName || "someone"}` : `Pay ${f.payeeName}${f.amount === null ? "" : ` ${formatUsdc(f.amount)} USDC`}`;
        items.push({ id: `${m.id}-${f.id}`, meetingId: m.id, kind: "approve", title, detail: `To approve · ${where}` });
      }
    }
  }
  for (const r of recordings) {
    if (!r.notes) items.push({ id: r.id, meetingId: r.id, kind: "notes", title: recordingTitle(r), detail: `Waiting for notes · ${r.project}` });
  }
  const order = { blocked: 0, approve: 1, notes: 2 };
  return items.sort((a, b) => order[a.kind] - order[b.kind]);
}

export function HomeScreen({
  meetings,
  recordings,
  sampleId,
  onNewRecording,
  onOpenMeeting,
  onOpenSettings,
  onOpenWallet,
}: {
  meetings: Meeting[];
  recordings: SavedRecording[];
  /** The built-in sample meeting, labelled wherever it shows. */
  sampleId?: string;
  onNewRecording: () => void;
  onOpenMeeting: (id: string) => void;
  onOpenSettings: () => void;
  onOpenWallet: () => void;
}) {
  const [setup, setSetup] = useState<{ nearAi: boolean; near: boolean } | null>(null);

  useEffect(() => {
    if (!isDesktop) return setSetup({ nearAi: false, near: false });
    (async () => {
      const nearAi = await nearAiKey.has().catch(() => false);
      const connected = await near
        .getConfig()
        .then((c) => (c ? near.status().then((s) => s.registered && s.keyAdded) : false))
        .catch(() => false);
      setSetup({ nearAi, near: connected });
    })();
  }, []);

  const todo = needsYou(meetings, recordings, sampleId);
  const recent = [
    ...recordings.map((r) => ({
      id: r.id,
      title: meetings.find((m) => m.id === r.id)?.title ?? recordingTitle(r),
      meta: `${r.project} · ${recordingStartedAt(r)} · ${formatDuration(r.seconds)}`,
      state: r.notes ? "notes" : "waiting",
    })),
    ...meetings
      .filter((m) => !recordings.some((r) => r.id === m.id))
      .map((m) => ({ id: m.id, title: m.title, meta: `${m.project} · ${m.startedAt} · Sample`, state: "notes" })),
  ].slice(0, 6);

  const today = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
      <div className="mx-auto flex max-w-[760px] flex-col gap-10 px-12 pb-16">
        <header className="flex flex-col gap-2">
          <span className="t-label text-muted">{today}</span>
          <h1 className="t-display m-0">{greeting()}</h1>
        </header>

        <button
          onClick={onNewRecording}
          className="group flex items-center gap-5 rounded-lg bg-elevated p-6 text-left shadow-[inset_0_0_0_1px_var(--hairline)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--border)]"
        >
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-record-tint text-record">
            <Mic size={24} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <span className="flex flex-1 flex-col gap-1">
            <span className="font-serif text-[22px] leading-7 font-medium">Record a meeting</span>
            <span className="text-muted">Start your call in any app, then press record. Notes and follow-ups appear when you stop.</span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <span className="font-mono text-xs text-muted">⌘⇧R</span>
            <ArrowRight size={18} className="text-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </span>
        </button>

        {setup && (!setup.nearAi || !setup.near) && (
          <section className="flex flex-col gap-3">
            <SectionLabel>Finish setting up</SectionLabel>
            <div className="flex flex-col overflow-hidden rounded-md shadow-[inset_0_0_0_1px_var(--hairline)]">
              <SetupRow
                done={setup.nearAi}
                icon={<KeyRound size={16} strokeWidth={1.5} />}
                title="Connect NEAR AI"
                detail="So recordings become private notes, made in NEAR AI's secure hardware."
                action={{ label: "Connect", onClick: onOpenSettings }}
              />
              <SetupRow
                done={setup.near}
                icon={<Link2 size={16} strokeWidth={1.5} />}
                title="Connect your NEAR account"
                detail="So each meeting gets a public proof and follow-ups can pay from your agent wallet."
                action={{ label: "Connect", onClick: onOpenSettings }}
                last
              />
            </div>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <SectionLabel>Needs you</SectionLabel>
            {todo.length > 0 && <span className="text-muted">{todo.length} waiting</span>}
          </div>
          {todo.length === 0 ? (
            <p className="m-0 flex items-center gap-2 text-muted">
              <Check size={14} className="text-verdigris" aria-hidden="true" /> Nothing waiting. Follow-ups you need to approve show up here.
            </p>
          ) : (
            <div className="flex flex-col overflow-hidden rounded-md shadow-[inset_0_0_0_1px_var(--hairline)]">
              {todo.slice(0, 6).map((t, i) => (
                <button
                  key={t.id}
                  onClick={() => (t.kind === "blocked" ? onOpenWallet() : onOpenMeeting(t.meetingId))}
                  className={cx(
                    "flex items-center gap-4 px-5 py-3.5 text-left hover:bg-elevated",
                    i < Math.min(todo.length, 6) - 1 && "border-b border-hairline",
                    t.kind === "blocked" && "bg-caution-tint/60",
                  )}
                >
                  <span className={cx("shrink-0", t.kind === "blocked" ? "text-caution" : "text-muted")} aria-hidden="true">
                    {t.kind === "blocked" ? <AlertTriangle size={16} strokeWidth={1.5} /> : t.kind === "approve" ? <Wallet size={16} strokeWidth={1.5} /> : <Mic size={16} strokeWidth={1.5} />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="t-title truncate">{t.title}</span>
                    <span className="truncate text-muted">{t.detail}</span>
                  </span>
                  {t.kind === "blocked" ? <Pill tone="caution">Blocked</Pill> : t.kind === "approve" ? <Pill tone="muted">Approve</Pill> : <Pill tone="muted">Make notes</Pill>}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel>Recent meetings</SectionLabel>
          <div className="flex flex-col">
            {recent.map((m, i) => (
              <button
                key={m.id}
                onClick={() => onOpenMeeting(m.id)}
                className={cx("flex items-center gap-4 py-3 text-left hover:text-ink", i < recent.length - 1 && "border-b border-hairline")}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[15px] leading-5 font-semibold">{m.title}</span>
                  <span className="truncate text-muted">{m.meta}</span>
                </span>
                {m.state === "waiting" ? <Pill tone="muted">Waiting for notes</Pill> : <ArrowRight size={14} className="text-faint" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function SetupRow({
  done,
  icon,
  title,
  detail,
  action,
  last,
}: {
  done: boolean;
  icon: ReactNode;
  title: string;
  detail: string;
  action?: { label: string; onClick: () => void };
  last?: boolean;
}) {
  return (
    <div className={cx("flex items-center gap-4 px-5 py-4", !last && "border-b border-hairline")}>
      <span className={cx("shrink-0", done ? "text-verdigris" : "text-muted")} aria-hidden="true">
        {done ? <Check size={16} strokeWidth={2} /> : icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cx("t-title", done && "text-muted line-through")}>{title}</span>
        {!done && <span className="text-muted">{detail}</span>}
      </span>
      {!done && action && <Button onClick={action.onClick}>{action.label}</Button>}
    </div>
  );
}
