import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { Check, X } from "lucide-react";
import { initials, type Meeting } from "@aftercall/core";
import { PREVIEW_INFO, agentsApi, claudeCommand, codexConfig, describeActivity, type AgentActivity, type AgentsInfo } from "./agents";
import { isDesktop } from "./recorder";
import { syncWithAda } from "./sample";
import { Button, Card, Pill, SectionTitle, Toggle, enter, exit, springs } from "./ui";
import { Snippet, Why, errorText, grow, rise } from "./SettingsParts";

const CAN = ["Search and read your meetings", "Claim an action item, if you allow it", "Mark it done with a note, if you allow it"];
const CANNOT = [
  "Send email or recaps",
  "Pay, or touch the agent wallet",
  "Record proofs on NEAR",
  "Change or delete notes",
  "Reach meetings while this is off",
];

/** The browser preview has no app to ask: a clearly fake token, so the commands read whole. */
const PREVIEW_TOKEN = "preview-only-not-a-real-token";

/** How often the open screen asks the app for new activity. */
const ACTIVITY_POLL_MS = 5000;

/** Sample requests in the browser preview, on the sample meeting: refused while read-only, then allowed. */
function previewActivity(): AgentActivity[] {
  const at = (h: number, min: number) => {
    const d = new Date();
    d.setHours(h, min, 0, 0);
    return d.toISOString();
  };
  const meetingId = syncWithAda.id;
  return [
    { at: at(14, 20), agent: "Claude Code", op: "claim", meetingId, itemId: "a2", allowed: true },
    { at: at(14, 19), agent: "claude-code", op: "notes", meetingId, allowed: true },
    { at: at(14, 12), agent: "Claude Code", op: "claim", meetingId, itemId: "a2", allowed: false, refused: "read-only" },
    { at: at(14, 11), agent: "claude-code", op: "meetings", allowed: true },
  ];
}

/**
 * Connects coding agents (Claude Code, Codex) to Aftercall through the local MCP
 * server in apps/mcp, so they can pick up action items from meetings. Meetings are
 * encrypted on disk, so the server asks the app over a local socket that is open
 * only while the switch here is on, and only with the token shown here. Agents only
 * read unless the second switch lets them claim and complete action items.
 */
