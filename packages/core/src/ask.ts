import { z } from "zod";
import type { Meeting, Speaker } from "./meeting.ts";
import { formatClock } from "./meeting.ts";
import { SUMMARY_MODEL, e2eeNode, fetchSignature, type NearAiTransport } from "./notes/pipeline.ts";
import { findQuote, normalize } from "./notes/transcript.ts";
import { buildPeople, otherSideName } from "./people-index.ts";
import { search } from "./search/search.ts";
import { attestModel, failedLabels, gatewayChecks, loadNvidiaKeys, modelChecks } from "./tee/attest.ts";
import { responseChecks, short, type TeeCheck } from "./tee/checks.ts";
import { decryptWith, encryptMessages, newClientKeys } from "./tee/e2ee.ts";
import { longDate, meetingLabel, meetingTime, startOfDay, startOfWeek } from "./when.ts";

/**
 * "Ask your meetings": the question is searched on this Mac, and only the few
 * transcript lines that match leave it, end-to-end encrypted to the Qwen TEE whose
 * attestation was just checked. The answer must quote those lines; a quote that
 * isn't in them is dropped, and an answer left with no quote isn't shown.
 */

/** At most this many excerpts go to NEAR AI for one question… */
export const ASK_MAX_EXCERPTS = 8;
/** …and each is at most this many characters, cut around the words that matched. */
export const ASK_MAX_CHARS = 400;
/** Longer questions are cut. */
export const ASK_MAX_QUESTION = 500;

export interface Excerpt {
  /** 1-based; the number the model cites. */
  n: number;
  meetingId: string;
  meeting: string;
  project: string;
  /** The meeting's start as the app shows it ("Today 14:02"). */
  when: string;
  /** Seconds into the recording. */
  at: number;
  speaker: Speaker;
  /** "You", the one person your calendar invited, or "Others". */
  who: string;
  /** The words exactly as sent (cut with "…" when long). */
  text: string;
}

export interface Picked {
  excerpts: Excerpt[];
  /** How many meetings they come from. */
  meetings: number;
}

const STOP = new Set(
  "a all an and are about after any anything at be been before but by call calls can could did discuss discussed do does done every for from get got had has have how i i'd i'll i'm if in into is it it's its just know let me meeting meetings mention mentioned my of on or our out over say said says should so something talk talked tell than that the their them then there these they thing things this those to up us was we were what when where which who whom why will with would you your yours".split(
    " ",
  ),
);
const TIME_WORDS = new Set(["today", "yesterday", "week", "month", "last", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]);
const PAY_WORDS = /\b(pay|paid|payment|payments|paying|usdc|dollars?|money|deposit|invoice)\b/;
const PROMISE_WORDS = /\b(promise[sd]?|owe[sd]?|commit(ted|ments?)?|agree[sd]?|todo|to do|tasks?|action items?)\b/;
const COMMITMENT = /\b(i'll|i will|we'll|we will|i can|let me|i'm going to|we're going to)\b/i;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** The words to look for: the question without filler, time words and punctuation. */
export function questionTerms(question: string): string[] {
  const out: string[] = [];
  for (const w of normalize(question).split(" ")) {
    const t = w.replace(/'s$/, "").replace(/^'+|'+$/g, "");
    if (t.length < 3 || STOP.has(t) || TIME_WORDS.has(t) || out.includes(t)) continue;
    out.push(t);
  }
  return out;
}

/** The time a question asks about, if it names one: today, yesterday, this or last week, a month. */
export function questionRange(question: string, now: number): { from: number; to: number } | null {
  const q = normalize(question);
  const day = 86_400_000;
  const today = startOfDay(now);
  if (/\btoday\b/.test(q)) return { from: today, to: today + day };
  if (/\byesterday\b/.test(q)) return { from: today - day, to: today };
  if (/\blast week\b/.test(q)) return { from: startOfWeek(now) - 7 * day, to: startOfWeek(now) };
  if (/\bthis week\b/.test(q)) return { from: startOfWeek(now), to: today + day };
  const month = MONTHS.findIndex((m) => new RegExp(`\\b(in|during|for|of|from) ${m}\\b`).test(q) || new RegExp(`^${m}\\b`).test(q));
  if (month >= 0) {
    const d = new Date(now);
    const year = month > d.getMonth() ? d.getFullYear() - 1 : d.getFullYear();
    return { from: new Date(year, month, 1).getTime(), to: new Date(year, month + 1, 1).getTime() };
  }
  return null;
}

/** At most `max` characters of `text`, around the first term found, cut at word edges. */
function cut(text: string, terms: string[], max: number): string {
  if (text.length <= max) return text;
  const lower = text.toLowerCase();
  const hit =
    terms
      .map((t) => lower.indexOf(t))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0] ?? 0;
  let from = Math.max(0, Math.min(hit - Math.floor(max / 3), text.length - max));
  let to = Math.min(text.length, from + max);
  if (from > 0) from = text.indexOf(" ", from) + 1 || from;
  if (to < text.length) to = text.lastIndexOf(" ", to) > from ? text.lastIndexOf(" ", to) : to;
  return `${from > 0 ? "… " : ""}${text.slice(from, to).trim()}${to < text.length ? " …" : ""}`;
}

