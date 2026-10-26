import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, X } from "lucide-react";
import type { Meeting } from "@aftercall/core";
import { PREVIEW_INFO, agentActivity, agentsApi, claudeCommand, codexConfig, type AgentsInfo } from "./agents";
import { isDesktop } from "./recorder";
import { Pill, SectionLabel, cx } from "./ui";

const CAN = [
  "List meetings and search them, on this Mac",
  "Read a meeting's summary, decisions, action items and follow-up status (the transcript only when asked)",
  "Claim an open action item, with its name, so you see who is on it",
  "Mark an action item it claimed as done, with a short note",
];

const CANNOT = [
  "Send emails or recaps",
  "Make payments or touch the agent wallet",
  "Record proofs on NEAR",
  "Change notes, decisions or follow-ups, or delete anything",
  "Reach the internet: the server only reads and writes files in Aftercall's folder",
];

/**
 * Connects coding agents (Claude Code, Codex) to Aftercall through the local MCP
 * server in apps/mcp, so they can pick up action items from meetings.
 */
export function AgentsScreen({ meetings, onOpenMeeting }: { meetings: Meeting[]; onOpenMeeting: (id: string) => void }) {
  const [info, setInfo] = useState<AgentsInfo>(PREVIEW_INFO);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (isDesktop) agentsApi.info().then(setInfo).catch(() => {});
  }, []);

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1600);
  };

  const activity = agentActivity(meetings);
  const claude = claudeCommand(info);
  const codex = codexConfig(info);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
      <div className="mx-auto flex max-w-[680px] flex-col gap-8 px-12 pb-16">
        <header className="flex flex-col gap-3.5">
          <span className="t-label text-muted">Settings</span>
          <h1 className="t-display m-0">Connected agents</h1>
          <p className="t-reading m-0 text-muted">
            Let Claude Code or Codex pick up action items from your meetings. They talk to a small server on this Mac that reads Aftercall's files. Nothing is sent anywhere.
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <SectionLabel>Claude Code</SectionLabel>
          <p className="m-0 text-muted">Run this once in Terminal. It adds Aftercall to every project.</p>
          <Snippet text={claude} copied={copied === "claude"} onCopy={() => copy("claude", claude)} />
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel>Codex</SectionLabel>
          <p className="m-0 text-muted">
            Add this to <span className="t-mono text-ink">~/.codex/config.toml</span>, then restart Codex.
          </p>
          <Snippet text={codex} copied={copied === "codex"} onCopy={() => copy("codex", codex)} />
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel>The server</SectionLabel>
          <Path label="Server (Node 24)" value={info.serverPath} />
          <Path label="Meetings folder" value={info.dataDir} />
          {isDesktop && !info.serverFound && (
            <p className="m-0 text-caution">The server isn't at that path. It ships in the Aftercall repo under apps/mcp; run pnpm install there first.</p>
          )}
        </section>

        <section className="grid grid-cols-2 gap-6">
          <List title="Agents can" items={CAN} icon={<Check size={14} strokeWidth={2} className="mt-[3px] shrink-0 text-verdigris" aria-hidden="true" />} />
          <List title="Agents can't" items={CANNOT} icon={<X size={14} strokeWidth={2} className="mt-[3px] shrink-0 text-muted" aria-hidden="true" />} />
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel>Recent agent activity</SectionLabel>
          {activity.length === 0 ? (
            <p className="m-0 text-muted">No agent has claimed or completed an action item yet.</p>
          ) : (
            <div className="flex flex-col overflow-hidden rounded-md shadow-[inset_0_0_0_1px_var(--hairline)]">
              {activity.map((e, i) => (
                <button
                  key={`${e.meetingId}-${e.item}-${e.kind}-${e.at}`}
                  onClick={() => onOpenMeeting(e.meetingId)}
                  className={cx("flex items-start gap-3 px-4 py-3 text-left hover:bg-elevated", i < activity.length - 1 && "border-b border-hairline")}
                >
                  <Pill tone={e.kind === "completed" ? "verdigris" : "muted"}>{e.kind === "completed" ? "Done" : "Claimed"}</Pill>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate">{e.item}</span>
                    <span className="truncate text-[13px] text-muted">
                      {e.agent} · {e.meeting}
                      {e.note ? ` · ${e.note}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-muted">{when(e.at)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}

function Snippet({ text, copied, onCopy }: { text: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-md bg-well p-4 shadow-[inset_0_0_0_1px_var(--hairline)]">
      <code className="t-mono selectable flex-1 break-all whitespace-pre-wrap text-ink">{text}</code>
      <button onClick={onCopy} className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-verdigris hover:text-verdigris-hover">
        {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Path({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted">{label}</span>
      <span className="t-mono selectable break-all rounded-sm bg-well px-3 py-2">{value}</span>
    </div>
  );
}

function List({ title, items, icon }: { title: string; items: string[]; icon: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="t-title">{title}</span>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((t) => (
          <li key={t} className="flex gap-2 text-muted">
            {icon}
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
