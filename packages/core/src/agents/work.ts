/**
 * The link a coding agent gives when it completes an action item: a pull request, commit
 * or document. It is the agent's statement, shown as such; Aftercall never opens it,
 * checks it, or lets it reach anything that pays. The app takes it only when it passes
 * the same rules as the Mac app's `check_link` (apps/desktop/src-tauri/src/agents.rs).
 */

/** The longest link kept, in characters. */
export const WORK_LINK_MAX = 300;

/**
 * The link as given when it is a plain http or https URL: one line of printable ASCII
 * (anything else percent-encoded), a host, no user name or password, at most
 * `WORK_LINK_MAX` characters. Otherwise null.
 */
export function workLink(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const link = raw.trim();
  if (!link || link.length > WORK_LINK_MAX || !/^[\x21-\x7e]+$/.test(link)) return null;
  const m = /^https?:\/\/([^/?#]*)/i.exec(link);
  if (!m || !m[1] || m[1].includes("@")) return null;
  try {
    const u = new URL(link);
    return u.protocol === "http:" || u.protocol === "https:" ? link : null;
  } catch {
    return null;
  }
}

/** A short name for a link: "PR #42", "commit 1a2b3c4", "issue #7", "MR !12", else the host. */
export function workLinkLabel(link: string): string {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return link;
  }
  const host = u.hostname.replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  if (host === "github.com" && parts.length >= 4) {
    const [, , kind, ref] = parts;
    if (kind === "pull" && /^\d+$/.test(ref)) return `PR #${ref}`;
    if (kind === "issues" && /^\d+$/.test(ref)) return `issue #${ref}`;
    if (kind === "commit" && /^[0-9a-f]{7,40}$/i.test(ref)) return `commit ${ref.slice(0, 7)}`;
  }
  const mr = parts.indexOf("merge_requests");
  if (mr > 0 && /^\d+$/.test(parts[mr + 1] ?? "")) return `MR !${parts[mr + 1]}`;
  return host;
}