/**
 * The transcript lines that bear on a question, found with the on-device search:
 * lines that contain its words, lines spoken by a person it names (only in calls
 * where the calendar invited just that person), payment quotes for questions about
 * money and "I'll…" lines for questions about promises, in the meetings that matched.
 * Capped at ASK_MAX_EXCERPTS lines of ASK_MAX_CHARS characters.
 */
export function pickExcerpts(meetings: Meeting[], question: string, opts: { me?: readonly string[]; now?: number; max?: number; maxChars?: number } = {}): Picked {
  const now = opts.now ?? Date.now();
  const max = opts.max ?? ASK_MAX_EXCERPTS;
  const maxChars = opts.maxChars ?? ASK_MAX_CHARS;
  const range = questionRange(question, now);
  const inRange = range
    ? meetings.filter((m) => {
        const t = meetingTime(m, now);
        return t !== null && t >= range.from && t < range.to;
      })
    : meetings;
  const terms = questionTerms(question);
  const q = normalize(question);
  const aboutPay = PAY_WORDS.test(q);
  const aboutPromises = PROMISE_WORDS.test(q);
  if (terms.length === 0 && !range) return { excerpts: [], meetings: 0 };

  const people = buildPeople(inRange, { me: opts.me, now });
  const key = (meetingId: string, at: number, speaker: Speaker) => `${meetingId}@${at}@${speaker}`;
  const score = new Map<string, number>();
  const add = (k: string, n: number) => score.set(k, (score.get(k) ?? 0) + n);
  const matchedMeetings = new Set<string>();

  // Words from the question, found by the same search as ⌘K.
  for (const term of terms) {
    const r = search(inRange, term);
    for (const h of r.transcript) {
      if (h.kind !== "transcript") continue;
      add(key(h.meetingId, h.at, h.speaker), 2);
      matchedMeetings.add(h.meetingId);
    }
    for (const h of [...r.decisions, ...r.actions]) matchedMeetings.add(h.meetingId);
    for (const m of inRange) if (normalize(m.title).includes(term)) matchedMeetings.add(m.id);
  }

  for (const m of inRange) {
    const other = otherSideName(people, m.id);
    const named = other ? normalize(other).split(" ") : [];
    const speakerNamed = named.length > 0 && terms.some((t) => named.includes(t));
    if (speakerNamed) matchedMeetings.add(m.id);
    // A question about a time ("this week") with no other words takes every line then.
    const everything = terms.length === 0;
    const payQuotes = new Set(m.followUps.filter((f) => f.kind === "payment" && f.status !== "dismissed").map((f) => f.evidence.at));
    for (const l of m.transcript) {
      const k = key(m.id, l.at, l.speaker);
      if (speakerNamed && l.speaker === "others") add(k, 1);
      if (aboutPay && payQuotes.has(l.at)) add(k, 2);
      if (aboutPromises && matchedMeetings.has(m.id) && COMMITMENT.test(l.text)) add(k, 1);
      if (everything) add(k, 1);
    }
  }

  const lines = inRange.flatMap((m) => m.transcript.map((l) => ({ m, l, s: score.get(key(m.id, l.at, l.speaker)) ?? 0 })));
  const order = new Map(inRange.map((m, i) => [m.id, meetingTime(m, now) ?? -i]));
  const top = lines
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (order.get(b.m.id) ?? 0) - (order.get(a.m.id) ?? 0) || a.l.at - b.l.at)
    .slice(0, max)
    // Sent in reading order: newest meeting first, then by time in the call.
    .sort((a, b) => (order.get(b.m.id) ?? 0) - (order.get(a.m.id) ?? 0) || a.l.at - b.l.at);

  const excerpts = top.map(({ m, l }, i) => ({
    n: i + 1,
    meetingId: m.id,
    meeting: m.title,
    project: m.project,
    when: meetingLabel(m, now),
    at: l.at,
    speaker: l.speaker,
    who: l.speaker === "you" ? "You" : (otherSideName(people, m.id) ?? "Others"),
    text: cut(l.text, terms, maxChars),
  }));
  return { excerpts, meetings: new Set(excerpts.map((e) => e.meetingId)).size };
}

