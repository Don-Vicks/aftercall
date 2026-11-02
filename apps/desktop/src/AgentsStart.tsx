import type { ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { Check } from "lucide-react";
import { CheckCircle, useChanged } from "./primitives/Check";
import { CLAUDE_REMOVE_COMMAND, TRY_PROMPT, agentLabel, ago, claudeCommand, type AgentActivity, type AgentsInfo, type ClaudeOutcome } from "./agents";
import { Button, Card, Spinner, Toggle, cx, enter, exit } from "./ui";
import { Snippet, Why } from "./SettingsParts";

/** What the screen passes both cards: the state, and what the buttons do. */
export interface StartProps {
  info: AgentsInfo;
  busy: boolean;
  /** Connect or Disconnect Claude Code is running. */
  claudeBusy: "connect" | "disconnect" | null;
  /** The last Connect or Disconnect, until the state changes again. */
  outcome: (ClaudeOutcome & { connect: boolean }) | null;
  onToggle: (on: boolean) => void;
  onClaude: (connect: boolean) => void;
}

/**
 * Before any agent has reached Aftercall: three steps, each ticking when it's done.
 * 1 turns agents on, 2 runs `claude mcp add` for you, 3 is something to ask.
 */
export function StartSteps({ info, busy, claudeBusy, outcome, onToggle, onClaude, heard }: StartProps & { heard?: AgentActivity }) {
  const on = info.enabled;
  const linked = info.claudeCode === "connected" || Boolean(heard);
  const steps = [on, linked, Boolean(heard)];
  const doneCount = steps.filter(Boolean).length;
  const current = steps.indexOf(false);
  const state = (i: number): StepState => (steps[i] ? "done" : i === current ? "current" : "todo");

  return (
    <Card as="section" aria-labelledby="h-start" pad="none" className="overflow-hidden">
      <div className="flex items-baseline justify-between gap-4 border-b border-hairline px-5 pt-4 pb-3.5">
        <h2 id="h-start" className="t-section m-0">
          Connect Claude Code in three steps
        </h2>
        <span className="font-mono text-[12px] text-muted">{doneCount} of 3 done</span>
      </div>
      <ol className="m-0 list-none p-0 pt-1 pb-2">
        <Step
          n={1}
          state={state(0)}
          title="Let agents read your meetings"
          detail={on ? "On while Aftercall is open. Agents can read your processed meetings." : "Off. No agent can reach your meetings."}
          action={<Toggle aria-label="Let agents read your meetings" checked={on} disabled={busy} onChange={onToggle} />}
        />
        <Step
          n={2}
          state={state(1)}
          title="Connect Claude Code"
          detail={
            !on
              ? "Adds Aftercall to Claude Code for every project, with your token. Turn on step 1 first."
              : info.claudeCode === "connected"
                ? "Added to Claude Code for every project. You can undo it here."
                : info.claudeCode === "stale"
                  ? "Claude Code has an older token. Reconnect to give it the current one."
                  : "Adds Aftercall to Claude Code for every project, with your token. You can undo it here."
          }
          action={<ClaudeButton info={info} claudeBusy={claudeBusy} onClaude={onClaude} />}
        >
          <Outcome info={info} outcome={outcome} />
          {on && !outcome?.missing && (
            <Why label="Or run the command yourself">
              <span className="flex flex-col gap-2">
                <span>In Terminal. It needs Node 20 or later.</span>
                <Snippet text={claudeCommand(info)} label="Copy the Claude Code command" />
              </span>
            </Why>
          )}
        </Step>
        <Step
          n={3}
          state={state(2)}
          last
          title="Try it"
          detail={heard ? `${agentLabel(heard.agent)} reached Aftercall.` : "Start a new Claude Code session, in any folder, and ask:"}
        >
          <Snippet text={TRY_PROMPT} label="Copy the prompt" />
          <AnimatePresence initial={false}>
            {on && linked && !heard && (
              <m.span
                key="waiting"
                className="flex items-center gap-2 text-[13px] leading-[19px] text-ink-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: enter }}
                exit={{ opacity: 0, transition: exit }}
              >
                <Spinner size={12} />
                Waiting for the first request. It shows here, and under Recent agent activity.
              </m.span>
            )}
          </AnimatePresence>
        </Step>
      </ol>
    </Card>
  );
}

/** Once an agent has reached Aftercall with the current token: who, and when, with the switch and Claude Code's entry. */
export function ConnectedCard({ info, busy, claudeBusy, outcome, onToggle, onClaude, heard, now }: StartProps & { heard: AgentActivity; now: number }) {
  return (
    <Card as="section" aria-label="Connection" pad="none" className="overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-4">
        <span aria-hidden="true" className="relative inline-flex size-[26px] shrink-0 items-center justify-center rounded-full bg-verdigris-tint">
          <span className="size-2 rounded-full bg-verdigris" style={{ animation: "ac-breathe 2.4s ease-in-out infinite" }} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="t-title">Connected</span>
          <span className="text-[13px] leading-[19px] text-ink-2" aria-live="polite">
            Last request {ago(heard.at, now)} from {agentLabel(heard.agent)}
          </span>
        </span>
        <Toggle aria-label="Let agents read your meetings" checked={info.enabled} disabled={busy} onChange={onToggle} />
      </div>
      <div className="flex flex-col gap-3 border-t border-hairline px-5 py-4">
        <div className="flex items-center gap-4">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-semibold text-ink">Claude Code</span>
            <span className="text-[13px] leading-[19px] text-ink-2">
              {info.claudeCode === "connected"
                ? "Added for every project by Aftercall. A new session picks up any change."
                : info.claudeCode === "stale"
                  ? "Claude Code has an older token. Reconnect to give it the current one."
                  : "Not added by Aftercall. If you set it up yourself, it keeps working."}
            </span>
          </span>
          <ClaudeButton info={info} claudeBusy={claudeBusy} onClaude={onClaude} />
        </div>
        <Outcome info={info} outcome={outcome} />
      </div>
    </Card>
  );
}

function ClaudeButton({ info, claudeBusy, onClaude }: Pick<StartProps, "info" | "claudeBusy" | "onClaude">) {
  if (info.claudeCode === "connected" && info.enabled) {
    return (
      <Button variant="ghost" size="sm" loading={claudeBusy === "disconnect"} disabled={claudeBusy === "connect"} onClick={() => onClaude(false)}>
        Disconnect Claude Code
      </Button>
    );
  }
  return (
    <Button variant="primary" size="sm" loading={claudeBusy === "connect"} disabled={!info.enabled || claudeBusy === "disconnect"} onClick={() => onClaude(true)}>
      {info.claudeCode === "stale" ? "Reconnect Claude Code" : "Connect Claude Code"}
    </Button>
  );
}

/** The plain result of the last Connect or Disconnect: done, the error, or the copy command when claude or node can't be found. */
function Outcome({ info, outcome }: Pick<StartProps, "info" | "outcome">) {
  return (
    <AnimatePresence initial={false} mode="wait">
      {outcome && (
        <m.div
          key={outcome.message}
          className="flex flex-col gap-2"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0, transition: enter }}
          exit={{ opacity: 0, transition: exit }}
          role="status"
        >
          <span className={cx("flex gap-2 text-[13px] leading-[19px]", outcome.ok ? "text-ink" : "text-caution")}>
            {outcome.ok && <Check size={14} strokeWidth={2.5} aria-hidden="true" className="mt-[2.5px] shrink-0 text-verdigris" />}
            <span>{outcome.message}</span>
          </span>
          {outcome.missing && (
            <Snippet
              text={outcome.connect ? claudeCommand(info) : CLAUDE_REMOVE_COMMAND}
              label={outcome.connect ? "Copy the Claude Code command" : "Copy the remove command"}
            />
          )}
        </m.div>
      )}
    </AnimatePresence>
  );
}