export function AgentsScreen({ meetings, onOpenMeeting }: { meetings: Meeting[]; onOpenMeeting: (id: string) => void }) {
  const [info, setInfo] = useState<AgentsInfo>(PREVIEW_INFO);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<AgentActivity[]>(() => (isDesktop ? [] : previewActivity()));
  const still = useReducedMotion();

  useEffect(() => {
    if (!isDesktop) return;
    agentsApi
      .info()
      .then(setInfo)
      .catch(() => {});
    // Agents act while you watch: refresh the list while this screen is open.
    const load = () =>
      agentsApi
        .activity()
        .then(setLog)
        .catch(() => {});
    load();
    const timer = window.setInterval(load, ACTIVITY_POLL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const change = async (fn: () => Promise<AgentsInfo>) => {
    setBusy(true);
    setError(null);
    try {
      setInfo(await fn());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (enabled: boolean) =>
    isDesktop
      ? change(() => agentsApi.setEnabled(enabled))
      : setInfo({ ...info, enabled, allowWrites: false, token: enabled ? PREVIEW_TOKEN : null });
  const toggleWrites = (allow: boolean) =>
    isDesktop ? change(() => agentsApi.setAllowWrites(allow)) : setInfo({ ...info, allowWrites: allow, readOnlySinceUpdate: false });

  const sample = !isDesktop;
  const known = sample ? [syncWithAda, ...meetings] : meetings;
  const claude = claudeCommand(info);
  const codex = codexConfig(info);
  const height = (on: boolean) => (still ? { opacity: on ? 1 : 0 } : { opacity: on ? 1 : 0, height: on ? "auto" : 0 });

  return (
    <main className="min-w-0 flex-1 overflow-y-auto border-l border-hairline bg-raised">
      <div data-tauri-drag-region className="sticky top-0 z-10 h-9 bg-raised" />
      <div className="px-12 pt-3 pb-12">
        <div className="mx-auto flex max-w-[680px] flex-col gap-8">
          <header className="flex flex-col gap-1.5" style={rise(0)}>
            <span className="t-eyebrow text-muted">On this Mac only</span>
            <h1 className="t-display m-0">Connected agents</h1>
            <p className="m-0 text-ink-2">Let Claude Code or Codex pick up action items from your meetings.</p>
            <Why className="mt-0.5">
              Agents reach a small server on this Mac, which asks Aftercall over a local channel only while this is on. What an agent reads then goes wherever
              that agent runs.
            </Why>
          </header>

          <Card as="section" aria-label="Agent access" pad="none" className="overflow-hidden" style={rise(1)}>
            <div className="flex items-center gap-4 px-5 py-4">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="t-title">Let agents reach my meetings</span>
                <span className="text-[13px] leading-[19px] text-ink-2">
                  {info.enabled ? "On while Aftercall is open. Agents need the token below." : "Off. No agent can reach your meetings."}
                </span>
              </span>
              <Toggle aria-label="Let agents reach my meetings" checked={info.enabled} disabled={busy} onChange={toggle} />
            </div>
            <AnimatePresence initial={false}>
              {info.enabled && (
                <m.div
                  key="token"
                  initial={height(false)}
                  animate={{ ...height(true), transition: still ? enter : grow }}
                  exit={{ ...height(false), transition: exit }}
                >
                  <div className="flex items-center gap-4 border-t border-hairline px-5 py-4">
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-semibold text-ink">
                        Let agents claim and complete action items
                      </span>
                      <span className="text-[13px] leading-[19px] text-ink-2">
                        {info.allowWrites
                          ? "On. Agents can mark an item as theirs and as done. They still can't send, pay or change your rules."
                          : "Off. Agents can only read. On, they can mark an item as theirs and as done; they still can't send, pay or change your rules."}
                      </span>
                      {info.readOnlySinceUpdate && (
                        <span className="mt-1 text-[13px] leading-[19px] text-ink">
                          Agents are read-only since this update. Before it, they could claim and complete items without asking; turn this on if you want
                          that back.
                        </span>
                      )}
                    </span>
                    <Toggle aria-label="Let agents claim and complete action items" checked={info.allowWrites} disabled={busy} onChange={toggleWrites} />
                  </div>
                  <div className="flex items-center gap-3 border-t border-hairline px-5 py-3">
                    <span className="text-[13px] font-semibold text-ink-2">Token</span>
                    <span className="flex min-w-0 flex-1">
                      <AnimatePresence mode="wait" initial={false}>
                        <m.span
                          key={info.token ?? "none"}
                          className="t-mono selectable min-w-0 truncate text-ink"
                          initial={{ opacity: 0, scale: 0.94 }}
                          animate={{ opacity: 1, scale: 1, transition: springs.bouncy }}
                          exit={{ opacity: 0, transition: exit }}
                        >
                          {info.token ?? "…"}
                        </m.span>
                      </AnimatePresence>
                    </span>
                    <Button variant="quiet" size="sm" disabled={busy || !isDesktop} onClick={() => change(agentsApi.newToken)}>
                      New token
                    </Button>
                  </div>
                </m.div>
              )}
            </AnimatePresence>
            {error && (
              <p className="m-0 border-t border-hairline px-5 py-3 text-[13px] leading-[19px] text-caution">Couldn't change Connected agents: {error}</p>
            )}
          </Card>

          <AnimatePresence mode="wait" initial={false}>
            {info.enabled ? (
              <m.div
                key="on"
                className="flex flex-col gap-6"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: { ...enter, delay: 0.04 } }}
                exit={{ opacity: 0, transition: exit }}
              >
                <section aria-labelledby="h-claude" className="flex flex-col gap-2.5">
                  <div className="flex flex-col gap-1">
                    <SectionTitle id="h-claude" count="in Terminal">
                      Claude Code
                    </SectionTitle>
                    <p className="m-0 text-ink-2">Run this once. Run it again after a new token, or if you move Aftercall. It needs Node 20 or later.</p>
                  </div>
                  <Snippet text={claude} label="Copy the Claude Code command" />
                </section>
                <section aria-labelledby="h-codex" className="flex flex-col gap-2.5">
                  <div className="flex flex-col gap-1">
                    <SectionTitle id="h-codex" count="config file">
                      Codex
                    </SectionTitle>
                    <p className="m-0 text-ink-2">
                      Add this to <span className="t-mono text-ink">~/.codex/config.toml</span>, replacing an older Aftercall block, then restart Codex. It needs
                      Node 20 or later.
                    </p>
                  </div>
                  <Snippet text={codex} label="Copy the Codex config" />
                </section>
              </m.div>
            ) : (
              <m.p
                key="off"
                className="m-0 text-ink-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: enter }}
                exit={{ opacity: 0, transition: exit }}
              >
                Turn this on to get setup commands for Claude Code and Codex, with a fresh token.
              </m.p>
            )}
          </AnimatePresence>

          {isDesktop && !info.serverFound && (
            <p className="-mt-4 text-[13px] leading-[19px] text-caution">
              The server isn't at <span className="t-mono">{info.serverPath}</span>. It ships inside Aftercall; reinstall the app, or in a checkout run{" "}
              <span className="t-mono">pnpm --filter @aftercall/mcp build</span>.
            </p>
          )}

          <section aria-label="What agents can and can't do" className="grid grid-cols-2 gap-6" style={rise(2)}>
            <List title="Agents can" items={CAN} icon={<Check size={15} strokeWidth={2.5} aria-hidden="true" className="mt-[3px] shrink-0 text-verdigris" />} />
            <List title="Agents can't" items={CANNOT} icon={<X size={15} strokeWidth={2} aria-hidden="true" className="mt-[3px] shrink-0 text-muted" />} />
          </section>

          <section aria-labelledby="h-activity" className="flex flex-col gap-1.5" style={rise(3)}>
            <div className="mb-2 flex flex-col gap-1">
              <SectionTitle id="h-activity" count={log.length || undefined}>
                Recent agent activity
              </SectionTitle>
              <p className="m-0 text-[13px] leading-[19px] text-ink-2">
                Each read, claim and completion, and every refused request, newest first, under the name the agent gives itself. The list holds times,
                names and ids, never meeting content.
              </p>
            </div>
            {log.length === 0 ? (
              <p className="m-0 text-ink-2">No agent has asked Aftercall for anything yet.</p>
            ) : (
              <>
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                  {log.map((a, i) => (
                    <ActivityRow key={`${a.at}-${i}`} entry={a} meetings={known} onOpenMeeting={onOpenMeeting} />
                  ))}
                </ul>
                {sample && <p className="m-0 text-[13px] text-muted">Sample activity in the browser preview.</p>}
              </>
            )}
          </section>

          <Why label="Where the server and your meetings live" className="-mt-2">
            <span className="flex flex-col gap-3">
              <Path label="Server (Node 20 or later)" value={info.serverPath} />
              <Path label="Meetings folder (encrypted)" value={info.dataDir} />
              <Path label="Local channel, open only while agents are on" value={info.socketPath} />
              <span>
                Audio, transcripts and notes are encrypted on disk with a key kept in your macOS Keychain. Other apps, and backup or sync tools that copy
                Aftercall's folder, see only scrambled bytes. It doesn't protect against someone using your Mac while you're signed in, or malware running as
                you that can open your Keychain. While agents are on, the token sits in your agent's config file, so software that can read that file can reach
                your meetings too.
              </span>
            </span>
          </Why>
        </div>
      </div>
    </main>
  );
}

/** One request: what it was, by whom, on which meeting, and whether Aftercall allowed it. Opens the meeting when there is one. */
function ActivityRow({ entry, meetings, onOpenMeeting }: { entry: AgentActivity; meetings: Meeting[]; onOpenMeeting: (id: string) => void }) {
  const v = describeActivity(entry, meetings);
  const body = (
    <>
      <AgentAvatar name={entry.agent} />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate font-semibold text-ink">{v.what}</span>
        <span className="truncate text-[13px] text-ink-2">{[entry.agent, v.meeting?.title, v.detail].filter(Boolean).join(" · ")}</span>
      </span>
      {v.status === "done" ? (
        <Pill tone="verdigris" icon={<Check size={12} strokeWidth={2.5} aria-hidden="true" />}>
          Done
        </Pill>
      ) : v.status === "claimed" ? (
        <Pill tone="muted">Claimed</Pill>
      ) : v.status === "refused" ? (
        <Pill tone="caution">Refused</Pill>
      ) : (
        <Pill tone="muted">Read</Pill>
      )}
      <span className="w-11 shrink-0 text-right font-mono text-[12px] text-muted">{when(entry.at)}</span>
    </>
  );
  const row = "-mx-3 flex w-[calc(100%+24px)] items-center gap-3.5 rounded-[10px] p-3 text-left";
  const meeting = v.meeting;
  return (
    <li>
      {meeting ? (
        <button type="button" onClick={() => onOpenMeeting(meeting.id)} className={`press ${row} hover:bg-elevated`}>
          {body}
        </button>
      ) : (
        <div className={row}>{body}</div>
      )}
    </li>
  );
}

/** Agents aren't people: a neutral disc with mono initials, not a person's colour. */
function AgentAvatar({ name }: { name: string }) {
  const short = /codex/i.test(name) ? "CX" : /claude/i.test(name) ? "CC" : initials(name);
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-well font-mono text-[11px] font-medium text-ink-2 shadow-[inset_0_0_0_1px_var(--hairline)]"
    >
      {short}
    </span>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === new Date().toDateString() ? time : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function Path({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col gap-1">
      <span className="font-semibold text-ink-2">{label}</span>
      <span className="t-mono selectable rounded-sm bg-well px-3 py-2 break-all text-ink">{value}</span>
    </span>
  );
}

function List({ title, items, icon }: { title: string; items: string[]; icon: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h2 className="t-section m-0">{title}</h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((t) => (
          <li key={t} className="flex gap-2.5 text-ink-2">
            {icon}
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
