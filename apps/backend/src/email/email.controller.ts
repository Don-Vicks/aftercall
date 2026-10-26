import { Body, Controller, Get, Headers, HttpCode, Inject, Post } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { sessionAccount } from "../session";
import { EmailService, type SendRequest } from "./email.service";

@Controller("email")
export class EmailController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(EmailService) private readonly email: EmailService,
  ) {}

  @Get("status")
  status() {
    return { configured: this.email.configured };
  }

  /** Sends a meeting recap for the signed-in account. */
  @Post("recap")
  @HttpCode(200)
  async recap(@Headers("authorization") authorization: string | undefined, @Body() body: SendRequest) {
    const account = await sessionAccount(this.auth, authorization);
    return this.email.send(account, body);
  }
}
