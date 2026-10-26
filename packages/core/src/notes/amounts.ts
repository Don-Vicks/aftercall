import { USDC_DECIMALS } from "../money.ts";

/**
 * Turns the words someone said about money into USDC base units.
 * "fifty dollar" -> 50.00, "$5,000" -> 5,000.00, "two hundred and fifty bucks" -> 250.00,
 * "1.5k" -> 1,500.00, "twelve fifty" is refused (ambiguous). Returns null when unsure:
 * an unclear amount is shown to the person, never guessed.
 */

const UNITS: Record<string, number> = {
  zero: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1_000, k: 1_000, grand: 1_000, million: 1_000_000, m: 1_000_000 };
const CURRENCY = /\b(usd|usdc|dollars?|bucks|naira|cents?)\b/g;
const FILLER = new Set(["and", "the", "deposit", "of", "about", "around", "just", "only", "full"]);

function toBaseUnits(value: number): bigint | null {
  if (!Number.isFinite(value) || value <= 0 || value > 1e12) return null;
  // Round to cents first so 0.1 + 0.2 style float noise can't leak into the amount.
  const cents = Math.round(value * 100);
  return BigInt(cents) * 10n ** BigInt(USDC_DECIMALS - 2);
}

/** Digits, with optional $, thousands commas, decimals and a k/m suffix: "$5,000", "1.5k", "250". */
function parseDigits(text: string): number | null {
  const m = text.replace(/\s+/g, "").match(/^\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(k|m)?$/i);
  if (!m) return null;
  const whole = Number(m[1].replace(/,/g, ""));
  const frac = m[2] ? Number(`0.${m[2]}`) : 0;
  const scale = m[3] ? SCALES[m[3].toLowerCase()] : 1;
  return (whole + frac) * scale;
}

/** English number words: "two hundred and fifty", "five thousand", "fifty". */
function parseWords(words: string[]): number | null {
  let total = 0;
  let current = 0;
  let sawNumber = false;
  let lastWasSmall = false; // guards against "twelve fifty" (two bare numbers in a row)
  for (const w of words) {
    if (FILLER.has(w)) continue;
    const digit = /^\d+(\.\d+)?$/.test(w) ? Number(w) : null;
    if (w in UNITS || digit !== null) {
      if (lastWasSmall) return null;
      current += digit ?? UNITS[w];
      sawNumber = true;
      lastWasSmall = true;
    } else if (w in TENS) {
      if (lastWasSmall) return null;
      current += TENS[w];
      sawNumber = true;
      // "fifty five" is fine: allow one unit after a tens word.
      lastWasSmall = false;
    } else if (w === "hundred") {
      current = (current || 1) * 100;
      lastWasSmall = false;
    } else if (w in SCALES) {
      total += (current || 1) * SCALES[w];
      current = 0;
      lastWasSmall = false;
    } else {
      return null;
    }
  }
  return sawNumber ? total + current : null;
}

export function parseAmount(heard: string): bigint | null {
  const text = heard
    .toLowerCase()
    .replace(CURRENCY, " ")
    .replace(/[“”"'.!?]+$/g, "")
    .replace(/-/g, " ")
    .trim();
  if (!text || /^[-−]/.test(heard.trim())) return null;

  const digits = parseDigits(text);
  if (digits !== null) return toBaseUnits(digits);

  // "5 thousand", "1.5 million": digits followed by a scale word.
  const mixed = text.match(/^\$?(\d+(?:\.\d+)?)\s+(hundred|thousand|grand|million)$/);
  if (mixed) return toBaseUnits(Number(mixed[1]) * SCALES[mixed[2]]);

  const words = text.split(/[\s,]+/).filter(Boolean);
  const value = parseWords(words);
  return value === null ? null : toBaseUnits(value);
}
