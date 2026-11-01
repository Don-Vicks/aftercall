import type { EmailFollowUp, Meeting, NoticeLog } from "../meeting.ts";
import type { ProofBundle } from "../notes/pipeline.ts";

export interface Recap {
  to: string;
  subject: string;
  text: string;
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
}

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
  return [
    made,
    edited,
    "Aftercall deletes the call's audio once the notes are saved.",
    facts.notice ? "The sender confirmed telling everyone on the call before recording (Aftercall can't check this)." : "",
    `${RECAP_FOOTER_MARK} ${facts.verifyUrl ?? facts.handlingUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The footer's facts from a saved meeting and its proof, so every caller reads them the same way. */
export function recapFactsFrom(meeting: Meeting, proof: ProofBundle | undefined, handlingUrl: string, verifyUrl?: string): RecapFacts {
  const v2 = proof?.version === 2 ? proof : undefined;
  return {
    verified: meeting.verified,
    e2ee: v2 ? v2.e2ee.used : null,
    ...(v2?.notice ? { notice: v2.notice } : {}),
    ...(verifyUrl ? { verifyUrl } : {}),
    handlingUrl,
  };
}

/** Plain-text recap of a meeting for one follow-up, as in the design. */
export function buildRecap(meeting: Meeting, f: EmailFollowUp, opts: { sender?: string; facts: RecapFacts }): Recap {
  const lines: string[] = [];
  lines.push(`Hi ${f.toName || "there"}, thanks for the call. Here's what we agreed.`, "");
  lines.push(meeting.summary, "");
  if (meeting.decisions.length) {
    lines.push("DECISIONS");
    meeting.decisions.forEach((d, i) => lines.push(`${i + 1}. ${d}`));
    lines.push("");
  }
  const open = meeting.actionItems.filter((a) => !a.done);
  if (open.length) {
    lines.push("ACTION ITEMS");
    // Items you changed after the notes were made say so, here and in the footer.
    open.forEach((a) => lines.push(`- ${a.text} · ${a.owner}${a.due ? ` · ${a.due}` : ""}${a.edited ? ` ${RECAP_EDITED_MARK}` : ""}`));
    lines.push("");
  }
  if (opts.sender) lines.push(opts.sender, "");
  const editedItems = open.filter((a) => a.edited).length;
  lines.push("--", recapFooter(editedItems ? { ...opts.facts, editedItems } : opts.facts));
  return { to: f.to, subject: f.subject, text: lines.join("\n") };
}

/** A mailto: link that opens the recap as a draft in the person's own mail app. */
export function mailtoLink(r: Recap): string {
  const q = `subject=${encodeURIComponent(r.subject)}&body=${encodeURIComponent(r.text)}`;
  return `mailto:${encodeURIComponent(r.to).replace(/%40/g, "@")}?${q}`;
}
