import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type { Counters } from "../stats/counters";
import { MemoryDailyCounts, limitKey, utcDay, type DailyCounts } from "../limits";

/*
 * Recap email: NOTHING IS KEPT.
 *
 * The recap (recipient, subject, body, reply-to) exists on this server only in
 * memory, for the length of one request: it is checked, handed to Resend and
 * dropped when the request returns. It is never written to the database, never
 * logged and never put in an error message. What stays is two numbers: how many
 * recaps this account sent today (under a hashed key, for the 50-a-day limit;
 * see limits.ts) and the global "emails_sent" counter for /stats. Resend, which delivers the email,
 * keeps sent mail under its own retention policy; see docs/privacy.md.
 * email.test.ts checks all of this with a spy Resend client, a spy database and
 * captured logs.
 */

/** One recap, held in memory for a single request and then dropped. */
export interface TransientRecap {
  to: string;
  subject: string;
  text: string;
  /** The same recap laid out in HTML (core's buildRecap), sent alongside the text. Optional. */
  html?: string;
  /** The sender's own address, so replies go to them and not to Aftercall. */
  replyTo?: string;
  /** Shown as "<name> via Aftercall". */
  senderName?: string;
}

/** Sends one email. Resend in production; a fake in tests. */
export type Mailer = (mail: { from: string; to: string; subject: string; text: string; html?: string; replyTo?: string }) => Promise<{ id: string }>;

export function resendMailer(apiKey: string, fetchImpl: typeof fetch = fetch): Mailer {
  return async (mail) => {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: mail.from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html, reply_to: mail.replyTo }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string };
    // Resend's error message can quote the address; only its status and error name go further.
    if (!res.ok || !body.id) throw new Error(`Resend ${res.status}${body.name ? ` ${body.name}` : ""}`);
    return { id: body.id };
  };
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
/**
 * Every recap the app builds ends with a footer holding this line. Mirrors
 * RECAP_FOOTER_MARK in packages/core/src/followups/recap.ts (the backend builds to
 * CommonJS and can't import core's sources); email.test.ts checks the two match.
 */
export const RECAP_FOOTER_MARK = "What was and wasn't checked:";
const DAILY_LIMIT = 50;

@Injectable()
export class EmailService {
  constructor(
    private readonly mailer: Mailer | null,
    private readonly fromAddress: string,
    private readonly now: () => number = Date.now,
    /** Running total of emails sent, for the public stats. */
    private readonly counters?: Counters,
    /** Recaps each account sent today. Only a count under a hashed key: no addresses, subjects or bodies. */
    private readonly sentToday: DailyCounts = new MemoryDailyCounts(),
  ) {}

  get configured(): boolean {
    return this.mailer !== null;
  }

  /** Checks one recap and hands it to Resend. The recap is not stored anywhere; it goes out of scope on return. */
  async send(accountId: string, req: TransientRecap): Promise<{ id: string }> {
    if (!this.mailer) throw new HttpException("EMAIL_NOT_CONFIGURED", HttpStatus.SERVICE_UNAVAILABLE);
    if (!EMAIL.test(req.to) || (req.replyTo && !EMAIL.test(req.replyTo))) throw new HttpException("BAD_ADDRESS", HttpStatus.BAD_REQUEST);
    if (!req.subject?.trim() || req.subject.length > 200 || !req.text?.trim() || req.text.length > 20_000) throw new HttpException("BAD_MESSAGE", HttpStatus.BAD_REQUEST);
    if (!req.text.includes(RECAP_FOOTER_MARK)) throw new HttpException("MISSING_FOOTER", HttpStatus.BAD_REQUEST);
    if (req.html !== undefined) {
      // The HTML version carries the same footer, and no script, frame or form: it's a recap, not a page.
      if (typeof req.html !== "string" || req.html.length > 60_000 || /<\s*(script|iframe|object|embed|form)\b|javascript:|\son\w+\s*=/i.test(req.html)) throw new HttpException("BAD_MESSAGE", HttpStatus.BAD_REQUEST);
      if (!req.html.includes(RECAP_FOOTER_MARK)) throw new HttpException("MISSING_FOOTER", HttpStatus.BAD_REQUEST);
    }

    const day = utcDay(this.now());
    const key = limitKey("recap", accountId);
    if ((await this.sentToday.get(key, day)) >= DAILY_LIMIT) throw new HttpException("DAILY_LIMIT", HttpStatus.TOO_MANY_REQUESTS);

    const name = (req.senderName ?? accountId).replace(/[<>"\r\n]/g, "").slice(0, 60);
    let result: { id: string };
    try {
      result = await this.mailer({ from: `${name} via Aftercall <${this.fromAddress}>`, to: req.to, subject: req.subject, text: req.text, ...(req.html ? { html: req.html } : {}), replyTo: req.replyTo });
    } catch (e) {
      // A plain code back to the app, and nothing logged: the underlying error could carry the address.
      const status = e instanceof Error ? (/^Resend \d+/.exec(e.message)?.[0] ?? "") : "";
      throw new HttpException(status ? `SEND_FAILED (${status})` : "SEND_FAILED", HttpStatus.BAD_GATEWAY);
    }
    // The email went out; a counter that can't be written must not turn that into an error.
    await this.sentToday.increment(key, day).catch(() => {});
    await this.counters?.increment("emails_sent").catch(() => {});
    return result;
  }
}
