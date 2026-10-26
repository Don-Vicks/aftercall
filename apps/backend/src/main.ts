import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

/** The Mac app's web view and the web pages (Verify, sign, claim) call the API from these origins. */
const ORIGINS = ["tauri://localhost", "http://tauri.localhost", "http://localhost:1420", process.env.WEB_ORIGIN ?? "http://localhost:3000"];

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: ORIGINS, methods: ["GET", "POST", "DELETE"], allowedHeaders: ["content-type", "authorization"] });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`backend listening on :${port}`);
}

void bootstrap();
