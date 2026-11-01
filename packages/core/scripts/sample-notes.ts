// pnpm sample:notes [designer-kickoff | team-checkin | all]
//
// Runs the real notes pipeline on a fictional sample call from samples/, calling
// NEAR AI Cloud directly from Node, and prints the notes and the verification result.
// Needs NEAR_AI_API_KEY in .env at the repo root (or in the environment). It prints
// what each sample probably cost in NEAR AI credit (an estimate from published prices;
// the summary is capped at SUMMARY_MAX_TOKENS). Nothing is saved; meeting content goes
// nowhere but cloud-api.near.ai. Exits 1 unless every sample came back verified.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { costLine, sumCosts, type CostEstimate } from "../src/cost.ts";
import { plainNearAiError } from "../src/errors.ts";
import { MissingKeyError, apiKeyFrom, nodeNearAiTransport } from "../src/node/nearai.ts";
import { formatSampleNotes, runSampleNotes } from "../src/node/sampleNotes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SAMPLES = ["designer-kickoff", "team-checkin"];

const envFile = join(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const wanted = process.argv.slice(2).find((a) => !a.startsWith("-")) ?? SAMPLES[0];
const ids = wanted === "all" ? SAMPLES : [wanted];
if (!ids.every((id) => SAMPLES.includes(id))) {
  console.error(`Unknown sample "${wanted}". Choose one of: ${SAMPLES.join(", ")}, all`);
  process.exit(2);
}

let apiKey: string;
try {
  apiKey = apiKeyFrom(process.env);
} catch (e) {
  console.error(e instanceof MissingKeyError ? e.message : String(e));
  process.exit(1);
}

const transport = nodeNearAiTransport({ apiKey });
let failed = false;
const costs: CostEstimate[] = [];
for (const id of ids) {
  console.error(`\n▸ ${id}: processing samples/${id} on NEAR AI Cloud`);
  try {
    const { script, result } = await runSampleNotes(transport, join(root, "samples", id), (stage, detail) =>
      console.error(`  ${stage}${detail ? ` ${detail}` : ""}`),
    );
    console.log(`\n${formatSampleNotes(script, result)}\n`);
    costs.push(result.cost);
    // Verified means every attestation check and the summary's signature passed.
    if (!result.meeting.verified) {
      console.error(`  not verified: ${result.checks.filter((c) => !c.ok && c.id !== "response-e2ee").map((c) => c.label).join("; ")}`);
      failed = true;
    }
  } catch (e) {
    console.error(`  failed: ${plainNearAiError(e)}`);
    failed = true;
  }
}
if (costs.length > 1) console.log(`All samples: ${costLine(sumCosts(costs))}`);
process.exit(failed ? 1 : 0);
