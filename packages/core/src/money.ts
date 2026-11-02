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

/** 1 NEAR in yoctoNEAR. */
export const YOCTO_PER_NEAR = 10n ** 24n;

/**
 * yoctoNEAR as NEAR with up to `digits` decimals, trailing zeros dropped: 10n ** 25n -> "10",
 * a fee of 542800000000000000000n -> "0.00054". Anything above 0 that rounds to 0 reads "< 0.00001".
 */
export function formatNear(yocto: bigint, digits = 5): string {
  const scale = 10n ** BigInt(24 - digits);
  const units = (yocto + scale / 2n) / scale;
  if (units === 0n && yocto > 0n) return `< 0.${"0".repeat(digits - 1)}1`;
  const whole = (units / 10n ** BigInt(digits)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (units % 10n ** BigInt(digits)).toString().padStart(digits, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
