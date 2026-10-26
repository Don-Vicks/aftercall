import { GoneException, HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";

/**
 * Claim links: a payee who isn't on the owner's list gets a single-use link to
 * share the NEAR account they want to be paid at. The link can only share an
 * account; the owner still confirms the payee in their own wallet before
 * anything is paid.
 */

export interface NewClaim {
  payeeName: string;
  /** USDC base units, as a string. */
  amount: string;
  memo?: string;
  meeting: string;
}

export interface Claim extends NewClaim {
  id: string;
  owner: string;
  createdAt: number;
  expiresAt: number;
  status: "open" | "claimed" | "cancelled";
  claimedAccount?: string;
  claimedAt?: number;
}

const TTL_MS = 7 * 86_400_000;
const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const MAX_OPEN_PER_OWNER = 50;

@Injectable()
export class ClaimsService {
  /** token (the secret in the payee's link) -> claim */
  private readonly byToken = new Map<string, Claim>();

  constructor(private readonly now: () => number = Date.now) {}

  create(owner: string, c: NewClaim): { claim: Claim; token: string } {
    if (!c.payeeName?.trim() || c.payeeName.length > 80 || !/^\d{1,30}$/.test(c.amount) || !c.meeting || c.meeting.length > 120 || (c.memo?.length ?? 0) > 200) {
      throw new HttpException("BAD_CLAIM", HttpStatus.BAD_REQUEST);
    }
    const open = [...this.byToken.values()].filter((x) => x.owner === owner && x.status === "open" && x.expiresAt > this.now()).length;
    if (open >= MAX_OPEN_PER_OWNER) throw new HttpException("TOO_MANY_OPEN_CLAIMS", HttpStatus.TOO_MANY_REQUESTS);
    const token = randomBytes(24).toString("base64url");
    const claim: Claim = {
      id: randomBytes(8).toString("hex"),
      owner,
      payeeName: c.payeeName.trim(),
      amount: c.amount,
      memo: c.memo,
      meeting: c.meeting,
      createdAt: this.now(),
      expiresAt: this.now() + TTL_MS,
      status: "open",
    };
    this.byToken.set(token, claim);
    return { claim, token };
  }

  private live(token: string): Claim {
    const claim = this.byToken.get(token);
    if (!claim || claim.status === "cancelled") throw new NotFoundException("NO_SUCH_CLAIM");
    if (claim.expiresAt < this.now()) throw new GoneException("CLAIM_EXPIRED");
    return claim;
  }

  /** What the payee sees: who wants to pay them, how much, and for what. */
  view(token: string) {
    const c = this.live(token);
    return { owner: c.owner, payeeName: c.payeeName, amount: c.amount, memo: c.memo, meeting: c.meeting, status: c.status, expiresAt: c.expiresAt };
  }

  /** The payee shares their account. Works once. */
  claim(token: string, account: string): void {
    const c = this.live(token);
    if (c.status !== "open") throw new GoneException("ALREADY_CLAIMED");
    const a = account?.trim().toLowerCase();
    if (!ACCOUNT.test(a ?? "")) throw new HttpException("BAD_ACCOUNT", HttpStatus.BAD_REQUEST);
    c.status = "claimed";
    c.claimedAccount = a;
    c.claimedAt = this.now();
  }

  mine(owner: string): Claim[] {
    return [...this.byToken.values()].filter((c) => c.owner === owner).sort((a, b) => b.createdAt - a.createdAt);
  }

  cancel(owner: string, id: string): void {
    const c = [...this.byToken.values()].find((x) => x.id === id && x.owner === owner);
    if (!c) throw new NotFoundException("NO_SUCH_CLAIM");
    c.status = "cancelled";
  }
}
