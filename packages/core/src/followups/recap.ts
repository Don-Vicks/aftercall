import type { EmailFollowUp, Meeting, NoticeLog } from "../meeting.ts";
import type { Attendee } from "../calendar.ts";
import { hasFullChecks, type ProofBundle } from "../notes/pipeline.ts";
import { workLink, workLinkLabel } from "../agents/work.ts";

export interface Recap {
  to: string;
  subject: string;
  text: string;
  /** The same recap laid out for mail apps that show HTML; `text` is the plain version sent with it. */
  html: string;
}

/** What the recap footer may say about a meeting: only what the app knows. */
export interface RecapFacts {
  /** Every attestation check and the summary's signature passed. */
  verified: boolean;
  /** Whether the transcript was end-to-end encrypted; null when unknown (a v1 proof, or none). */
  e2ee: boolean | null;
  /** The notice the sender logged before recording, if any. */
  notice?: NoticeLog;
  /** The meeting's public proof link, when it has one. */
  verifyUrl?: string;
  /** A page on what Aftercall checks and what it can't, for meetings without a proof link. */
  handlingUrl: string;
  /** How many action items in the recap the sender edited after the notes were made (`buildRecap` counts them). */
  editedItems?: number;
  /** How many items the recap lists as done by coding agents (`buildRecap` counts them, with `agentWork`). */
  agentItems?: number;
}

/** The heading over items coding agents marked done, when the sender includes them. */
export const RECAP_AGENT_HEADING = "Done by coding agents";

/** The mark after an action item the sender edited after the notes were made. */
export const RECAP_EDITED_MARK = "(edited by the sender)";

/** Every recap footer has this, so a sender (or the backend) can tell the footer is there. */
export const RECAP_FOOTER_MARK = "What was and wasn't checked:";

/**
 * The footer every recap ends with. It states what the app checked and what the
 * sender said, and nothing it can't check: not that everyone agreed, not what NEAR AI
 * keeps. The audio line holds because the Mac app deletes the audio right after it
 * saves the notes, and at launch for any processed recording that still has some.
 */
