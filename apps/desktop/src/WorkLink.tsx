import { openUrl } from "@tauri-apps/plugin-opener";
import { workLink, workLinkLabel, type AgentCompletion } from "@aftercall/core";
import { isDesktop } from "./recorder";
import { Tooltip } from "./ui";

/**
 * The link an agent gave when it completed an item, as "PR #42". It is the agent's
 * statement, and the tooltip says so: Aftercall opens it in your browser when you click,
 * and never checks what's behind it. A link that isn't plain http or https isn't shown.
 */
export function WorkLink({ completion }: { completion: AgentCompletion }) {
  const link = workLink(completion.link);
  if (!link) return null;
  const label = workLinkLabel(link);
  return (
    <Tooltip content={`${link} · as ${completion.agent} gave it; Aftercall doesn't check it`}>
      <button
        type="button"
        onClick={() => (isDesktop ? openUrl(link) : window.open(link, "_blank", "noopener,noreferrer"))}
        aria-label={`Open ${label}, the link ${completion.agent} gave`}
        className="rounded-sm font-medium text-verdigris hover:text-verdigris-hover"
      >
        {label}
      </button>
    </Tooltip>
  );
}
