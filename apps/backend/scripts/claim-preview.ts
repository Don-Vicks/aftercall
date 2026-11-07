/*
 * See a claim link from the payee's side without a NEAR sign-in: runs the backend's real
 * claims routes with an in-memory store, makes one link for a made-up owner, and prints it.
 * Nothing touches the deployed backend or NEAR until the payee's wallet signs on the page.
 *
 *   pnpm --filter @aftercall/backend claim:preview
 *   pnpm --filter @aftercall/web dev   (with NEXT_PUBLIC_BACKEND_URL=http://localhost:3101)
 */
import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { claimLink } from "../../../packages/core/src/followups/claimLink.ts";
import { AuthService } from "../src/auth/auth.service";
import { ClaimsController } from "../src/claims/claims.controller";
import { ClaimsService } from "../src/claims/claims.service";
import { MemoryClaimsStore } from "../src/claims/claims.store";

const PORT = Number(process.env.PORT ?? 3101);
const WEB = process.env.WEB_URL ?? "http://localhost:3000";
const claims = new ClaimsService(new MemoryClaimsStore());

@Module({
  controllers: [ClaimsController],
  providers: [
    // Only the payee's routes are public; the owner's need a session, which this preview never gives.
    { provide: AuthService, useValue: { accountFor: async () => { throw new Error("NO_SESSION"); } } },
    { provide: ClaimsService, useValue: claims },
  ],
})
class PreviewModule {}

async function main() {
  const app = await NestFactory.create(PreviewModule, { logger: ["error"] });
  app.enableCors({ origin: [WEB], methods: ["GET", "POST"], allowedHeaders: ["content-type"] });
  await app.listen(PORT);
  const { token } = await claims.create("preview-owner.testnet", { amount: "50000000" });
  console.log(`claims API (in memory) on http://localhost:${PORT}`);
  console.log(`claim link: ${claimLink(`${WEB}/claim`, token, { payeeName: "Kemi", memo: "Deck deposit", meeting: "Sync with Ada" })}`);
}

void main();