export const ASK_SYSTEM_PROMPT = [
  "You answer a question about YOU's meetings using only the numbered excerpts given. Each excerpt is words someone said in a meeting.",
  "Write the answer in one to three plain sentences, without markdown. Refer to people by name or as they/them.",
  "Back the answer with quotes: each quote names its excerpt number and copies at least four words exactly from that excerpt.",
  "If the excerpts don't answer the question, set found to false, say so in one sentence and give no quotes.",
  "Never invent people, amounts, dates or promises.",
].join(" ");

const askSchema = z.object({
  found: z.boolean(),
  answer: z.string(),
  quotes: z.array(z.object({ excerpt: z.number().int(), quote: z.string() })),
});

export const askJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["found", "answer", "quotes"],
  properties: {
    found: { type: "boolean" },
    answer: { type: "string" },
    quotes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["excerpt", "quote"],
        properties: { excerpt: { type: "integer" }, quote: { type: "string" } },
      },
    },
  },
} as const;

/** The exact request messages for a question and its excerpts (before encryption). */
export function askMessages(question: string, excerpts: Excerpt[], now = Date.now()): { role: "system" | "user"; content: string }[] {
  const lines = excerpts.map((e) => `[${e.n}] ${e.meeting} · ${e.when} · ${formatClock(e.at)} · ${e.who}: ${e.text}`);
  return [
    { role: "system", content: ASK_SYSTEM_PROMPT },
    { role: "user", content: `Today is ${longDate(now)}.\nQuestion: ${question.trim().slice(0, ASK_MAX_QUESTION)}\n\nExcerpts:\n${lines.join("\n")}` },
  ];
}

export interface AskQuote extends Excerpt {
  /** The quoted words exactly as they are in the excerpt. */
  quote: string;
}

export interface AskAnswer {
  found: boolean;
  /** Null when the model claimed to answer but none of its quotes are in the excerpts. */
  answer: string | null;
  quotes: AskQuote[];
  /** Quotes the model gave that aren't in the excerpts it cites. */
  dropped: number;
  /** Excerpts sent (encrypted) to NEAR AI. Zero means nothing left the Mac. */
  sent: number;
}

export interface AskResult extends AskAnswer {
  /** Gateway and model TEE attested, request end-to-end encrypted to that TEE, and the reply signed by it. */
  verified: boolean;
  checks: TeeCheck[];
  /** The attested Ed25519 key the excerpts were encrypted to. */
  modelKey: string;
}

export type AskStage = "attest" | "send" | "signature";

