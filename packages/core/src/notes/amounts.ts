import { USDC_DECIMALS } from "../money.ts";

/**
 * Turns the words someone said about money into USDC base units.
 * "fifty dollar" -> 50.00, "$5,000" -> 5,000.00, "two hundred and fifty bucks" -> 250.00,
 * "1.5k" -> 1,500.00, "fifty cents" -> 0.50, "five dollars and fifty cents" -> 5.50.
 * "twelve fifty" is refused (ambiguous), and so is any other currency: "fifty thousand
 * naira" is not 50,000 USDC. Number words are read in English only: "quinientos",
 * "пятьсот" or "五百" give null. Digits 0-9 (and full-width ０-９) are read in a quote in
 * any language, with a dollar word Aftercall knows ("500 долларов", "500ドル"); other
 * digit sets such as ٥٠٠ or ५०० give no amount. Returns null when unsure: an unclear
 * amount is shown to the person, never guessed.
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
const USD = /\b(us\s+dollars?|usd\s*coin|usdc|usd|dollars?|bucks|d[óo]lar(?:es)?)\b/g;
/**
 * "Dollar" in scripts other than Latin, at the start of a word ("долларов", "ドルを").
 * "カナダドル" (Canadian dollars) doesn't start with one, so it never reads as US dollars.
 */
const DOLLAR_WORD = /^(?:доллар|долар|米ドル|ドル|美元|美金|डॉलर|डालर|دولار|달러)/u;
const DOLLAR_WORDS = /(?<![\p{L}\p{M}])(?:доллар|долар)\p{L}*|米ドル|ドル|美元|美金|डॉलर|डालर|(?<![\p{L}\p{M}])دولار\p{L}*|달러/gu;
/**
 * A word after "dollar" that makes it another country's dollar. Arabic always puts it
 * after the noun ("دولار كندي", "دولار أسترالي"), Russian and Spanish or French can
 * ("долларов канадских", "dólares canadienses", "$500 Canadian"). Any Arabic word ending
 * like a nationality (-ي, -ية) or Russian or Ukrainian adjective in -ский counts, so
 * countries not listed here still read as not US dollars.
 */
const DOLLAR_QUALIFIER =
  /^(?:ال)?\p{scx=Arabic}{3,}(?:ي|ية|يين)$|^هون[غج]|^(?:канад|австрал|гонконг|сингапур|новозеланд|тайван|ямайк|зимбабв|намиби|либери)|^\p{scx=Cyrillic}+(?:ск|ськ)(?:ий|ій|ая|а|ое|е|ие|і|их|ого|ому|им|ими|ом|ім|ої|ою|ой)$|^(?:canadi(?:an|ens?|ennes?|enses?)|australi(?:an|ens?|ennes?|anos?|anas?)|singapor(?:ean|enses?)|singapouriens?|hongkongais|hong|neozeland\p{L}*|néo|taiwan\p{L}*|jamaica\p{L}*|cad|aud|sgd|hkd|nzd|twd)$/u;
/** Qualifiers that say US dollars after all: "دولار أمريكي", "долларов США", "米ドル". */
const US_QUALIFIER = /^(?:ال)?[أا]مري[كک]ي|^американск|^сша$|^usa?$|^am[ée]ricains?$|^(?:estadounidenses?|americanos?)$/u;
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
  // Dollars of another country, with the country after the noun.
  ["Canadian dollars", /(?:دولار\p{L}*|доллар\p{L}*|долар\p{L}*|d[óo]lar(?:es)?|dollars?)\s+(?:ال)?(?:كندي|канадск|canadi)/u],
  ["Australian dollars", /(?:دولار\p{L}*|доллар\p{L}*|долар\p{L}*|d[óo]lar(?:es)?|dollars?)\s+(?:ال)?(?:[أا]سترالي|австралийск|австралійськ|australi)/u],
  // The same currencies named in other languages, so the card can say which one.
  ["euros", /ユーロ|欧元|(?<!\p{L})евро(?!\p{L})|यूरो|يورو/u],
  ["pounds", new RegExp(`${NUMBER_BEFORE}(?:libras?|livres?)\\b`)],
  ["rubles", /(?<!\p{L})рубл|\b(?:roubles?|rubles?|rublos?)\b/u],
  ["rupees", /रुप(?:य|ए)|\brupias?\b/u],
  ["yen", /\d\s*円|日元/u],
  ["yuan", /\d\s*[元块]|人民币/u],
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
    .normalize("NFKC")
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
  return parseNumber(text.replace(USD, " ").replace(DOLLAR_WORDS, " ").replace(/\s+/g, " ").trim());
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

/**
 * Quote words as amounts are read: lowercase, hyphens split, edge punctuation kept
 * aside. Digits written against letters of another script are split from them:
 * "に500ドルを" is "に", "500", "ドルを".
 */
function quoteTokens(text: string): QuoteToken[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(\d)(?=\p{L})(?!\p{scx=Latin})/gu, "$1 ")
    .replace(/(?<=\p{L})(?<!\p{scx=Latin})(?=[\d$])/gu, " ")
    .split(/[\s\-–—]+/)
    .map((raw) => ({
      w: raw.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}]+$/gu, ""),
      stop: /[.,;:!?…。、，！？；：،؛।]["”’')\]」』]*$/.test(raw),
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

/**
 * Whether the words right after an amount make it something other than US dollars.
 * A word in another script right after a bare number ("500 евро", "500ユーロ") must
 * be a dollar word Aftercall knows, since the currency can't be told otherwise. A
 * country named after the dollar word ("500 دولار كندي", "$500 Canadian") makes it
 * another country's dollar.
 */
function notDollars(tokens: QuoteToken[], start: number, end: number): boolean {
  const next = tokens[end];
  if (!next) return false;
  if (tokens[end - 1].percent || next.w === "percent" || (next.w === "per" && tokens[end + 1]?.w === "cent")) return true;
  // Words after a comma or full stop start something else.
  if (tokens[end - 1].stop) return false;
  const dollarWord = DOLLAR_WORD.test(next.w) || /^d[óo]lar(?:es)?$/.test(next.w);
  const after = dollarWord ? (next.stop ? undefined : tokens[end + 1]) : next;
  if (after && DOLLAR_QUALIFIER.test(after.w) && !US_QUALIFIER.test(after.w)) return true;
  const saysDollars = tokens.slice(start, end).some((t) => t.w.startsWith("$") || /^(?:dollars?|bucks|usdc?)$/.test(t.w));
  if (!saysDollars && /^\p{L}/u.test(next.w) && !/^\p{scx=Latin}/u.test(next.w)) return !DOLLAR_WORD.test(next.w);
  // currencyIn wants a number before ordinary words like "won" or "near".
  return currencyIn(`1 ${tokens.slice(end, end + 2).map((t) => t.w).join(" ")}`) !== null;
}

/**
 * Every US dollar amount in a transcript quote, in USDC base units: digits ("$40",
 * "5,000", "1.5k", "49.99", also in a quote in another language) and English words
 * ("forty dollars", "two hundred and fifty", "fifty cents"). Read left to right, always taking the longest span that is
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
        if (!tokens[i].foreign && !notDollars(tokens, i, j)) found.push(value);
        taken = j - i;
        break;
      }
    }
    i += taken;
  }
  return found;
}
