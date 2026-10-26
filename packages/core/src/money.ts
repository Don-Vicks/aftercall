/** Circle USDC on NEAR uses 6 decimals. Amounts move through the app as integer base units. */
export const USDC_DECIMALS = 6;

/** Formats base units as a fixed two-decimal USDC figure, e.g. 5000000000n -> "5,000.00". */
export function formatUsdc(baseUnits: bigint): string {
  const negative = baseUnits < 0n;
  const abs = negative ? -baseUnits : baseUnits;
  const scale = 10n ** BigInt(USDC_DECIMALS);
  const whole = abs / scale;
  const cents = (abs % scale) / 10n ** BigInt(USDC_DECIMALS - 2);
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${wholeText}.${cents.toString().padStart(2, "0")}`;
}
