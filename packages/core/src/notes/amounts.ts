import { USDC_DECIMALS } from "../money.ts";

/**
 * Turns the words someone said about money into USDC base units.
 * "fifty dollar" -> 50.00, "$5,000" -> 5,000.00, "two hundred and fifty bucks" -> 250.00,
 * "1.5k" -> 1,500.00, "fifty cents" -> 0.50, "five dollars and fifty cents" -> 5.50.
 * "twelve fifty" is refused (ambiguous), and so is any other currency: "fifty thousand
 * naira" is not 50,000 USDC. Returns null when unsure: an unclear amount is shown to
 * the person, never guessed.
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
/** Words that mean US dollars or USDC; dropped before the number is read. */
const USD = /\b(us\s+dollars?|usd\s*coin|usdc|usd|dollars?|bucks)\b/g;
const USD_WORD = "(?:us\\s+)?(?:dollars?|bucks|usdc|usd)";
const FILLER = new Set(["and", "the", "deposit", "of", "about", "around", "just", "only", "full"]);

/** A number said just before a word, for currency words that are also ordinary words ("won", "near"). */
const NUMBER_BEFORE = `(?:\\d[\\d,.]*[km]?|${[...Object.keys(UNITS).filter((w) => w !== "a" && w !== "an"), ...Object.keys(TENS), "hundred", "thousand", "grand", "million"].join("|")})\\s+`;

/** Currencies that aren't US dollars, with the name the app shows. Checked before any number is read. */
const OTHER_CURRENCIES: [string, RegExp][] = [
  ["naira", /\bnaira\b|\bngn\b|₦/],
  ["euros", /\beuros?\b|\beur\b|€/],
  ["pounds", /\bpounds?\b|\bgbp\b|\bquid\b|£/],
  ["yen", /\byen\b|\bjpy\b|¥/],
  ["rupees", /\brupees?\b|\binr\b|₹/],
  ["cedis", /\bcedis?\b|\bghs\b|₵/],
  ["shillings", /\bshillings?\b|\bkes\b|\bugx\b|\btzs\b/],
  ["yuan", /\byuan\b|\brmb\b|\bcny\b|\brenminbi\b/],
  ["pesos", /\bpesos?\b|\bmxn\b/],
  ["dirhams", /\bdirhams?\b|\baed\b/],
  ["riyals", /\briyals?\b/],
  ["francs", /\bfrancs?\b|\bchf\b/],
  ["bitcoin", /\bbitcoins?\b|\bbtc\b|\bsats\b|\bsatoshis?\b/],
  ["ether", /\bether\b|\beth\b/],
  ["USDT", /\busdt\b|\btether\b/],
  ["Canadian dollars", /\bcanadian\s+dollars?\b|\bcad\b/],
  ["Australian dollars", /\baustralian\s+dollars?\b|\baud\b/],
  ["dollars that aren't US dollars", /\b(?:hong\s+kong|singapore|new\s+zealand|taiwan(?:ese)?|jamaican|zimbabwean?|namibian|liberian)\s+dollars?\b|\b(?:hkd|sgd|nzd|twd)\b/],
  // Ordinary words too ("we won", "near the end"), so only right after a number.
  ["rand", new RegExp(`${NUMBER_BEFORE}rand\\b|\\bzar\\b`)],
  ["won", new RegExp(`${NUMBER_BEFORE}won\\b|\\bkrw\\b`)],
  ["SOL", new RegExp(`${NUMBER_BEFORE}sol\\b`)],
  ["NEAR", new RegExp(`${NUMBER_BEFORE}near\\b`)],
];

/** The other currency these words name, e.g. "naira" for "fifty thousand naira"; null for dollars, USDC or none. */
export function currencyIn(words: string): string | null {
  const text = words.toLowerCase().replace(/-/g, " ");
  return OTHER_CURRENCIES.find(([, re]) => re.test(text))?.[0] ?? null;
}

function toBaseUnits(value: number): bigint | null {
  if (!Number.isFinite(value) || value <= 0 || value > 1e12) return null;
  // Round to cents first so 0.1 + 0.2 style float noise can't leak into the amount.
  const cents = Math.round(value * 100);
  if (cents === 0) return null;
  return BigInt(cents) * 10n ** BigInt(USDC_DECIMALS - 2);
}

