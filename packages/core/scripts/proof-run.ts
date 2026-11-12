// pnpm --filter @aftercall/core proof:run
//
// One headless run of what the Mac app does after a call, on NEAR testnet, with the same core
// code: the fictional sample call samples/illustrator-quick goes through NEAR AI Cloud's TEEs
// (attestation, Whisper, the end-to-end encrypted summary, the signature check), its proof is
// recorded on chain, autopilot pays the in-cap payment after its undo window, and the payment
// that waits on a condition is held in a Handshake escrow until the payee confirms the terms.
//
// Needs, in the environment or .env at the repo root:
//   NEAR_AI_API_KEY  a NEAR AI Cloud key (the run costs a few cents; the cost is printed)
//   APP_KEY          the private key of OWNER's limited app key (pay, record_proof, open_escrow,
//                    release_escrow on wallet.aftercall.testnet), as `ed25519:...`. Never printed.
//   OWNER            the wallet owner (registered, payee listed, per-payment cap of at least 1 USDC)
//   PAYEE            the payee account; confirms the escrow through near-cli's keychain
// and near-cli-rs on the PATH. Prints every transaction and the proof's /verify link.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { costLine } from "../src/cost.ts";
import { meetingAutopilotDecision, UNDO_SECONDS } from "../src/followups/autopilot.ts";
import { PAY_MEMO } from "../src/followups/boundaries.ts";
import { dealLink, dealTermsFor, dealTermsHash, newDealSalt } from "../src/followups/deal.ts";
import { formatUsdc } from "../src/money.ts";
import { apiKeyFrom, nodeNearAiTransport } from "../src/node/nearai.ts";
import { processRecording } from "../src/notes/pipeline.ts";
import { encodePublicProof, proofHash } from "../src/notes/proof.ts";
import { contractFollowupId } from "../src/relay/mac.ts";
import { formatSampleNotes, type SampleScript } from "../src/node/sampleNotes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));

const NETWORK = "testnet" as const;
const CONTRACT = "wallet.aftercall.testnet";
const WEB = "https://getaftercall.vercel.app";
const RPC = "https://rpc.testnet.near.org";
const EXPLORER = "https://testnet.nearblocks.io/txns/";
const need = (name: string) => process.env[name]?.trim() || (console.error(`Set ${name} (see the top of this file).`), process.exit(2));
const OWNER = need("OWNER");
const PAYEE = need("PAYEE");
const APP_KEY = need("APP_KEY");
const apiKey = apiKeyFrom(process.env);

/** Everything a judge needs to re-check this run, written to docs/proof-run.md. */
const OUT = join(root, "docs", "proof-run.md");
const record = (s: string) => appendFileSync(OUT, `${s}\n`);
const say = (s: string) => console.log(s);
const txLink = (h: string | null) => (h ? `${EXPLORER}${h}` : "(no transaction)");

/** A near-cli call. Output is parsed, never echoed: near-cli repeats the command, key included. */
function call(method: string, args: unknown, as: "app" | "payee", deposit = "0 NEAR"): { tx: string | null; value: unknown; error: string | null } {
  const signer = as === "app" ? [OWNER, "network-config", NETWORK, "sign-with-plaintext-private-key", APP_KEY] : [PAYEE, "network-config", NETWORK, "sign-with-keychain"];
  const r = spawnSync(
    "near",
    ["contract", "call-function", "as-transaction", CONTRACT, method, "json-args", JSON.stringify(args), "prepaid-gas", "100.0 Tgas", "attached-deposit", deposit, "sign-as", ...signer, "send"],
    { encoding: "utf8" },
  );
  const all = `${r.stdout}\n${r.stderr}`;
  const tx = all.match(/Transaction ID: ([1-9A-HJ-NP-Za-km-z]{43,44})/)?.[1] ?? null;
  const panic = all.match(/Smart contract panicked: ([^"\n)]+)/)?.[1] ?? all.match(/Error: (.*isn't allowed.*)/)?.[1] ?? null;
  let value: unknown = null;
  try {
    value = JSON.parse(r.stdout.trim());
  } catch {
    const m = all.match(/\{[\s\S]*?"status"[\s\S]*?\}/);
    if (m) value = m[0].replace(/[││]/g, "").trim();
  }
  return { tx, value, error: r.status === 0 && !panic ? null : (panic ?? "near-cli failed") };
}

async function view<T>(method: string, args: unknown): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }),
  });
  const body = (await res.json()) as { result?: { result: number[] } };
  return JSON.parse(Buffer.from(body.result!.result).toString()) as T;
}

