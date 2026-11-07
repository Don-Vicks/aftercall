/**
 * What agents may propose a payment to, and up to how much: the payee list and caps the
 * app just read from the agent-wallet contract, which it hands to the agents socket
 * (`agents_set_wallet`, `set_wallet` in apps/desktop/src-tauri/src/agents.rs). Amounts
 * are USDC base units as strings.
 */
export interface AgentWalletSnapshot {
  payees: { name: string; account: string }[];
  /** 0 means no per-payment cap, so agents propose no payments. */
  perPaymentCap: string;
  leftToday: string;
}

/** The contract's wallet, as much of `get_wallet` as the snapshot needs. */
export interface WalletCaps {
  per_payment_cap: string;
  daily_cap: string;
  spent_today: string;
  /** The UTC day `spent_today` counts, as days since 1970. */
  day: number;
}

/**
 * The snapshot for the wallet just read, or null when there is none (no NEAR account, or
 * no wallet on it), so the app clears the one it gave before and agents can't propose
 * payments against an old account's payees and caps. What's left today counts only today's
 * spending: on a new UTC day the contract starts again from nothing.
 */
export function agentWallet(wallet: WalletCaps | null, payees: { name: string; account: string }[], nowMs: number): AgentWalletSnapshot | null {
  if (!wallet) return null;
  const today = Math.floor(nowMs / 86_400_000);
  const spent = wallet.day === today ? BigInt(wallet.spent_today) : 0n;
  const cap = BigInt(wallet.daily_cap);
  return { payees, perPaymentCap: wallet.per_payment_cap, leftToday: (cap > spent ? cap - spent : 0n).toString() };
}
