import { RECAP_AGENT_HEADING, type Recap } from "./recap.ts";

/**
 * Every Slack incoming webhook starts with this. The Mac app accepts nothing else, here
 * and again in Rust (`apps/desktop/src-tauri/src/slack.rs`) before it saves or posts.
 */
export const SLACK_WEBHOOK_PREFIX = "https://hooks.slack.com/services/";

/** Slack cuts a message's text after 40,000 characters; a recap that long is refused, not cut. */
export const SLACK_TEXT_MAX = 40_000;

export const SLACK_WEBHOOK_MESSAGE = `That isn't a Slack incoming webhook. Copy it again from Slack: it starts with ${SLACK_WEBHOOK_PREFIX}`;

/**
 * Why a pasted webhook URL can't be used, or null when it can: Slack's own address and
 * path (`https://hooks.slack.com/services/T…/B…/…`, three parts of letters and digits),
 * with nothing before or after it. So `hooks.slack.com.evil.com`, `http://`, a port, a
 * user name, a query or a fragment are all refused.
 */
export function slackWebhookProblem(url: string): string | null {
  const s = url.trim();
  if (!s) return "Paste the webhook URL from Slack.";
  if (!s.startsWith(SLACK_WEBHOOK_PREFIX)) return SLACK_WEBHOOK_MESSAGE;
  const parts = s.slice(SLACK_WEBHOOK_PREFIX.length).split("/");
  if (parts.length !== 3 || !parts.every((p) => /^[A-Za-z0-9]{1,64}$/.test(p))) return SLACK_WEBHOOK_MESSAGE;
  return null;
}

/** Slack reads &, < and > as markup (`<!channel>` pings everyone), so meeting text has them escaped. */
const escapeSlack = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The recap's headings as `buildRecap` writes them in the plain text. */
const HEADINGS = new Set(["DECISIONS", "ACTION ITEMS", RECAP_AGENT_HEADING.toUpperCase()]);

/**
 * A recap as a Slack message: the subject in bold, then `buildRecap`'s plain text word for
 * word, footer included, with its headings in bold. Nothing is added or left out, and the
 * meeting's text can't mention anyone or format a link.
 */
export function slackRecapText(recap: Pick<Recap, "subject" | "text">): string {
  const body = recap.text
    .split("\n")
    .map((line) => (HEADINGS.has(line) ? `*${line}*` : escapeSlack(line)))
    .join("\n");
  return `*${escapeSlack(recap.subject)}*\n\n${body}`;
}