// 1. Notes, made exactly as the Mac app makes them.
const sampleDir = join(root, "samples", "illustrator-quick");
const sample = JSON.parse(readFileSync(join(sampleDir, "script.json"), "utf8")) as SampleScript;
const runId = `proof-run-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
say(`# ${sample.title} (fictional sample call)\nRun ${runId}, owner ${OWNER}, payee ${PAYEE}\n`);
writeFileSync(
  OUT,
  `# Proof run ${runId}\n\nWritten by \`pnpm --filter @aftercall/core proof:run\` (packages/core/scripts/proof-run.ts): the fictional sample call samples/illustrator-quick through NEAR AI Cloud's TEEs, then the follow-ups on NEAR testnet (contract \`${CONTRACT}\`, owner \`${OWNER}\`, payee \`${PAYEE}\`), signed by the owner's limited app key as the Mac app signs them.\n\n`,
);
const result = await processRecording(
  nodeNearAiTransport({ apiKey }),
  {
    id: runId,
    project: sample.title,
    startedAt: "Sample",
    durationSec: sample.seconds,
    chunkSeconds: 300,
    chunks: [
      { path: join(sampleDir, "mic-000.wav"), speaker: "you", index: 0 },
      { path: join(sampleDir, "system-000.wav"), speaker: "others", index: 0 },
    ],
    payees: [{ name: "Illustrator", account: PAYEE }],
    vocabulary: sample.vocabulary,
  },
  (stage, detail) => say(`  · ${stage}${detail ? ` ${detail}` : ""}`),
);
const meeting = result.meeting;
const failed = result.checks.filter((c) => !c.ok);
say(`\nNotes ${meeting.verified ? "verified" : "NOT verified"}: ${result.checks.length - failed.length}/${result.checks.length} checks passed${failed.length ? ` (failed: ${failed.map((c) => c.label).join(", ")})` : ""}`);
say(costLine(result.cost));
say(`\n${formatSampleNotes(sample, result).split("\n## Transcript")[0]}`);
if (!meeting.verified) process.exit(1);

// 2. The proof on NEAR, and its public link.
const hash = proofHash(result.proof);
const recorded = call("record_proof", { meeting_id: result.proof.meetingId, proof_hash: hash, model: result.proof.summaryModel }, "app");
say(`\nrecord_proof: ${recorded.error ?? "ok"} ${txLink(recorded.tx)}`);
if (recorded.error) process.exit(1);
const verifyUrl = `${WEB}/verify#${encodePublicProof({ network: NETWORK, contract: CONTRACT, owner: OWNER, bundle: result.proof })}`;
say(`Proof link: written to docs/proof-run.md`);
record(`Notes: ${meeting.verified ? "verified" : "not verified"}, ${result.checks.length - failed.length} of ${result.checks.length} checks passed. ${costLine(result.cost)}\n`);
record(`| Step | Result | Transaction |\n| --- | --- | --- |`);
record(`| Proof of the notes recorded (\`record_proof\`) | ok | [${recorded.tx}](${txLink(recorded.tx)}) |`);

