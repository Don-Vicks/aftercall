import type { AmountProblemKind, FollowUp, Meeting } from "../meeting.ts";

/** What the person allows to happen without a tap. Off unless they turn it on. */
export interface AutopilotRules {
  /** Pay listed payees within the per-payment cap and what's left today. With no per-payment cap set, nothing is paid. */
  payments: boolean;
  /** Send recaps to these email domains (your own team). Empty: never. */
  recapDomains: string[];
}

export const DEFAULT_RULES: AutopilotRules = { payments: false, recapDomains: [] };

export interface WalletLimits {
  /** USDC base units the agent wallet can still pay today. */
  leftToday: bigint;
  /** The contract's per-payment cap; 0 means none, so autopilot won't pay. */
  perPaymentCap: bigint;
}

export interface Decision {
  run: boolean;
  /** Why it waits for a person, in plain words. */
  reasons: string[];
}

/** Why a payment with no amount waits for a person, in plain words. */
export const AMOUNT_PROBLEM_REASONS: Record<AmountProblemKind, string> = {
  "not-in-quote": "Amount isn't in the quote",
  "not-usdc": "Amount isn't in US dollars",
  unclear: "Amount unclear",
};

/** Why a follow-up a coding agent proposed waits for a person: always. */
export const agentProposalReason = (agent: string) => `Proposed by ${agent}: what an agent proposes always waits for you`;

/** Seconds a person has to undo an autopilot follow-up before it runs. */
export const UNDO_SECONDS = 60;

/** Why a held follow-up waits for you, in plain words. */
export const AUTOPILOT_HELD = "Autopilot held this: Aftercall closed during its undo window.";

/**
 * A meeting as read from disk, with every follow-up autopilot queued in an earlier run
 * of the app taken off the queue and marked held: an undo window that was running when
 * Aftercall closed never runs out unseen on the next launch. `queuedHere` names the
 * follow-ups this run queued, which keep their countdown. Null when nothing changes.
 */
export function holdInterruptedAutopilot(m: Meeting, queuedHere: (followUpId: string) => boolean = () => false): Meeting | null {
  const interrupted = (f: FollowUp) => !!f.autopilotAt && !queuedHere(f.id);
  if (!m.followUps.some(interrupted)) return null;
  return {
    ...m,
    followUps: m.followUps.map((f) => {
      if (!interrupted(f)) return f;
      const { autopilotAt: _queued, ...rest } = f;
      return { ...rest, autopilotHeld: true } as FollowUp;
    }),
  };
}

/** Why a meeting's follow-ups wait for you when its notes didn't verify. */
export const NOT_VERIFIED_REASON = "These notes aren't verified, so nothing in them runs by itself";

/**
 * Whether a follow-up in this meeting may run by itself: never from notes that aren't
 * verified (a check failed, or a reply's signature isn't the attested model's), however
 * the rules read; otherwise as autopilotDecision says.
 */
export function meetingAutopilotDecision(m: Pick<Meeting, "verified">, f: FollowUp, rules: AutopilotRules, limits: WalletLimits | null): Decision {
  if (!m.verified) return { run: false, reasons: [NOT_VERIFIED_REASON] };
  return autopilotDecision(f, rules, limits);
}

/**
 * Whether a follow-up may run by itself. Every rule must pass; anything unclear
 * waits for a person, and so does anything a coding agent proposed, whatever the
 * rules say. The contract enforces the money limits again on chain.
 */
export function autopilotDecision(f: FollowUp, rules: AutopilotRules, limits: WalletLimits | null): Decision {
  const reasons: string[] = [];
  if (f.status !== "proposed") return { run: false, reasons: ["Not waiting"] };
  // Only the call proposes what may run by itself; an agent's proposal needs your tap.
  if (f.proposedBy || !f.evidence) return { run: false, reasons: [agentProposalReason(f.proposedBy?.agent ?? "an agent")] };
  if (f.autopilotHeld) return { run: false, reasons: [AUTOPILOT_HELD] };
  if (f.kind === "email") {
    const domain = f.to.split("@")[1]?.toLowerCase();
    if (!f.to) reasons.push("No email address");
    else if (!domain || !rules.recapDomains.map((d) => d.toLowerCase().replace(/^@/, "")).includes(domain)) reasons.push("Not your team's domain");
    return { run: reasons.length === 0, reasons };
  }
  if (!rules.payments) reasons.push("Autopilot payments are off");
  if (!f.payeeListed) reasons.push("Payee isn't on your list");
  if (f.amount === null) reasons.push(AMOUNT_PROBLEM_REASONS[f.amountProblem ?? "unclear"]);
  if (!limits) reasons.push("Agent wallet not connected");
  else if (f.amount !== null) {
    if (limits.perPaymentCap === 0n) reasons.push("No per-payment cap set");
    else if (f.amount > limits.perPaymentCap) reasons.push("Over your per-payment cap");
    if (f.amount > limits.leftToday) reasons.push("Over what's left today");
  }
  return { run: reasons.length === 0, reasons };
}