/** Keeps only quotes found word for word in the excerpt they cite. */
export function checkAnswer(raw: z.infer<typeof askSchema>, excerpts: Excerpt[]): AskAnswer {
  const quotes: AskQuote[] = [];
  let dropped = 0;
  for (const q of raw.quotes) {
    const e = excerpts.find((x) => x.n === q.excerpt);
    const found = e ? findQuote([{ at: e.at, speaker: e.speaker, text: e.text }], q.quote.replace(/^[“"']+|[”"']+$/g, "")) : null;
    if (!e || !found) {
      dropped++;
      continue;
    }
    if (!quotes.some((x) => x.n === e.n && normalize(x.quote) === normalize(found.text))) quotes.push({ ...e, quote: found.text });
  }
  const answer = raw.answer.trim();
  // A claimed answer with nothing behind it isn't shown; "your meetings don't say" needs no quote.
  const shown = raw.found ? (quotes.length > 0 ? answer : null) : answer || null;
  return { found: raw.found && quotes.length > 0, answer: shown, quotes: raw.found ? quotes : [], dropped, sent: excerpts.length };
}

interface Completion {
  id: string;
  choices?: { message?: { content?: string } }[];
}

/**
 * Asks the attested Qwen TEE about the excerpts, end-to-end encrypted. Order: verify
 * the gateway and the model TEEs with a fresh nonce (Intel TDX and NVIDIA), and stop
 * there, sending nothing, unless the gateway passed and a verified model TEE offers an
 * attested Ed25519 key; encrypt the question and excerpts to that key; decrypt the
 * reply with a key made for this request; keep only quotes found in the excerpts
 * (`onAnswer` gets this as soon as it's ready); then check the reply's signature.
 * There is no fallback to an unencrypted request. With no excerpts, nothing is sent.
 */
export async function askMeetings(
  t: NearAiTransport,
  input: { question: string; excerpts: Excerpt[]; now?: number },
  hooks: { onStage?: (stage: AskStage) => void; onAnswer?: (answer: AskAnswer) => void } = {},
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<AskResult> {
  const { question, excerpts } = input;
  if (!question.trim()) throw new Error("Ask a question first.");
  if (excerpts.length === 0) return { found: false, answer: null, quotes: [], dropped: 0, sent: 0, verified: false, checks: [], modelKey: "" };
  if (excerpts.length > ASK_MAX_EXCERPTS || excerpts.some((e) => e.text.length > ASK_MAX_CHARS + 4)) throw new Error("Too many excerpts for one question. Nothing was sent.");

  hooks.onStage?.("attest");
  const jwks = await loadNvidiaKeys(t);
  const att = await attestModel(t, SUMMARY_MODEL, "ed25519", { withGateway: true, jwks });
  const gateway = gatewayChecks(att);
  if (!gateway.every((c) => c.ok)) throw new Error(`Secure hardware check failed for the NEAR AI gateway (${failedLabels(gateway)}). Nothing was sent.`);
  const node = e2eeNode(att);
  if (!node) throw new Error(`No Qwen TEE passed its secure hardware check with a key to encrypt to (${failedLabels(modelChecks(att)) || "no attested Ed25519 key"}). Nothing was sent.`);

  hooks.onStage?.("send");
  const client = newClientKeys();
  const modelKey = node.evidence.signingAddress;
  const request = JSON.stringify({
    model: SUMMARY_MODEL,
    stream: false,
    messages: encryptMessages(askMessages(question, excerpts, input.now), modelKey),
    response_format: { type: "json_schema", json_schema: { name: "meeting_answer", strict: true, schema: askJsonSchema } },
  });
  let response: string;
  try {
    response = await t.chat(request, { clientPubKey: client.publicKey, modelPubKey: modelKey });
  } catch (e) {
    const status = /NEAR AI (4\d\d)/.exec(e instanceof Error ? e.message : String(e))?.[1];
    if (status && !["401", "402", "403", "429"].includes(status)) throw new Error(`NEAR AI refused the encrypted request (${status}), so nothing else was sent.`);
    throw e;
  }
  const completion = JSON.parse(response) as Completion;
  let content: string;
  try {
    content = decryptWith(completion.choices?.[0]?.message?.content ?? "", client.x25519Secret);
  } catch {
    throw new Error("The answer didn't come back encrypted to this Mac, so it isn't shown.");
  }
  const raw = askSchema.parse(JSON.parse(content.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, "")));
  const answer = checkAnswer(raw, excerpts);
  hooks.onAnswer?.(answer);

  hooks.onStage?.("signature");
  let signed: TeeCheck[];
  try {
    const sig = await fetchSignature(t, completion.id, SUMMARY_MODEL, wait);
    // Only the TEE the excerpts were encrypted to may have signed the answer.
    signed = responseChecks({ sig, algo: "ed25519", requestBody: request, responseBody: response, model: SUMMARY_MODEL, modelSigners: [modelKey], gatewaySigners: [] }).checks;
  } catch (e) {
    signed = [{ id: "response-signature", scope: "response", label: "Answer signed by the attested model", ok: false, detail: `No signature: ${e instanceof Error ? e.message : String(e)}` }];
  }
  const e2ee: TeeCheck = {
    id: "response-e2ee",
    scope: "response",
    label: "Excerpts encrypted to the attested model",
    ok: true,
    detail: `Encrypted on this Mac to Ed25519 key ${short(modelKey)}, bound in a verified quote; the answer came back encrypted to a key made for this question`,
  };
  const checks = [...gateway, ...node.checks, ...signed, e2ee];
  return { ...answer, verified: checks.every((c) => c.ok), checks, modelKey };
}
