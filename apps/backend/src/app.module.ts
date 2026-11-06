import { Module } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { HealthController } from "./health.controller";
import { AuthController } from "./auth/auth.controller";
import { AuthService, rpcKeyChecker } from "./auth/auth.service";
import { EmailController } from "./email/email.controller";
import { EmailService, resendMailer } from "./email/email.service";
import { ClaimsController } from "./claims/claims.controller";
import { ClaimsService } from "./claims/claims.service";
import { MemoryClaimsStore, PgClaimsStore } from "./claims/claims.store";
import { StatsController } from "./stats/stats.controller";
import { StatsService, rpcChainStats } from "./stats/stats.service";
import { MemoryCounters, PgCounters, type Counters } from "./stats/counters";
import { MemoryDailyCounts, PgDailyCounts, type DailyCounts } from "./limits";
import { nearEnv } from "./network";
import { Pool } from "pg";

const PG_POOL = "PG_POOL";
const NEAR_ENV = "NEAR_ENV";
const COUNTERS = "COUNTERS";
const DAILY_COUNTS = "DAILY_COUNTS";

function jwtSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_JWT_SECRET is required in production");
  // Development only: sessions don't survive a restart.
  console.warn("AUTH_JWT_SECRET not set; using a random secret for this run");
  return randomBytes(32).toString("hex");
}

@Module({
  controllers: [HealthController, AuthController, EmailController, ClaimsController, StatsController],
  providers: [
    { provide: NEAR_ENV, useFactory: () => nearEnv() },
    {
      provide: PG_POOL,
      useFactory: () => {
        if (process.env.DATABASE_URL) return new Pool({ connectionString: process.env.DATABASE_URL });
        if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL is required in production");
        console.warn("DATABASE_URL not set; claim links and counters are kept in memory for this run");
        return null;
      },
    },
    {
      provide: AuthService,
      inject: [NEAR_ENV],
      useFactory: (near: ReturnType<typeof nearEnv>) => new AuthService(rpcKeyChecker(near.rpcUrl, near.contract), jwtSecret()),
    },
    {
      provide: COUNTERS,
      inject: [PG_POOL],
      useFactory: async (pool: Pool | null): Promise<Counters> => {
        if (!pool) return new MemoryCounters();
        const counters = new PgCounters(pool);
        await counters.migrate();
        return counters;
      },
    },
    {
      provide: DAILY_COUNTS,
      inject: [PG_POOL],
      useFactory: async (pool: Pool | null): Promise<DailyCounts> => {
        if (!pool) return new MemoryDailyCounts();
        const daily = new PgDailyCounts(pool);
        await daily.migrate();
        return daily;
      },
    },
    {
      provide: EmailService,
      inject: [COUNTERS, DAILY_COUNTS],
      useFactory: (counters: Counters, daily: DailyCounts) =>
        new EmailService(
          process.env.RESEND_API_KEY ? resendMailer(process.env.RESEND_API_KEY) : null,
          process.env.EMAIL_FROM ?? "notes@aftercall.app",
          Date.now,
          counters,
          daily,
        ),
    },
    {
      provide: ClaimsService,
      inject: [PG_POOL],
      useFactory: async (pool: Pool | null) => {
        if (!pool) return new ClaimsService(new MemoryClaimsStore());
        const store = new PgClaimsStore(pool);
        await store.migrate();
        return new ClaimsService(store);
      },
    },
    {
      provide: StatsService,
      inject: [NEAR_ENV, ClaimsService, COUNTERS],
      useFactory: (near: ReturnType<typeof nearEnv>, claims: ClaimsService, counters: Counters) =>
        new StatsService({
          network: near.network,
          chain: near.contract ? rpcChainStats(near.rpcUrl, near.contract) : undefined,
          claims: () => claims.totals(),
          emailsSent: () => counters.get("emails_sent"),
        }),
    },
  ],
})
export class AppModule {}