// 3. Follow-ups: autopilot runs what passes every rule; a payment that waits on a condition becomes a deal.
const wallet = await view<{ daily_cap: string; spent_today: string; per_payment_cap: string; day: number }>("get_wallet", { owner: OWNER });
const today = Math.floor(Date.now() / 86_400_000);
const limits = {
  perPaymentCap: BigInt(wallet.per_payment_cap),
  leftToday: BigInt(wallet.daily_cap) - (wallet.day === today ? BigInt(wallet.spent_today) : 0n),
};
const rules = { payments: true, recapDomains: [] as string[] };
for (const f of meeting.followUps) {
  if (f.kind !== "payment") {
    say(`\n${f.kind}: not sent in this run (recaps go out by email from the app)`);
    continue;
  }
  const label = `Pay ${f.payeeName} ${f.amount === null ? "(no amount)" : `${formatUsdc(f.amount)} USDC`}, heard "${f.heard}"${f.condition ? `, once "${f.condition.text}"` : ""}`;
  const decision = meetingAutopilotDecision(meeting, f, rules, limits);
  const followupId = contractFollowupId(meeting.id, f.id);
  if (decision.run && f.amount !== null && f.payeeAccount) {
    say(`\n${label}\n  autopilot: every rule passes; undo window ${UNDO_SECONDS} s…`);
    await new Promise((r) => setTimeout(r, UNDO_SECONDS * 1000));
    const paid = call("pay", { payee: f.payeeAccount, amount: f.amount.toString(), memo: PAY_MEMO, followup_id: followupId, meeting_id: result.proof.meetingId }, "app");
    say(`  pay: ${paid.error ?? JSON.stringify(paid.value)} ${txLink(paid.tx)}`);
    record(`| Autopilot pays ${formatUsdc(f.amount)} USDC after the ${UNDO_SECONDS} s undo window (\`pay\`) | ${paid.error ?? "sent"} | ${paid.tx ? `[${paid.tx}](${txLink(paid.tx)})` : "none"} |`);
    limits.leftToday -= f.amount;
    continue;
  }
  say(`\n${label}\n  waits for a person: ${decision.reasons.join("; ")}`);
  if (!f.condition) continue;
  const terms = dealTermsFor(meeting, f, { network: NETWORK, contract: CONTRACT, owner: OWNER, escrowId: followupId, meetingId: result.proof.meetingId, proofHash: hash, salt: newDealSalt() });
  if (!terms) continue;
  const termsHash = dealTermsHash(terms);
  const opened = call("open_escrow", { escrow_id: followupId, payee: terms.payee, amount: terms.amount, meeting_id: terms.meetingId, terms_hash: termsHash, has_condition: true }, "app");
  say(`  Handshake: open_escrow ${opened.error ?? JSON.stringify(opened.value)} ${txLink(opened.tx)}`);
  record(`| ${formatUsdc(f.amount!)} USDC waits on "${f.condition.text}": held in escrow (\`open_escrow\`) | ${opened.error ?? "open"} | ${opened.tx ? `[${opened.tx}](${txLink(opened.tx)})` : "none"} |`);
  if (opened.error) continue;
  const confirmUrl = dealLink(`${WEB}/deal`, terms);
  say(`  The payee's confirm page: written to docs/proof-run.md`);
  const wrong = call("confirm_escrow", { owner: OWNER, escrow_id: followupId, terms_hash: "0".repeat(64) }, "payee", "1 yoctoNEAR");
  say(`  payee confirms other terms: ${wrong.error ?? "accepted?!"} ${txLink(wrong.tx)}`);
  record(`| The payee confirms different terms (\`confirm_escrow\`) | ${wrong.error ?? "accepted"} | ${wrong.tx ? `[${wrong.tx}](${txLink(wrong.tx)})` : "refused before it was sent"} |`);
  const confirmed = call("confirm_escrow", { owner: OWNER, escrow_id: followupId, terms_hash: termsHash }, "payee", "1 yoctoNEAR");
  say(`  payee confirms these terms: ${confirmed.error ?? JSON.stringify(confirmed.value)} ${txLink(confirmed.tx)}`);
  record(`| The payee confirms these terms from their own account (\`confirm_escrow\`) | ${confirmed.error ?? "confirmed"} | ${confirmed.tx ? `[${confirmed.tx}](${txLink(confirmed.tx)})` : "none"} |`);
  if (confirmed.error) continue;
  // The condition is the owner's call ("once you send the source files"): the run marks it met.
  const released = call("release_escrow", { escrow_id: followupId }, "app");
  say(`  owner marks the condition met, release_escrow: ${released.error ?? JSON.stringify(released.value)} ${txLink(released.tx)}`);
  record(`| The condition is met; the escrow is released (\`release_escrow\`) | ${released.error ?? "released"} | ${released.tx ? `[${released.tx}](${txLink(released.tx)})` : "none"} |`);
  record(`\nThe payee's confirm page for this deal: ${confirmUrl}`);
}
record(`\nThe proof link (open it in a browser; every check re-runs against NEAR testnet):\n\n${verifyUrl}\n\nThe notes, as made in the TEE:\n\n\`\`\`\n${formatSampleNotes(sample, result).split("\n## Cost")[0]}\n\`\`\``);
