import type { FollowUp } from "../meeting.ts";

/** What the person allows to happen without a tap. Off unless they turn it on. */
export interface AutopilotRules {
  /** Pay listed payees within the per-payment limit. */
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

/** Seconds a person has to undo an autopilot follow-up before it runs. */
export const UNDO_SECONDS = 60;

/**
 * Whether a follow-up may run by itself. Every rule must pass; anything unclear
 * waits for a person. The contract enforces the money limits again on chain.
 */
export function autopilotDecision(f: FollowUp, rules: AutopilotRules, limits: WalletLimits | null): Decision {
  const reasons: string[] = [];
  if (f.status !== "proposed") return { run: false, reasons: ["Not waiting"] };
  if (f.kind === "email") {
    const domain = f.to.split("@")[1]?.toLowerCase();
    if (!f.to) reasons.push("No email address");
    else if (!domain || !rules.recapDomains.map((d) => d.toLowerCase().replace(/^@/, "")).includes(domain)) reasons.push("Not your team's domain");
    return { run: reasons.length === 0, reasons };
  }
  if (!rules.payments) reasons.push("Autopilot payments are off");
  if (!f.payeeListed) reasons.push("Payee isn't on your list");
  if (f.amount === null) reasons.push("Amount unclear");
  if (!limits) reasons.push("Agent wallet not connected");
  else if (f.amount !== null) {
    if (limits.perPaymentCap === 0n) reasons.push("No per-payment limit set");
    else if (f.amount > limits.perPaymentCap) reasons.push("Over your per-payment limit");
    if (f.amount > limits.leftToday) reasons.push("Over what's left today");
  }
  return { run: reasons.length === 0, reasons };
}
