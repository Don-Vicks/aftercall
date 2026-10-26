import { Module } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { HealthController } from "./health.controller";
import { AuthController } from "./auth/auth.controller";
import { AuthService, rpcKeyChecker } from "./auth/auth.service";

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
  controllers: [HealthController, AuthController],
  providers: [
    {
      provide: AuthService,
      useFactory: () => new AuthService(rpcKeyChecker(process.env.NEAR_RPC_URL ?? DEFAULT_RPC), jwtSecret()),
    },
  ],
})
export class AppModule {}