/** Digits, with optional $, thousands commas, decimals and a k/m suffix: "$5,000", "1.5k", "250". */
function parseDigits(text: string): number | null {
  // Only a space after "$" is ignored: "40 50" is two numbers, not 4,050.
  const m = text.replace(/^\$\s+/, "$").match(/^\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(k|m)?$/i);
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
      // "forty fifty" is two numbers, not ninety: one tens word per hundred.
      if (lastWasSmall || current % 100 !== 0) return null;
      current += TENS[w];
      sawNumber = true;
      // "fifty five" is fine: allow one unit after a tens word.
      lastWasSmall = false;
    } else if (w === "hundred") {
      // "two hundred three hundred" is two numbers, not 20,300.
      if (current >= 100) return null;
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

/** A number without currency words: digits, "5 thousand" or English words. */
function parseNumber(text: string): number | null {
  const digits = parseDigits(text);
  if (digits !== null) return digits;
  // "5 thousand", "1.5 million": digits followed by a scale word.
  const mixed = text.match(/^\$?(\d+(?:\.\d+)?)\s+(hundred|thousand|grand|million)$/);
  if (mixed) return Number(mixed[1]) * SCALES[mixed[2]];
  return parseWords(text.split(/[\s,]+/).filter(Boolean));
}

/** Whole cents that fit beside a dollar figure: 1 to 99. */
function parseCents(text: string): number | null {
  const n = parseNumber(text);
  return n !== null && Number.isInteger(n) && n > 0 && n < 100 ? n : null;
}

/** Lowercase, hyphens as spaces, single spaces, no quotes or trailing punctuation. */
function clean(heard: string): string {
  return heard
    .toLowerCase()
    .replace(/^[“”"']+|[“”"'.!?]+$/g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The value in dollars, or null. Cents count only as "N cents" or "D dollars (and) N cents". */
function dollarsIn(heard: string): number | null {
  if (/^[-−]/.test(heard.trim()) || currencyIn(heard)) return null;
  const text = clean(heard);
  if (!text) return null;

  if (/\bcents?\b/.test(text)) {
    // "five dollars and fifty cents", "$5 and 50 cents"
    const both = text.match(new RegExp(`^(.+?) ${USD_WORD} (?:and )?(.+?) cents?$`)) ?? text.match(/^(\$\d+) (?:and )?(.+?) cents?$/);
    if (both) {
      const dollars = parseNumber(both[1]);
      const cents = parseCents(both[2]);
      return dollars !== null && Number.isInteger(dollars) && cents !== null ? dollars + cents / 100 : null;
    }
    // "fifty cents", "75 cents". Anything else with cents in it is unclear.
    const only = text.match(/^([^$]+?) cents?$/);
    const cents = only ? parseNumber(only[1]) : null;
    return cents !== null && Number.isInteger(cents) ? cents / 100 : null;
  }
  return parseNumber(text.replace(USD, " ").replace(/\s+/g, " ").trim());
}

export function parseAmount(heard: string): bigint | null {
  const dollars = dollarsIn(heard);
  return dollars === null ? null : toBaseUnits(dollars);
}

export type AmountProblem = { kind: "not-usdc"; currency: string } | { kind: "unclear" };

/**
 * Why `parseAmount` gives null, for the payment card: said in another currency (named,
 * e.g. "naira") or not readable as one amount. Null when the words read as a USDC amount.
 */
export function amountProblem(words: string): AmountProblem | null {
  const currency = currencyIn(words);
  if (currency) return { kind: "not-usdc", currency };
  return parseAmount(words) === null ? { kind: "unclear" } : null;
}

/** Words that may continue a spoken amount in a quote. Not "a": "fifty a month" is fifty. */
const SPAN_WORDS = new Set([...Object.keys(UNITS).filter((w) => w !== "a" && w !== "an"), ...Object.keys(TENS), "hundred", "thousand", "grand", "million", "and", "dollar", "dollars", "bucks", "usd", "usdc", "us", "cent", "cents"]);
const MAX_SPAN = 12;

/** A quote word as amounts are read, and what was around it. */
interface QuoteToken {
  /** Lowercase, edge punctuation off ("$5,000." -> "$5,000"). */
  w: string;
  /** A comma or sentence mark followed it: no amount runs past it ("fifty. Two hundred"). */
  stop: boolean;
  /** Another currency's sign was on it: "€2,500", "₦500". */
  foreign: boolean;
  /** A percent sign followed it: "50%". */
  percent: boolean;
}

/** Quote words as amounts are read: lowercase, hyphens split, edge punctuation kept aside. */
function quoteTokens(text: string): QuoteToken[] {
  return text
    .toLowerCase()
    .split(/[\s\-–—]+/)
    .map((raw) => ({
      w: raw.replace(/^[^\w$]+|[^\w]+$/g, ""),
      stop: /[.,;:!?…]["”’')\]]*$/.test(raw),
      foreign: /[₦€£¥₹₵]/.test(raw),
      percent: /%/.test(raw),
    }))
    .filter((t) => t.w);
}

const isDigits = (w: string) => /^\$?\d/.test(w);
const isBare = (w: string) => w in UNITS || /^\$?\d/.test(w);

/**
 * Two numbers said next to each other with no scale word between them: "twelve fifty",
 * "one fifty". parseAmount refuses these as ambiguous, so no part of them is an amount
 * either ("one fifty" is never fifty).
 */
function hasBarePair(words: string[]): boolean {
  return words.some((w, k) => {
    const next = words[k + 1];
    if (next === undefined) return false;
    if (isBare(w) && w !== "a" && w !== "an") return isBare(next) || next in TENS;
    return w in TENS && next in TENS;
  });
}

/** Whether the words right after an amount make it something other than US dollars. */
function notDollars(tokens: QuoteToken[], end: number): boolean {
  const next = tokens[end];
  if (!next) return false;
  if (tokens[end - 1].percent || next.w === "percent" || (next.w === "per" && tokens[end + 1]?.w === "cent")) return true;
  // Words after a comma or full stop start something else.
  if (tokens[end - 1].stop) return false;
  // currencyIn wants a number before ordinary words like "won" or "near".
  return currencyIn(`1 ${tokens.slice(end, end + 2).map((t) => t.w).join(" ")}`) !== null;
}

/**
 * Every US dollar amount in a transcript quote, in USDC base units: digits ("$40",
 * "5,000", "1.5k", "49.99") and English words ("forty dollars", "two hundred and
 * fifty", "fifty cents"). Read left to right, always taking the longest span that is
 * one amount, so "two hundred and fifty" gives 250 and never also 200 or 50. A span
 * ends at a comma or full stop; a value in another currency or a percentage isn't one;
 * and two bare numbers in a row ("one fifty") give nothing.
 */
export function amountsIn(text: string): bigint[] {
  const tokens = quoteTokens(text);
  const found: bigint[] = [];
  let i = 0;
  while (i < tokens.length) {
    const { w } = tokens[i];
    // "a hundred" starts a number; a lone "a" doesn't.
    const starts = isDigits(w) || ((w in UNITS || w in TENS) && !((w === "a" || w === "an") && !((tokens[i + 1]?.w ?? "") in SCALES)));
    if (!starts) {
      i++;
      continue;
    }
    // Digits continue a span only after "and" ("$5 and 50 cents"): "40 50" is two numbers.
    let end = i + 1;
    while (
      end < tokens.length &&
      end - i < MAX_SPAN &&
      !tokens[end - 1].stop &&
      (SPAN_WORDS.has(tokens[end].w) || (isDigits(tokens[end].w) && tokens[end - 1].w === "and"))
    )
      end++;
    const words = tokens.slice(i, end).map((t) => t.w);
    if (hasBarePair(words)) {
      i = end;
      continue;
    }
    let taken = 1;
    for (let j = end; j > i; j--) {
      const last = tokens[j - 1].w;
      if (last === "and" || last === "us") continue;
      const value = parseAmount(words.slice(0, j - i).join(" "));
      if (value !== null) {
        if (!tokens[i].foreign && !notDollars(tokens, j)) found.push(value);
        taken = j - i;
        break;
      }
    }
    i += taken;
  }
  return found;
}