export function recapFooter(facts: RecapFacts): string {
  const made = facts.verified
    ? `Notes made by Aftercall in secure hardware on NEAR AI Cloud, checked by the app before anything was sent.${
        facts.e2ee === true ? " The transcript was end-to-end encrypted to that hardware." : facts.e2ee === false ? " The transcript went over TLS, not end-to-end encrypted." : ""
      }`
    : "Notes made by Aftercall on NEAR AI Cloud. Not every secure-hardware check passed for this meeting.";
  const edited = facts.editedItems
    ? `The sender changed ${facts.editedItems === 1 ? "1 action item" : `${facts.editedItems} action items`} after the notes were made, marked ${RECAP_EDITED_MARK}. Aftercall didn't check ${facts.editedItems === 1 ? "that change" : "those changes"}.`
    : "";
  const agents = facts.agentItems
    ? `${RECAP_AGENT_HEADING} is what ${facts.agentItems === 1 ? "a coding agent" : "coding agents"} reported, with ${facts.agentItems === 1 ? "its" : "their"} own words and links. Aftercall didn't check the work or what the links point to.`
    : "";
  return [
    made,
    edited,
    agents,
    "Aftercall deletes the call's audio once the notes are saved.",
    facts.notice ? "The sender confirmed telling everyone on the call before recording (Aftercall can't check this)." : "",
    `${RECAP_FOOTER_MARK} ${facts.verifyUrl ?? facts.handlingUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The footer's facts from a saved meeting and its proof, so every caller reads them the same way. */
export function recapFactsFrom(meeting: Meeting, proof: ProofBundle | undefined, handlingUrl: string, verifyUrl?: string): RecapFacts {
  const v2 = hasFullChecks(proof) ? proof : undefined;
  return {
    verified: meeting.verified,
    e2ee: v2 ? v2.e2ee.used : null,
    ...(v2?.notice ? { notice: v2.notice } : {}),
    ...(verifyUrl ? { verifyUrl } : {}),
    handlingUrl,
  };
}

/** A recap's subject says it's a recap, once, so it reads as one in the inbox ("Kickoff Recap" stays as it is). */
export function recapSubject(subject: string): string {
  const s = subject.trim();
  return /^recap\b|\brecap$/i.test(s) ? s : `Recap: ${s}`;
}

/**
 * The name a recap greets. A recap the call asked for "me" is addressed to "You" in the notes,
 * which would read "Hi You"; that and an empty name get "there".
 */
export function recapGreetingName(toName: string | undefined): string {
  const n = toName?.trim() ?? "";
  return !n || /^(you|me|myself|yourself)$/i.test(n) ? "there" : n;
}

/**
 * Who an action item is for, as the person reading the recap should see it. The notes say
 * "You" for whoever recorded the call, which a recipient would read as themselves, so it
 * becomes the sender's name ("me" without one). An item nobody owns shows no owner.
 */
export function recapOwner(owner: string, sender?: string): string | null {
  const o = owner.trim();
  if (!o || /^(unassigned|unknown|none|tbd)$/i.test(o)) return null;
  if (/^you$/i.test(o)) return sender?.trim() || "me";
  return o;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One item a coding agent marked done, as a recap lists it: the agent's name and its link, when it gave a valid one. */
export interface AgentWorkItem {
  text: string;
  agent: string;
  link?: string;
}

/**
 * Items coding agents marked done that are still done, for a recap that includes them.
 * A link that isn't a plain http or https URL is left out.
 */
export function agentWorkItems(meeting: Pick<Meeting, "actionItems">): AgentWorkItem[] {
  return meeting.actionItems.flatMap((a) => {
    if (!a.done || !a.completed) return [];
    const link = workLink(a.completed.link);
    // The name is the agent's own; on one line, so it can't pass for a line of the recap.
    const agent = a.completed.agent.replace(/\s+/g, " ").trim() || "an agent";
    return [{ text: a.text, agent, ...(link ? { link } : {}) }];
  });
}

/**
 * Recap of a meeting for one follow-up, as plain text and as HTML with the same words.
 * With `agentWork`, it also lists the items coding agents marked done, as the agents'
 * own statement, and the footer says Aftercall didn't check them.
 */
export function buildRecap(meeting: Meeting, f: EmailFollowUp, opts: { sender?: string; facts: RecapFacts; agentWork?: boolean }): Recap {
  const greeting = `Hi ${recapGreetingName(f.toName)}, thanks for the call. Here's what we agreed.`;
  const open = meeting.actionItems.filter((a) => !a.done);
  const items = open.map((a) => {
    const owner = recapOwner(a.owner, opts.sender);
    // Items you changed after the notes were made say so, here and in the footer.
    return { text: a.text, meta: [owner, a.due].filter(Boolean).join(" · "), edited: Boolean(a.edited) };
  });
  const work = opts.agentWork ? agentWorkItems(meeting) : [];
  const editedItems = items.filter((a) => a.edited).length;
  const facts = { ...opts.facts, ...(editedItems ? { editedItems } : {}), ...(work.length ? { agentItems: work.length } : {}) };

  const lines: string[] = [greeting, "", meeting.summary, ""];
  if (meeting.decisions.length) {
    lines.push("DECISIONS");
    meeting.decisions.forEach((d, i) => lines.push(`${i + 1}. ${d}`));
    lines.push("");
  }
  if (items.length) {
    lines.push("ACTION ITEMS");
    items.forEach((a) => lines.push(`- ${a.text}${a.meta ? ` · ${a.meta}` : ""}${a.edited ? ` ${RECAP_EDITED_MARK}` : ""}`));
    lines.push("");
  }
  if (work.length) {
    lines.push(RECAP_AGENT_HEADING.toUpperCase());
    work.forEach((w) => lines.push(`- ${w.text} · done by ${w.agent}${w.link ? ` · ${w.link}` : ""}`));
    lines.push("");
  }
  if (opts.sender) lines.push(opts.sender, "");
  lines.push("--", recapFooter(facts));

  return { to: f.to, subject: recapSubject(f.subject), text: lines.join("\n"), html: recapHtml(greeting, meeting, items, work, opts.sender, facts) };
}

/**
 * The HTML layout: headings, a numbered list of decisions, action items with who and when,
 * and the footer in small type with its long proof link behind a short label. Every
 * word comes from the same places as the plain text; nothing is added.
 */
function recapHtml(
  greeting: string,
  meeting: Meeting,
  items: { text: string; meta: string; edited: boolean }[],
  work: AgentWorkItem[],
  sender: string | undefined,
  facts: RecapFacts,
): string {
  const p = (s: string) => `<p style="margin:0 0 16px">${escapeHtml(s)}</p>`;
  const h = (s: string) => `<p style="margin:24px 0 8px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#6b6b6b">${s}</p>`;
  const body: string[] = [p(greeting), p(meeting.summary)];
  if (meeting.decisions.length) {
    body.push(h("Decisions"), `<ol style="margin:0 0 16px;padding-left:22px">${meeting.decisions.map((d) => `<li style="margin:0 0 6px">${escapeHtml(d)}</li>`).join("")}</ol>`);
  }
  if (items.length) {
    const li = (a: (typeof items)[number]) =>
      `<li style="margin:0 0 8px">${escapeHtml(a.text)}${a.meta ? `<br><span style="color:#6b6b6b;font-size:13px">${escapeHtml(a.meta)}</span>` : ""}${a.edited ? ` <span style="color:#6b6b6b;font-size:13px">${escapeHtml(RECAP_EDITED_MARK)}</span>` : ""}</li>`;
    body.push(h("Action items"), `<ul style="margin:0 0 16px;padding-left:22px">${items.map(li).join("")}</ul>`);
  }
  if (work.length) {
    // The agent's link, behind a short label; it is one the agent gave, never checked.
    const li = (w: AgentWorkItem) =>
      `<li style="margin:0 0 8px">${escapeHtml(w.text)}<br><span style="color:#6b6b6b;font-size:13px">done by ${escapeHtml(w.agent)}${
        w.link ? ` · <a href="${escapeHtml(w.link)}" style="color:#2f7d6d">${escapeHtml(workLinkLabel(w.link))}</a>` : ""
      }</span></li>`;
    body.push(h(RECAP_AGENT_HEADING), `<ul style="margin:0 0 16px;padding-left:22px">${work.map(li).join("")}</ul>`);
  }
  if (sender) body.push(p(sender));

  // The footer's lines as recapFooter() writes them; its last line keeps the mark, with the link behind a label.
  const footer = recapFooter(facts).split("\n");
  const url = facts.verifyUrl ?? facts.handlingUrl;
  const label = facts.verifyUrl ? "open the proof" : "how Aftercall handles a call";
  const footerHtml = footer
    .map((line) =>
      line.startsWith(RECAP_FOOTER_MARK)
        ? `${escapeHtml(RECAP_FOOTER_MARK)} <a href="${escapeHtml(url)}" style="color:#2f7d6d">${label}</a>`
        : escapeHtml(line),
    )
    .join("<br>");

  return [
    `<div style="max-width:600px;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1d1d1f">`,
    ...body,
    `<div style="margin-top:28px;padding-top:14px;border-top:1px solid #e3e3e3;font-size:12px;line-height:1.6;color:#6b6b6b">${footerHtml}</div>`,
    `</div>`,
  ].join("");
}

/** A mailto: link that opens the recap as a draft in the person's own mail app. */
export function mailtoLink(r: Recap): string {
  const q = `subject=${encodeURIComponent(r.subject)}&body=${encodeURIComponent(r.text)}`;
  return `mailto:${encodeURIComponent(r.to).replace(/%40/g, "@")}?${q}`;
}

/**
 * A recap you add on the meeting page ("Send a recap"), when the call didn't ask for one or
 * you want another. Addressed to the one invited person with an email, if there is exactly
 * one; otherwise the address is left for you to pick or type. Its id is `you1`, `you2`…
 * so it never takes the id of a follow-up from the notes (`f1`…) or an agent's.
 */
export function newRecap(meeting: Pick<Meeting, "title" | "followUps">, invited: Attendee[] = []): EmailFollowUp {
  const taken = new Set(meeting.followUps.map((f) => f.id));
  let n = 1;
  while (taken.has(`you${n}`)) n++;
  const withEmail = invited.filter((a) => a.email.trim());
  const one = withEmail.length === 1 ? withEmail[0] : undefined;
  return {
    id: `you${n}`,
    kind: "email",
    status: "proposed",
    addedByYou: true,
    to: one?.email.trim() ?? "",
    toName: one ? one.name.trim() || one.email.trim().split("@")[0] : "",
    subject: recapSubject(meeting.title.trim() || "Our call"),
  };
}
