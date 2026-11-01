import { formatCost, sumCosts, type CostEstimate } from "@aftercall/core";

/**
 * Estimated NEAR AI costs as the app words them. They come from the token counts
 * NEAR AI reports and its public price list (packages/core cost.ts), never from a bill.
 */

/** "1 Nov 2026" for the price list's date ("2026-11-01"). */
export function pricesDay(asOf: string): string {
  const d = new Date(`${asOf}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? asOf : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "About $0.0042", or null when NEAR AI didn't report the tokens. */
export function aboutCost(cost: CostEstimate): string | null {
  if (cost.usd === null) return null;
  const text = formatCost(cost.usd);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What this Mac's saved meetings probably cost to process, and how many it counted. */
export interface Spend {
  /** Sum of the meetings whose tokens NEAR AI reported. */
  cost: CostEstimate;
  meetings: number;
  /** Meetings whose cost is on record as unknown (NEAR AI didn't report the tokens). */
  unknown: number;
}

/**
 * Sums the saved meetings' costs. Notes made before costs were kept have none and are
 * left out; null when no meeting has one.
 */
export function spendOf(costs: (CostEstimate | undefined)[]): Spend | null {
  const kept = costs.filter((c): c is CostEstimate => !!c);
  const known = kept.filter((c) => c.usd !== null);
  if (kept.length === 0) return null;
  return { cost: sumCosts(known), meetings: known.length, unknown: kept.length - known.length };
}
