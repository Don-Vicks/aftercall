import { clockTime, dayWord, formatUsdc, hasFullChecks, type FollowUp, type Meeting, type Network } from "@aftercall/core";
import type { SavedNotes } from "./nearai";

/**
 * "Where this meeting went": what happened to one meeting's data, in order, built only
 * from what the app already stores (notes.json and the meeting's follow-ups). Nothing
 * here is logged for this list; an entry with no time is one the app doesn't time-stamp.
 * The facts follow the README's "Follow-ups: what leaves, who approves, what's kept"
 * and docs/privacy.md.
 */
export interface TrailEntry {
  id: string;
  /** What happened, in a few words. */
  what: string;
  /** One more line, when it helps. */
  detail?: string;
  /** As stored: "Today 14:20" from an ISO time, or "14:06" for follow-ups (the app keeps no date for those). */
  when?: string;
  /** Who said yes. */
  who?: string;
  /** What is kept, and where. */
  kept: string;
  /** A NEAR transaction; `network` null when the app doesn't know it, so no explorer link. */
  tx?: { hash: string; network: Network | null };
}

export interface TrailInput {
  meeting: Meeting;
  /** notes.json; absent for the made-up sample and before the notes are read. */
  saved?: SavedNotes;
  /** The NEAR network payments went through, for explorer links. */
  network?: Network | null;
  now?: number;
}

/**
 * In order: the notes, the audio, the proof (the order processing runs them), then each
 * follow-up that left (by its clock time), then what coding agents did with action items
 * (by time). Follow-ups keep only a clock time, so they aren't interleaved with agent marks.
 */
export function meetingTrail({ meeting, saved, network = null, now = Date.now() }: TrailInput): TrailEntry[] {
  const at = (iso: string | undefined) => {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isNaN(t) ? undefined : `${dayWord(t, now)} ${clockTime(t)}`;
  };
  const out: TrailEntry[] = [];

  if (saved) {
    const checks = hasFullChecks(saved.proof) ? saved.proof.checks : (saved.checks ?? []);
    const passed = checks.filter((c) => c.ok).length;
    const e2ee = hasFullChecks(saved.proof) && saved.proof.e2ee.used;
    out.push({
      id: "notes",
      what: "Notes made in NEAR AI's secure hardware",
      detail: [
        checks.length ? (passed === checks.length ? `${passed} checks passed` : `${passed} of ${checks.length} checks passed`) : "Made before full checks",
        e2ee ? "transcript end-to-end encrypted" : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
      when: at(saved.processedAt),
      kept: "On this Mac, sealed. NEAR AI's policy for what it saw",
    });
    out.push({
      id: "audio",
      what: "Audio deleted from this Mac",
      detail: "Aftercall deletes it once the notes are saved. Not logged with a time",
      kept: "Not on this Mac",
    });
    const c = saved.onChain;
    out.push(
      c
        ? { id: "proof", what: "Proof recorded on NEAR", detail: "A hash and the model name, no meeting content", kept: "On NEAR, public, for good", tx: { hash: c.txHash, network: c.network } }
        : { id: "proof", what: "Proof not on NEAR yet", detail: "You can record it from Verify", kept: "On this Mac only" },
    );
  }

  const net = network ?? saved?.onChain?.network ?? null;
  const left = meeting.followUps.flatMap((f) => followUpEntries(f, net));
  // "14:06" sorts as text; entries with no time keep their place at the end.
  left.sort((a, b) => (a.when ?? "99:99").localeCompare(b.when ?? "99:99"));
  out.push(...left);

  const agents: (TrailEntry & { t: number })[] = [];
  for (const a of meeting.actionItems) {
    for (const [mark, verb] of [
      [a.claimed, "claimed"],
      [a.completed, "marked done"],
    ] as const) {
      if (!mark) continue;
      agents.push({
        id: `agent-${verb}-${a.id}`,
        t: Date.parse(mark.at) || 0,
        what: `${mark.agent} ${verb} "${a.text}"`,
        when: at(mark.at),
        who: "You, by letting agents claim items",
        kept: "On this Mac, sealed, in the meeting's notes",
      });
    }
  }
  agents.sort((a, b) => a.t - b.t);
  out.push(...agents.map(({ t: _t, ...e }) => e));
  return out;
}

const approver = (f: FollowUp) => (f.byAutopilot ? "Autopilot, under your rule" : f.byPhone ? "You, approved on your phone" : "You");

/** What one follow-up sent out, if anything. Proposed, sending and dismissed ones sent nothing. */
function followUpEntries(f: FollowUp, network: Network | null): TrailEntry[] {
  const out: TrailEntry[] = [];
  if (f.kind === "email") {
    // Drafting opens your own mail app; it stays true even if the item was dismissed after.
    if (f.draftedAt)
      out.push({
        id: `${f.id}-draft`,
        what: `Recap drafted in Mail${f.toName ? ` for ${f.toName}` : ""}`,
        when: f.draftedAt,
        who: "You, if you send it from Mail",
        kept: "Your mail provider, once sent",
      });
    if (f.status === "sent")
      out.push({
        id: `${f.id}-sent`,
        what: `Recap sent to ${f.to || f.toName} through Aftercall`,
        detail: f.ref ? `Resend email id ${f.ref}` : undefined,
        when: f.doneAt,
        who: approver(f),
        kept: "Resend keeps sent mail. Aftercall's backend keeps a count",
      });
    return out;
  }

  const amount = f.amount === null ? "a payment" : `${formatUsdc(f.amount)} USDC`;
  const payee = f.payeeAccount ? `${f.payeeName} (${f.payeeAccount})` : f.payeeName;
  const tx = f.ref ? { hash: f.ref, network } : undefined;
  if (f.claim)
    out.push({
      id: `${f.id}-claim`,
      what: `Claim link made for ${f.payeeName}`,
      detail: "Their name and the meeting title stay in the link",
      kept: "Aftercall's backend: a token hash and the amount",
    });
  if (f.status === "paid")
    out.push({
      id: `${f.id}-paid`,
      what: `Paid ${amount} to ${payee}`,
      detail: f.crossChain ? `On ${f.crossChain.chain === "solana" ? "Solana" : "Base"}, through NEAR Intents` : "Memo \"Aftercall payment\", nothing about the meeting",
      when: f.doneAt,
      who: approver(f),
      kept: f.crossChain ? "On NEAR, public, for good. 1Click's own policy" : "On NEAR, public, for good",
      tx,
    });
  else if (f.status === "blocked")
    out.push({
      id: `${f.id}-parked`,
      what: `Parked for your wallet: ${amount} to ${payee}`,
      detail: "Over a cap, so it wasn't paid",
      who: "Your NEAR wallet only",
      kept: "On NEAR: the parked payment and your decision",
      tx,
    });
  else if (f.status === "failed" && f.ref)
    out.push({
      id: `${f.id}-failed`,
      what: `Payment to ${payee} bounced`,
      detail: "The amount went back to your agent wallet",
      who: approver(f),
      kept: "On NEAR, public, for good",
      tx,
    });
  return out;
}