type StepState = "done" | "current" | "todo";

/** One numbered step: a mark on a line that joins the steps, the words, its control on the right, and anything under it. */
function Step({
  n,
  state,
  title,
  detail,
  action,
  last,
  children,
}: {
  n: number;
  state: StepState;
  title: string;
  detail: ReactNode;
  action?: ReactNode;
  last?: boolean;
  children?: ReactNode;
}) {
  const line = (on: boolean) => cx("w-px", on ? "bg-verdigris/45" : "bg-hairline");
  return (
    <li className="flex gap-4 px-5">
      <span className="flex w-[26px] shrink-0 flex-col items-center">
        <span aria-hidden="true" className={cx("h-3.5", n > 1 && line(state !== "todo"))} />
        <StepMark n={n} state={state} />
        {!last && <span aria-hidden="true" className={cx("flex-1", line(state === "done"))} />}
      </span>
      <div className={cx("flex min-w-0 flex-1 flex-col gap-3 pt-3.5", last ? "pb-3" : "pb-5")}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
            <span className={cx("t-title", state === "todo" ? "text-ink-2" : "text-ink")}>
              <span className="sr-only">{state === "done" ? `Step ${n}, done: ` : `Step ${n}: `}</span>
              {title}
            </span>
            <span className="text-[13px] leading-[19px] text-ink-2">{detail}</span>
          </span>
          {action}
        </div>
        {children}
      </div>
    </li>
  );
}

/** The step's number in a ring; verdigris for the step to do now; a filled tick, drawn when it changes here, once it's done. */
function StepMark({ n, state }: { n: number; state: StepState }) {
  const play = useChanged(state === "done");
  if (state === "done") {
    return (
      <span aria-hidden="true" className="inline-flex size-[26px] shrink-0">
        <CheckCircle size={26} play={play} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex size-[26px] shrink-0 items-center justify-center rounded-full font-mono text-[12px] font-medium",
        state === "current" ? "bg-verdigris-tint text-verdigris shadow-[inset_0_0_0_1.5px_var(--verdigris)]" : "text-muted shadow-[inset_0_0_0_1.5px_var(--border)]",
      )}
    >
      {n}
    </span>
  );
}
