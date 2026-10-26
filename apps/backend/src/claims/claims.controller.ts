import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Post } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { sessionAccount } from "../session";
import { ClaimsService, type NewClaim } from "./claims.service";

@Controller("claims")
export class ClaimsController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ClaimsService) private readonly claims: ClaimsService,
  ) {}

  /** The owner creates a link for a payee. Returns the secret token for the payee's link. */
  @Post()
  async create(@Headers("authorization") authorization: string | undefined, @Body() body: NewClaim) {
    const owner = await sessionAccount(this.auth, authorization);
    const { claim, token } = this.claims.create(owner, body);
    return { id: claim.id, token, expiresAt: claim.expiresAt };
  }

  /** The owner's claims, with any accounts payees have shared. */
  @Get()
  async mine(@Headers("authorization") authorization: string | undefined) {
    return this.claims.mine(await sessionAccount(this.auth, authorization));
  }

  @Delete(":id")
  async cancel(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    this.claims.cancel(await sessionAccount(this.auth, authorization), id);
    return { ok: true };
  }

  /** Public: what the payee sees on the claim page. */
  @Get("link/:token")
  view(@Param("token") token: string) {
    return this.claims.view(token);
  }

  /** Public: the payee shares where to be paid. */
  @Post("link/:token")
  @HttpCode(200)
  claim(@Param("token") token: string, @Body() body: { account: string }) {
    this.claims.claim(token, body?.account);
    return { ok: true };
  }
}
