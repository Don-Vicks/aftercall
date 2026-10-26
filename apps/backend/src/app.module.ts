import { Module } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { HealthController } from "./health.controller";
import { AuthController } from "./auth/auth.controller";
import { AuthService, rpcKeyChecker } from "./auth/auth.service";
import { EmailController } from "./email/email.controller";
import { EmailService, resendMailer } from "./email/email.service";
import { ClaimsController } from "./claims/claims.controller";
import { ClaimsService } from "./claims/claims.service";

const DEFAULT_RPC = "https://rpc.testnet.near.org";

function jwtSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_JWT_SECRET is required in production");
  // Development only: sessions don't survive a restart.
  console.warn("AUTH_JWT_SECRET not set; using a random secret for this run");
  return randomBytes(32).toString("hex");
}

@Module({
  controllers: [HealthController, AuthController, EmailController, ClaimsController],
  providers: [
    {
      provide: AuthService,
      useFactory: () => new AuthService(rpcKeyChecker(process.env.NEAR_RPC_URL ?? DEFAULT_RPC, process.env.AFTERCALL_CONTRACT), jwtSecret()),
    },
    {
      provide: EmailService,
      useFactory: () =>
        new EmailService(process.env.RESEND_API_KEY ? resendMailer(process.env.RESEND_API_KEY) : null, process.env.EMAIL_FROM ?? "notes@aftercall.app"),
    },
    { provide: ClaimsService, useFactory: () => new ClaimsService() },
  ],
})
export class AppModule {}
