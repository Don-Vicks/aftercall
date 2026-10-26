import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type { Counters } from "../stats/counters";

export interface SendRequest {
  to: string;
  subject: string;
  text: string;
  /** The sender's own address, so replies go to them and not to Aftercall. */
  replyTo?: string;
  /** Shown as "<name> via Aftercall". */
  senderName?: string;
}

/** Sends one email. Resend in production; a fake in tests. */
export type Mailer = (mail: { from: string; to: string; subject: string; text: string; replyTo?: string }) => Promise<{ id: string }>;

export function resendMailer(apiKey: string): Mailer {
  return async (mail) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: mail.from, to: [mail.to], subject: mail.subject, text: mail.text, reply_to: mail.replyTo }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !body.id) throw new Error(body.message ?? `Resend ${res.status}`);
    return { id: body.id };
  };
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const DAILY_LIMIT = 50;

@Injectable()
export class EmailService {
  /** account -> [day, sent today]. Keeps one account from using Aftercall as a spam relay. */
  private readonly sent = new Map<string, [number, number]>();

  constructor(
    private readonly mailer: Mailer | null,
    private readonly fromAddress: string,
    private readonly now: () => number = Date.now,
    /** Running total of emails sent, for the public stats. */
    private readonly counters?: Counters,
  ) {}

  get configured(): boolean {
    return this.mailer !== null;
  }

  async send(accountId: string, req: SendRequest): Promise<{ id: string }> {
    if (!this.mailer) throw new HttpException("EMAIL_NOT_CONFIGURED", HttpStatus.SERVICE_UNAVAILABLE);
    if (!EMAIL.test(req.to) || (req.replyTo && !EMAIL.test(req.replyTo))) throw new HttpException("BAD_ADDRESS", HttpStatus.BAD_REQUEST);
    if (!req.subject?.trim() || req.subject.length > 200 || !req.text?.trim() || req.text.length > 20_000) throw new HttpException("BAD_MESSAGE", HttpStatus.BAD_REQUEST);
    if (!req.text.includes("recorded with notice to everyone")) throw new HttpException("MISSING_CONSENT_LINE", HttpStatus.BAD_REQUEST);

    const day = Math.floor(this.now() / 86_400_000);
    const [d, count] = this.sent.get(accountId) ?? [day, 0];
    const today = d === day ? count : 0;
    if (today >= DAILY_LIMIT) throw new HttpException("DAILY_LIMIT", HttpStatus.TOO_MANY_REQUESTS);

    const name = (req.senderName ?? accountId).replace(/[<>"\r\n]/g, "").slice(0, 60);
    const result = await this.mailer({ from: `${name} via Aftercall <${this.fromAddress}>`, to: req.to, subject: req.subject, text: req.text, replyTo: req.replyTo });
    this.sent.set(accountId, [day, today + 1]);
    // The email went out; a counter that can't be written must not turn that into an error.
    await this.counters?.increment("emails_sent").catch(() => {});
    return result;
  }
}
