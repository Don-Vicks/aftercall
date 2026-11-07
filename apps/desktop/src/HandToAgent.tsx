import { useState } from "react";
import { Bot } from "lucide-react";
import { handoffBlockers, handoffPrompt, type ActionItem, type HandoffAgent, type Meeting } from "@aftercall/core";
import { PREVIEW_INFO, agentsApi, type AgentsInfo } from "./agents";
import { isDesktop } from "./recorder";
import { IconButton, Menu, toast } from "./ui";

/** What the agent switches allow, from the app; the preview has no app, so agents read as off. */
async function access(): Promise<AgentsInfo & { projectAllowed: boolean }> {
  const info = isDesktop ? await agentsApi.info().catch(() => PREVIEW_INFO) : PREVIEW_INFO;
  return { ...info, projectAllowed: true };
}

/** Copies the prompt and says, in the same toast, which switch would refuse the agent. */
async function copyPrompt(meeting: Pick<Meeting, "id" | "title" | "project">, item: ActionItem, agent: HandoffAgent, blockers: string[]) {
  try {
    await navigator.clipboard.writeText(handoffPrompt(meeting, item, agent));
  } catch {
    toast({ text: "Couldn't copy the prompt. Try again.", tone: "record" });
    return;
  }
  toast(
    blockers.length
      ? { text: `Prompt for ${agent} copied. ${blockers[0]}`, tone: "caution" }
      : { text: `Prompt for ${agent} copied. Paste it into a new ${agent} session.`, tone: "verdigris" },
  );
}

/**
 * "Hand to an agent" on an open action item: a quiet button beside Edit that copies a
 * ready prompt for Claude Code or Codex (`handoffPrompt` in core). The prompt quotes the
 * item as data and asks the agent to claim it through Aftercall's MCP server and complete
 * it with a link to the work. The menu says which switches are off, if any.
 */
export function HandToAgent({ meeting, item }: { meeting: Pick<Meeting, "id" | "title" | "project">; item: ActionItem }) {
  const [blockers, setBlockers] = useState<string[] | null>(null);
  const refresh = () =>
    access().then((a) => {
      const found = handoffBlockers(a, meeting.project);
      setBlockers(found);
      return found;
    });
  const copy = (agent: HandoffAgent) => () => {
    void (blockers ? Promise.resolve(blockers) : refresh()).then((b) => copyPrompt(meeting, item, agent, b));
  };

  return (
    <span className="absolute top-1/2 right-full mr-[38px] flex -translate-y-1/2">
      <Menu
        label={`Hand “${item.text}” to an agent`}
        align="end"
        width={260}
        trigger={(p) => (
          <IconButton
            {...p}
            onClick={() => {
              void refresh();
              p.onClick();
            }}
            size="sm"
            variant="quiet"
            aria-label={`Hand “${item.text}” to an agent`}
            tooltip="Hand to an agent"
            className="opacity-0 transition-opacity duration-(--dur-1) group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
          >
            <Bot size={14} strokeWidth={2} aria-hidden="true" />
          </IconButton>
        )}
        items={[
          { label: "Copy prompt for Claude Code", onSelect: copy("Claude Code") },
          { label: "Copy prompt for Codex", onSelect: copy("Codex") },
        ]}
        note={
          blockers === null
            ? "Checking what agents may do…"
            : blockers.length
              ? blockers.join(" ")
              : "The agent claims this item through Aftercall and completes it with a link to the work."
        }
      />
    </span>
  );
}
