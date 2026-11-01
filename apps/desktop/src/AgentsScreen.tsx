import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { Check, X } from "lucide-react";
import { initials, type Meeting } from "@aftercall/core";
import { PREVIEW_INFO, agentActivity, agentsApi, claudeCommand, codexConfig, type AgentEvent, type AgentsInfo } from "./agents";
import { isDesktop } from "./recorder";
import { syncWithAda } from "./sample";
import { Button, Card, Pill, SectionTitle, Toggle, enter, exit, springs } from "./ui";
import { Snippet, Why, errorText, grow, rise } from "./SettingsParts";

const CAN = ["Search and read your meetings", "Claim an action item, by name", "Mark an item they claimed as done, with a note"];
const CANNOT = [
  "Send email or recaps",
  "Pay, or touch the agent wallet",
  "Record proofs on NEAR",
  "Change or delete notes",
  "Reach meetings while this is off",
];

/** The browser preview has no app to ask: a clearly fake token, so the commands read whole. */
const PREVIEW_TOKEN = "preview-only-not-a-real-token";

/** One sample event in the browser preview, on the sample meeting, so the list can be looked at. */
function previewActivity(): AgentEvent[] {
  const at = new Date();
  at.setHours(14, 20, 0, 0);
  return [{ kind: "claimed", agent: "Claude Code", at: at.toISOString(), meetingId: syncWithAda.id, meeting: syncWithAda.title, item: "Ship the API fix" }];
}

/**
 * Connects coding agents (Claude Code, Codex) to Aftercall through the local MCP
 * server in apps/mcp, so they can pick up action items from meetings. Meetings are
 * encrypted on disk, so the server asks the app over a local socket that is open
 * only while the switch here is on, and only with the token shown here.
 */
export function AgentsScreen({ meetings, onOpenMeeting }: { meetings: Meeting[]; onOpenMeeting: (id: string) => void }) {
  const [info, setInfo] = useState<AgentsInfo>(PREVIEW_INFO);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const still = useReducedMotion();

  useEffect(() => {
    if (isDesktop)
      agentsApi
        .info()
        .then(setInfo)
        .catch(() => {});
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
    isDesktop ? change(() => agentsApi.setEnabled(enabled)) : setInfo({ ...info, enabled, token: enabled ? PREVIEW_TOKEN : null });

  const real = agentActivity(meetings);
  const sample = !isDesktop && real.length === 0;
  const activity = sample ? previewActivity() : real;
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
                    <p className="m-0 text-ink-2">Run this once. Run it again after a new token.</p>
                  </div>
                  <Snippet text={claude} label="Copy the Claude Code command" />
                </section>
                <section aria-labelledby="h-codex" className="flex flex-col gap-2.5">
                  <div className="flex flex-col gap-1">
                    <SectionTitle id="h-codex" count="config file">
                      Codex
                    </SectionTitle>
                    <p className="m-0 text-ink-2">
                      Add this to <span className="t-mono text-ink">~/.codex/config.toml</span>, replacing an older Aftercall block, then restart Codex.
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
              The server isn't at <span className="t-mono">{info.serverPath}</span>. It ships in the Aftercall repo under apps/mcp; run pnpm install there
              first.
            </p>
          )}

          <section aria-label="What agents can and can't do" className="grid grid-cols-2 gap-6" style={rise(2)}>
            <List title="Agents can" items={CAN} icon={<Check size={15} strokeWidth={2.5} aria-hidden="true" className="mt-[3px] shrink-0 text-verdigris" />} />
            <List title="Agents can't" items={CANNOT} icon={<X size={15} strokeWidth={2} aria-hidden="true" className="mt-[3px] shrink-0 text-muted" />} />
          </section>

          <section aria-labelledby="h-activity" className="flex flex-col gap-1.5" style={rise(3)}>
            <SectionTitle id="h-activity" count={activity.length || undefined} className="mb-2">
              Recent activity
            </SectionTitle>
            {activity.length === 0 ? (
              <p className="m-0 text-ink-2">No agent has claimed or completed an action item yet.</p>
            ) : (
              <>
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                  {activity.map((e) => (
                    <li key={`${e.meetingId}-${e.item}-${e.kind}-${e.at}`}>
                      <button
                        type="button"
                        onClick={() => onOpenMeeting(e.meetingId)}
                        className="press -mx-3 flex w-[calc(100%+24px)] items-center gap-3.5 rounded-[10px] p-3 text-left hover:bg-elevated"
                      >
                        <AgentAvatar name={e.agent} />
                        <span className="flex min-w-0 flex-1 flex-col gap-px">
                          <span className="truncate font-semibold text-ink">{e.item}</span>
                          <span className="truncate text-[13px] text-ink-2">
                            {e.agent} · {e.meeting}
                            {e.note ? ` · “${e.note}”` : ""}
                          </span>
                        </span>
                        {e.kind === "completed" ? (
                          <Pill tone="verdigris" icon={<Check size={12} strokeWidth={2.5} aria-hidden="true" />}>
                            Done
                          </Pill>
                        ) : (
                          <Pill tone="muted">Claimed</Pill>
                        )}
                        <span className="w-11 shrink-0 text-right font-mono text-[12px] text-muted">{when(e.at)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {sample && <p className="m-0 text-[13px] text-muted">Sample activity in the browser preview.</p>}
              </>
            )}
          </section>

          <Why label="Where the server and your meetings live" className="-mt-2">
            <span className="flex flex-col gap-3">
              <Path label="Server (Node 24)" value={info.serverPath} />
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
