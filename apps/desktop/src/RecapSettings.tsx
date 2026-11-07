import { useState } from "react";
import { Card, Field, Input, SectionTitle, Toggle } from "./ui";

const KEY = "aftercall.senderName";
const AGENT_WORK_KEY = "aftercall.recapAgentWork";

/**
 * Whether recaps list the action items coding agents marked done, with each agent's link,
 * as the agents' own statement. On this Mac only; off until you turn it on.
 */
export function recapAgentWork(): boolean {
  try {
    return localStorage.getItem(AGENT_WORK_KEY) === "on";
  } catch {
    return false;
  }
}

function saveRecapAgentWork(on: boolean): void {
  try {
    localStorage.setItem(AGENT_WORK_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked: recaps leave agents' work out, as by default.
  }
}

/** The name recaps go out under. On this Mac only; empty until you set it. */
export function senderName(): string {
  try {
    return (localStorage.getItem(KEY) ?? "").trim();
  } catch {
    return "";
  }
}

function saveSenderName(name: string): void {
  try {
    localStorage.setItem(KEY, name.trim());
  } catch {
    // Storage blocked: recaps fall back to your NEAR account name.
  }
}

/** Recaps: the name they're sent under, signed with, and given to action items the notes say are yours. */
export function RecapSettings() {
  const [name, setName] = useState(senderName);
  const [agentWork, setAgentWork] = useState(recapAgentWork);
  return (
    <section aria-labelledby="h-recaps" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <SectionTitle id="h-recaps">Recaps</SectionTitle>
        <p className="m-0 text-ink-2">How the people on your calls see your recaps.</p>
      </div>
      <Card pad="md">
        <Field
          label="Your name"
          hint={
            name.trim()
              ? `Recaps come from “${name.trim()} via Aftercall”, end with your name, and show your action items as yours.`
              : "Without it, recaps come from your NEAR account name."
          }
        >
          <Input
            value={name}
            maxLength={60}
            autoComplete="name"
            placeholder="e.g. Victor"
            onChange={(e) => {
              // Saved as you type, so leaving Settings straight away doesn't lose it.
              setName(e.target.value);
              saveSenderName(e.target.value);
            }}
          />
        </Field>
        <div className="mt-4 flex items-center gap-4 border-t border-hairline pt-4">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="t-title">Say what coding agents finished</span>
            <span className="text-[13px] leading-[19px] text-ink-2">
              {agentWork
                ? "On. Recaps list the action items an agent marked done, with its link, as the agent's word. The footer says Aftercall didn't check them."
                : "Off. Recaps list open action items only."}
            </span>
          </span>
          <Toggle
            aria-label="Say what coding agents finished"
            checked={agentWork}
            onChange={(on) => {
              setAgentWork(on);
              saveRecapAgentWork(on);
            }}
          />
        </div>
      </Card>
    </section>
  );
}
