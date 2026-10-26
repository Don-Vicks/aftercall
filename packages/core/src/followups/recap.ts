import type { EmailFollowUp, Meeting } from "../meeting.ts";

export interface Recap {
  to: string;
  subject: string;
  text: string;
}

/** The privacy and consent line every recap ends with. */
export function consentLine(verifyUrl?: string): string {
  return [
    "This call was recorded with notice to everyone on it and processed in secure hardware on NEAR AI Cloud.",
    "The recording was deleted after transcription and is never used to train AI.",
    verifyUrl ? `Verify how it was processed: ${verifyUrl}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Plain-text recap of a meeting for one follow-up, as in the design. */
export function buildRecap(meeting: Meeting, f: EmailFollowUp, opts: { sender?: string; verifyUrl?: string } = {}): Recap {
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
    open.forEach((a) => lines.push(`- ${a.text} · ${a.owner}${a.due ? ` · ${a.due}` : ""}`));
    lines.push("");
  }
  if (opts.sender) lines.push(opts.sender, "");
  lines.push("--", consentLine(opts.verifyUrl));
  return { to: f.to, subject: f.subject, text: lines.join("\n") };
}

/** A mailto: link that opens the recap as a draft in the person's own mail app. */
export function mailtoLink(r: Recap): string {
  const q = `subject=${encodeURIComponent(r.subject)}&body=${encodeURIComponent(r.text)}`;
  return `mailto:${encodeURIComponent(r.to).replace(/%40/g, "@")}?${q}`;
}
