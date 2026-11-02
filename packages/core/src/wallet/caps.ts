import type { WalletLimits } from "../followups/autopilot.ts";
import { formatUsdc } from "../money.ts";

/**
 * Which caps a payment is over, as the contract checks them (lib.rs `pay`): a per-payment
 * cap of 0 means there is none, and the daily cap counts what is left of today (the UTC day).
 * Over either, a NEAR payment waits for the owner's wallet; a payment on another chain is refused.
 */
export function capsCrossed(amount: bigint, limits: WalletLimits): { perPayment: boolean; today: boolean } {
  return { perPayment: limits.perPaymentCap > 0n && amount > limits.perPaymentCap, today: amount > limits.leftToday };
}

/**
 * What to tell the person when the contract refused a payment on another chain for a cap.
 * Nothing is parked (the quote would expire), so the only ways through are a higher cap or,
 * when the amount fits the daily cap at all, the next UTC day. `reason` is the contract's:
 * OVER_PAYMENT_CAP whenever the per-payment cap is crossed, even if the daily cap is too, and
 * OVER_CAP when only the daily cap is. `leftToday` is what the contract said was left;
 * `dailyCap` is null when the wallet couldn't be read.
 */
export function crossChainCapRefusal(amount: bigint, reason: string | null, leftToday: bigint | null, dailyCap: bigint | null): string {
  const wait = "A payment on another chain can't wait for your wallet";
  const left = leftToday === null ? "" : ` (${formatUsdc(leftToday)} USDC)`;
  if (reason === "OVER_PAYMENT_CAP") {
    return leftToday !== null && amount > leftToday
      ? `Over your per-payment cap and what's left of today's cap${left}, so nothing was sent. ${wait}: raise both caps in Agent wallet, then try again.`
      : `Over your per-payment cap, so nothing was sent. ${wait}: raise it in Agent wallet, then try again.`;
  }
  if (dailyCap !== null && amount > dailyCap) {
    return `Over your daily cap of ${formatUsdc(dailyCap)} USDC, so nothing was sent. ${wait}: raise the daily cap in Agent wallet, then try again.`;
  }
  return dailyCap === null
    ? `Over what's left of today's cap${left}, so nothing was sent. ${wait}: raise the daily cap in Agent wallet, then try again.`
    : `Over what's left of today's cap${left}, so nothing was sent. ${wait}: raise the daily cap in Agent wallet, or try again after midnight UTC, when the day's spending resets.`;
}
