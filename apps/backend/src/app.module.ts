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
import { RelayController } from "./relay/relay.controller";
import { RelayService } from "./relay/relay.service";
import { MemoryRelayStore, PgRelayStore } from "./relay/relay.store";
import { StatsController } from "./stats/stats.controller";
import { StatsService, rpcChainStats } from "./stats/stats.service";
import { MemoryCounters, PgCounters, type Counters } from "./stats/counters";
import { MemoryDailyCounts, PgDailyCounts, type DailyCounts } from "./limits";
import { cloudApiAdmin, sharedKeyAdmin } from "./nearai/admin";
import { MemoryIssuedKeys, PgIssuedKeys, TesterKeys } from "./nearai/testerKeys";
import { TesterKeysController } from "./nearai/testerKeys.controller";
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

/**
 * Aftercall's NEAR AI account for test credits: a capped key per tester when the admin
 * account is set up, else one shared key (NEARAI_TESTER_KEY), else null (the app then asks
 * for your own key).
 */
function nearAiAdmin() {
  const { NEARAI_ADMIN_ACCOUNT: accountId, NEARAI_ADMIN_KEY: secretKey, NEARAI_WORKSPACE_ID: workspaceId, NEARAI_TESTER_KEY: shared } = process.env;
  if (!accountId || !secretKey || !workspaceId) return shared ? sharedKeyAdmin(shared) : null;
  return cloudApiAdmin({ baseUrl: process.env.NEARAI_CLOUD_URL ?? "https://cloud-api.near.ai", accountId, secretKey, workspaceId });
}

const number = (value: string | undefined, fallback: number) => (value && Number.isFinite(Number(value)) ? Number(value) : fallback);

@Module({
  controllers: [HealthController, AuthController, EmailController, ClaimsController, StatsController, TesterKeysController, RelayController],
  providers: [
    { provide: NEAR_ENV, useFactory: () => nearEnv() },
    {
      provide: PG_POOL,
      useFactory: () => {
        if (process.env.DATABASE_URL) return new Pool({ connectionString: process.env.DATABASE_URL });
        if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL is required in production");
        console.warn("DATABASE_URL not set; claim links, counters and the phone relay are kept in memory for this run");
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
      provide: TesterKeys,
      inject: [PG_POOL, COUNTERS, DAILY_COUNTS],
      useFactory: async (pool: Pool | null, counters: Counters, daily: DailyCounts) => {
        let issued: MemoryIssuedKeys | PgIssuedKeys = new MemoryIssuedKeys();
        if (pool) {
          issued = new PgIssuedKeys(pool);
          await issued.migrate();
        }
        const options = {
          spendLimitUsd: number(process.env.TESTER_KEY_LIMIT_USD, 0.25),
          maxKeys: number(process.env.TESTER_KEYS_MAX, 30),
          perIpPerDay: number(process.env.TESTER_KEYS_PER_IP_PER_DAY, 3),
          shared: !(process.env.NEARAI_ADMIN_ACCOUNT && process.env.NEARAI_ADMIN_KEY && process.env.NEARAI_WORKSPACE_ID) && !!process.env.NEARAI_TESTER_KEY,
        };
        return new TesterKeys(nearAiAdmin(), issued, daily, options, Date.now, counters);
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
      provide: RelayService,
      inject: [PG_POOL, DAILY_COUNTS],
      useFactory: async (pool: Pool | null, daily: DailyCounts) => {
        if (!pool) return new RelayService(new MemoryRelayStore(), daily);
        const store = new PgRelayStore(pool);
        await store.migrate();
        return new RelayService(store, daily);
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
