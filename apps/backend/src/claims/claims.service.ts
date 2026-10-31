import { GoneException, HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { hashToken, MemoryClaimsStore, type ClaimsStore } from "./claims.store";

/**
 * Claim links: a payee who isn't on the owner's list gets a single-use link to
 * share the NEAR account they want to be paid at. The link can only share an
 * account; the owner still confirms the payee in their own wallet before
 * anything is paid.
 *
 * Kept server-side: only what the link needs to work once. A hash of the token,
 * the owner, the amount, the expiry, the status and the account the payee shared.
 * The payee's name, the memo and the meeting title never reach this server: the
 * app puts them in the link's #fragment, which browsers don't send, and the claim
 * page reads them from there (apps/web/app/claim/ClaimClient.tsx).
 */

export interface NewClaim {
  /** USDC base units, as a string. */
  amount: string;
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
  constructor(
    private readonly store: ClaimsStore = new MemoryClaimsStore(),
    private readonly now: () => number = Date.now,
  ) {}

  /** How many claim links exist and how many were answered, across everyone. */
  totals(): Promise<{ created: number; claimed: number }> {
    return this.store.totals();
  }

  /** Anything else in the request (an older app sending a name or memo) is ignored, never stored. */
  async create(owner: string, c: NewClaim): Promise<{ claim: Claim; token: string }> {
    if (!/^\d{1,30}$/.test(c?.amount ?? "") || /^0+$/.test(c.amount)) throw new HttpException("BAD_CLAIM", HttpStatus.BAD_REQUEST);
    if ((await this.store.countOpen(owner, this.now())) >= MAX_OPEN_PER_OWNER) throw new HttpException("TOO_MANY_OPEN_CLAIMS", HttpStatus.TOO_MANY_REQUESTS);
    const token = randomBytes(24).toString("base64url");
    const claim: Claim = {
      id: randomBytes(8).toString("hex"),
      owner,
      amount: c.amount,
      createdAt: this.now(),
      expiresAt: this.now() + TTL_MS,
      status: "open",
    };
    await this.store.insert(hashToken(token), claim);
    return { claim, token };
  }

  private async live(token: string): Promise<Claim> {
    const claim = await this.store.byTokenHash(hashToken(token ?? ""));
    if (!claim || claim.status === "cancelled") throw new NotFoundException("NO_SUCH_CLAIM");
    if (claim.expiresAt < this.now()) throw new GoneException("CLAIM_EXPIRED");
    return claim;
  }

  /** What the payee sees from the server: who wants to pay them and how much. The "for what" is in their link. */
  async view(token: string) {
    const c = await this.live(token);
    return { owner: c.owner, amount: c.amount, status: c.status, expiresAt: c.expiresAt };
  }

  /** The payee shares their account. Works once. */
  async claim(token: string, account: string): Promise<void> {
    const c = await this.live(token);
    if (c.status !== "open") throw new GoneException("ALREADY_CLAIMED");
    const a = account?.trim().toLowerCase();
    if (!ACCOUNT.test(a ?? "")) throw new HttpException("BAD_ACCOUNT", HttpStatus.BAD_REQUEST);
    if (!(await this.store.markClaimed(c.id, a, this.now()))) throw new GoneException("ALREADY_CLAIMED");
  }

  mine(owner: string): Promise<Claim[]> {
    return this.store.byOwner(owner);
  }

  async cancel(owner: string, id: string): Promise<void> {
    if (!(await this.store.cancel(owner, id))) throw new NotFoundException("NO_SUCH_CLAIM");
  }
}
