import { Body, Controller, Get, Headers, HttpCode, Inject, Post, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import type { SignedMessage } from "./nep413";

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /** Step 1: the app asks for a message to sign with the user's NEAR wallet. */
  @Get("auth/challenge")
  challenge() {
    return this.auth.challenge();
  }

  /** Step 2: the app sends the wallet's NEP-413 signature back and gets a session token. */
  @Post("auth/verify")
  @HttpCode(200)
  verify(@Body() body: SignedMessage) {
    for (const field of ["accountId", "publicKey", "signature", "message", "nonce", "recipient"] as const) {
      if (typeof body?.[field] !== "string") throw new UnauthorizedException(`MISSING_${field.toUpperCase()}`);
    }
    return this.auth.verify(body);
  }

  @Get("me")
  async me(@Headers("authorization") authorization?: string) {
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
    if (!token) throw new UnauthorizedException("NO_SESSION");
    return { accountId: await this.auth.accountFor(token) };
  }
}
