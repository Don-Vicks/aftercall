import { useState } from "react";
import { Bot } from "lucide-react";
import { handoffBlockers, handoffPrompt, type ActionItem, type HandoffAgent, type Meeting } from "@aftercall/core";
import { PREVIEW_INFO, agentsApi, reachesProject, type AgentsInfo } from "./agents";
import { projectsApi } from "./projects";
import { isDesktop } from "./recorder";
import { IconButton, Menu, toast } from "./ui";

interface Access {
  blockers: string[];
  /** The project's code folder, where Open in Claude Code starts. */
  codeFolder?: string;
  /** The meeting's project is one the user keeps from agents: no prompt is offered, as Open in Claude Code starts nothing. */
  kept: boolean;
}

/** What the agent switches allow, from the app (the preview has no app, so agents read as off), and the project's code folder. */
async function access(meeting: Pick<Meeting, "project">): Promise<Access> {
  // If the app can't say which projects agents reach, offer no prompt, as Open in Claude Code would.
  const info: AgentsInfo = isDesktop ? await agentsApi.info().catch(() => ({ ...PREVIEW_INFO, projects: [] })) : PREVIEW_INFO;
  const project = (await projectsApi.list().catch(() => [])).find((p) => p.name === meeting.project);
  const projectAllowed = reachesProject(info, project?.id);
  return { blockers: handoffBlockers({ ...info, projectAllowed }, meeting.project), codeFolder: project?.codeFolder, kept: !projectAllowed };
}

/** Copies the prompt and says, in the same toast, which switch would refuse the agent; `lead` says why it was copied, when it was a fallback. */
async function copyPrompt(meeting: Pick<Meeting, "id" | "title" | "project">, item: ActionItem, agent: HandoffAgent, blockers: string[], lead?: string) {
  try {
    await navigator.clipboard.writeText(handoffPrompt(meeting, item, agent));
  } catch {
    toast({ text: "Couldn't copy the prompt. Try again.", tone: "record" });
    return;
  }
  if (lead) return toast({ text: `${lead} Paste it into ${agent}.`, tone: "caution" });
  toast(
    blockers.length
      ? { text: `Prompt for ${agent} copied. ${blockers[0]}`, tone: "caution" }
      : { text: `Prompt for ${agent} copied. Paste it into a new ${agent} session.`, tone: "verdigris" },
  );
}

/**
 * Opens Terminal in the project's code folder with claude and the prompt. When something
 * is missing (claude, Node, agents off), it says so plainly and copies the prompt instead.
 * A project kept from agents starts nothing and copies nothing: the prompt holds the item's words.
 */
async function openClaude(meeting: Pick<Meeting, "id" | "title" | "project">, item: ActionItem, blockers: string[]) {
  const prompt = handoffPrompt(meeting, item, "Claude Code");
  const out = await agentsApi.openClaude(meeting.project, prompt).catch((e: unknown) => ({ ok: false, missing: undefined, message: e instanceof Error ? e.message : String(e) }));
  if (out.missing === "project") return toast({ text: out.message, tone: "caution" });
  if (!out.ok) return copyPrompt(meeting, item, "Claude Code", blockers, out.missing === "claude" ? out.message : `${out.message} The prompt is copied instead.`);
  toast(blockers.length ? { text: `${out.message} ${blockers[0]}`, tone: "caution" } : { text: out.message, tone: "verdigris" });
}

/**
 * "Hand to an agent" on an open action item: a quiet button beside Edit that copies a
 * ready prompt for Claude Code or Codex (`handoffPrompt` in core). The prompt quotes the
 * item as data and asks the agent to claim it through Aftercall's MCP server and complete
 * it with a link to the work. The menu says which switches are off, if any; in a project
 * kept from agents its items are off and it says why.
 */
export function HandToAgent({ meeting, item }: { meeting: Pick<Meeting, "id" | "title" | "project">; item: ActionItem }) {
  const [state, setState] = useState<Access | null>(null);
  const refresh = () =>
    access(meeting).then((a) => {
      setState(a);
      return a;
    });
  const current = () => (state ? Promise.resolve(state) : refresh());
  const copy = (agent: HandoffAgent) => () => {
    void current().then((a) => (a.kept ? toast({ text: a.blockers[0], tone: "caution" }) : copyPrompt(meeting, item, agent, a.blockers)));
  };
  const kept = state?.kept ?? false;
  const blockers = state?.blockers ?? null;

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
          ...(state?.codeFolder && isDesktop ? [{ label: "Open in Claude Code", disabled: kept, onSelect: () => void current().then((a) => openClaude(meeting, item, a.blockers)) }, null] : []),
          { label: "Copy prompt for Claude Code", disabled: kept, onSelect: copy("Claude Code") },
          { label: "Copy prompt for Codex", disabled: kept, onSelect: copy("Codex") },
        ]}
        note={
          blockers === null
            ? "Checking what agents may do…"
            : blockers.length
              ? blockers.join(" ")
              : state?.codeFolder
                ? "The agent claims this item through Aftercall and completes it with a link to the work. Open in Claude Code starts it in this project's code folder."
                : `The agent claims this item through Aftercall and completes it with a link to the work. Set a code folder on ${meeting.project}'s page to open Claude Code there.`
        }
      />
    </span>
  );
}
