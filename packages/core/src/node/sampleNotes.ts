import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatClock } from "../meeting.ts";
import { costLine, formatCost } from "../cost.ts";
import { formatUsdc } from "../money.ts";
import { amountNote, type Payee } from "../notes/build.ts";
import { processRecording, WHISPER_MODEL, type NotesTransport, type ProcessResult } from "../notes/pipeline.ts";
import { groupChecks, WHISPER_NOTE } from "../notes/proof.ts";

/** samples/<id>/script.json, written by scripts/make-samples.mjs. */
export interface SampleScript {
  id: string;
  title: string;
  seconds: number;
  payees: Payee[];
  vocabulary: string[];
}

/**
 * Runs the real notes pipeline (packages/core processRecording) on one sample folder:
 * the same two stems, attestation, Whisper, the strict-schema summary and the signature
 * check the Mac app runs. Nothing is written to disk.
 */
export async function runSampleNotes(
  transport: NotesTransport,
  sampleDir: string,
  onStage: (stage: string, detail?: string) => void = () => {},
  wait?: (ms: number) => Promise<void>,
): Promise<{ script: SampleScript; result: ProcessResult }> {
  const script = JSON.parse(await readFile(join(sampleDir, "script.json"), "utf8")) as SampleScript;
  const result = await processRecording(
    transport,
    {
      id: `sample-${script.id}`,
      project: script.title,
      startedAt: "Sample",
      durationSec: script.seconds,
      chunkSeconds: 300,
      chunks: [
        { path: join(sampleDir, "mic-000.wav"), speaker: "you", index: 0 },
        { path: join(sampleDir, "system-000.wav"), speaker: "others", index: 0 },
      ],
      payees: script.payees,
      vocabulary: script.vocabulary,
    },
    onStage,
    wait,
  );
  return { script, result };
}

const ok = (b: boolean) => (b ? "PASS" : "FAIL");

/** The notes and the verification result as plain text for the terminal. */
export function formatSampleNotes(script: SampleScript, r: ProcessResult): string {
  const m = r.meeting;
  const out: string[] = [];
  out.push(`# ${m.title}`, `Sample: ${script.title} (fictional)`, "", m.summary, "");
  out.push("## Decisions", ...(m.decisions.length ? m.decisions.map((d) => `- ${d}`) : ["- none"]), "");
  out.push(
    "## Action items",
    ...(m.actionItems.length ? m.actionItems.map((a) => `- ${a.text} (${a.owner}${a.due ? `, ${a.due}` : ""})`) : ["- none"]),
    "",
  );
  out.push("## Follow-ups (each backed by an exact quote)");
  if (m.followUps.length === 0) out.push("- none");
  for (const f of m.followUps) {
    const what =
      f.kind === "email"
        ? `Recap email to ${f.toName || "someone"}: "${f.subject}"`
        : `Pay ${f.payeeName}${f.payeeListed ? ` (${f.payeeAccount})` : " (not a listed payee)"} ${f.amount === null ? `no amount (${amountNote(f)})` : `${formatUsdc(f.amount)} USDC`}, heard "${f.heard}"`;
    out.push(`- ${what}`, f.evidence ? `    [${formatClock(f.evidence.at)}] "${f.evidence.quote}"` : `    proposed by ${f.proposedBy?.agent ?? "an agent"}: "${f.proposedBy?.reason ?? ""}"`);
  }
  if (r.dropped.length) out.push("", "## Dropped (quote not found in the transcript)", ...r.dropped.map((d) => `- ${d.kind}: ${d.text}`));
  out.push("", "## Transcript", ...m.transcript.map((l) => `[${formatClock(l.at)}] ${l.speaker === "you" ? "You" : "Others"}: ${l.text}`));
  out.push(
    "",
    "## Verification",
    ...groupChecks(r.checks, { whisperModel: WHISPER_MODEL, summaryModel: r.proof.summaryModel }).flatMap((g) => [
      `${g.title}:`,
      ...g.checks.map((c) => `  ${ok(c.ok)} ${c.label} — ${c.detail}`),
    ]),
    `- ${WHISPER_NOTE}`,
    `- Transcript end-to-end encrypted to the attested summary model: ${r.proof.e2ee.used ? "yes" : `no (${r.proof.e2ee.reason ?? "unavailable"})`}`,
    r.proof.version === 3
      ? `- Proof bundle: ${r.proof.calls.length} signed requests, notes ${r.proof.notesHash.slice(0, 16)}…`
      : `- Proof bundle: request ${r.proof.requestHash.slice(0, 16)}…, response ${r.proof.responseHash.slice(0, 16)}…, notes ${r.proof.notesHash.slice(0, 16)}…`,
    "",
    "## Cost",
    costLine(r.cost),
    `- Whisper: ${r.cost.whisperSeconds} s of audio, ${formatCost(r.cost.whisperUsd)}`,
    ...(r.cost.chat
      ? [`- ${r.cost.chat.model}: ${r.cost.chat.promptTokens} input and ${r.cost.chat.completionTokens} output tokens${r.cost.chat.reasoningTokens !== undefined ? ` (${r.cost.chat.reasoningTokens} of them reasoning)` : ""}, ${formatCost(r.cost.chat.usd)}`]
      : []),
  );
  return out.join("\n");
}
