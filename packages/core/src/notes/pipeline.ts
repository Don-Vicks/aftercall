import { buildMeeting, type Dropped, type Payee } from "./build.ts";
import { NOTES_SYSTEM_PROMPT, notesJsonSchema, notesSchema, type Notes } from "./schema.ts";
import { mergeTranscript, transcriptForPrompt, type TranscribedChunk, type WhisperResult } from "./transcript.ts";
import { checkAttestation, checkSignature, sha256Hex, type AttestationCheck, type AttestationReport, type SignatureCheck, type SignatureResponse } from "./verify.ts";
import type { Meeting, Speaker } from "../meeting.ts";

export const WHISPER_MODEL = "openai/whisper-large-v3";
export const SUMMARY_MODEL = "Qwen/Qwen3.8-27B";
/** Same Confidential TEE tier; used if the main model is unavailable. Smaller output cap. */
export const FALLBACK_SUMMARY_MODEL = "Qwen/Qwen3.6-35B-A3B-FP8";

/**
 * How the pipeline reaches NEAR AI Cloud. The desktop app implements this in Rust
 * so the API key stays in the macOS Keychain and audio is read straight from disk.
 */
export interface NearAiTransport {
  /** POST /v1/audio/transcriptions with the file at `path`; returns the raw response body. */
  transcribe(path: string, model: string, prompt: string): Promise<string>;
  /** POST /v1/chat/completions with exactly these bytes; returns exactly the bytes received. */
  chat(body: string): Promise<string>;
  /** GET a path under /v1 (attestation report, signature). */
  get(path: string): Promise<string>;
  /** 32 random bytes as hex, for attestation nonces. */
  randomHex(): string;
}

export interface AudioChunk {
  path: string;
  speaker: Speaker;
  index: number;
}

export type Stage = "attest" | "transcribe" | "summarise" | "signature";

export interface ProcessInput {
  id: string;
  project: string;
  startedAt: string;
  durationSec: number;
  chunkSeconds: number;
  chunks: AudioChunk[];
  payees: Payee[];
  /** Names Whisper should spell right: payees, project, people. */
  vocabulary: string[];
  /**
   * Keeps each chunk's transcription, so a retry after a later step fails doesn't
   * pay to transcribe the same audio again.
   */
  transcriptCache?: TranscriptCache;
}

export interface TranscriptCache {
  get(chunk: AudioChunk): Promise<string | null>;
  set(chunk: AudioChunk, raw: string): Promise<void>;
}

export interface ProofBundle {
  version: 1;
  meetingId: string;
  summaryModel: string;
  whisperModel: string;
  attestationNonce: { summary: string; whisper: string };
  attestedSigners: string[];
  /** sha256 of the exact chat request and response bodies, as signed by the enclave. */
  requestHash: string;
  responseHash: string;
  signature: SignatureResponse;
  /** sha256 of the transcript and notes the app shows, so later edits are detectable. */
  transcriptHash: string;
  notesHash: string;
}

export interface ProcessResult {
  meeting: Meeting;
  /** The model's notes exactly as returned; their hash is in the proof. */
  notes: Notes;
  dropped: Dropped[];
  attestation: { summary: AttestationCheck; whisper: AttestationCheck };
  signature: SignatureCheck;
  proof: ProofBundle;
}

const enc = new TextEncoder();

async function attest(t: NearAiTransport, model: string): Promise<{ check: AttestationCheck; nonce: string }> {
  const nonce = t.randomHex();
  const q = new URLSearchParams({ model, signing_algo: "ecdsa", nonce, include_tls_fingerprint: "false" });
  const report = JSON.parse(await t.get(`attestation/report?${q}`)) as AttestationReport;
  return { check: checkAttestation(report, nonce), nonce };
}

/** Waits for the signature, which NEAR AI publishes a moment after the response. */
async function fetchSignature(t: NearAiTransport, chatId: string, model: string, wait: (ms: number) => Promise<void>): Promise<SignatureResponse> {
  const q = new URLSearchParams({ model, signing_algo: "ecdsa" });
  for (let attempt = 0; ; attempt++) {
    try {
      return JSON.parse(await t.get(`signature/${encodeURIComponent(chatId)}?${q}`)) as SignatureResponse;
    } catch (e) {
      if (attempt >= 10) throw e;
      await wait(2000);
    }
  }
}

/**
 * Recording -> verified notes: attest both models, transcribe every chunk of both
 * stems, summarise into the strict schema, check the summary's signature, keep only
 * items backed by an exact quote, and assemble the proof bundle for NEAR (M3).
 */
export async function processRecording(
  t: NearAiTransport,
  input: ProcessInput,
  onStage: (stage: Stage, detail?: string) => void = () => {},
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<ProcessResult> {
  onStage("attest");
  const [summaryAttest, whisperAttest] = [await attest(t, SUMMARY_MODEL), await attest(t, WHISPER_MODEL)];
  if (!summaryAttest.check.ok) throw new Error(`Secure hardware check failed for the summary model: ${summaryAttest.check.reasons.join(", ")}`);
  if (!whisperAttest.check.ok) throw new Error(`Secure hardware check failed for Whisper: ${whisperAttest.check.reasons.join(", ")}`);

  const prompt = input.vocabulary.filter(Boolean).join(", ");
  const transcribed: TranscribedChunk[] = [];
  for (const [i, chunk] of input.chunks.entries()) {
    onStage("transcribe", `${i + 1} of ${input.chunks.length}`);
    let raw = (await input.transcriptCache?.get(chunk).catch(() => null)) ?? null;
    if (raw === null) {
      raw = await t.transcribe(chunk.path, WHISPER_MODEL, prompt);
      await input.transcriptCache?.set(chunk, raw).catch(() => {});
    }
    const result = JSON.parse(raw) as WhisperResult;
    transcribed.push({ speaker: chunk.speaker, index: chunk.index, result });
  }
  const transcript = mergeTranscript(transcribed, input.chunkSeconds);

  onStage("summarise");
  const payeeList = input.payees.map((p) => `${p.name} (${p.account})`);
  const request = JSON.stringify({
    model: SUMMARY_MODEL,
    stream: false,
    messages: [
      { role: "system", content: NOTES_SYSTEM_PROMPT },
      { role: "user", content: `Project: ${input.project}\nPayees: ${JSON.stringify(payeeList)}\n\nTranscript:\n${transcriptForPrompt(transcript)}` },
    ],
    response_format: { type: "json_schema", json_schema: { name: "meeting_notes", strict: true, schema: notesJsonSchema } },
  });
  const response = await t.chat(request);
  const completion = JSON.parse(response) as { id: string; choices?: { message?: { content?: string } }[] };
  const notes = notesSchema.parse(JSON.parse(completion.choices?.[0]?.message?.content ?? "null"));

  onStage("signature");
  const sig = await fetchSignature(t, completion.id, SUMMARY_MODEL, wait);
  const signature = checkSignature(sig, enc.encode(request), enc.encode(response), summaryAttest.check.signers);

  const { meeting, dropped } = buildMeeting({
    id: input.id,
    project: input.project,
    startedAt: input.startedAt,
    durationSec: input.durationSec,
    notes,
    transcript,
    payees: input.payees,
    verified: signature.ok,
  });

  return {
    meeting,
    notes,
    dropped,
    attestation: { summary: summaryAttest.check, whisper: whisperAttest.check },
    signature,
    proof: {
      version: 1,
      meetingId: input.id,
      summaryModel: SUMMARY_MODEL,
      whisperModel: WHISPER_MODEL,
      attestationNonce: { summary: summaryAttest.nonce, whisper: whisperAttest.nonce },
      attestedSigners: summaryAttest.check.signers,
      requestHash: sha256Hex(enc.encode(request)),
      responseHash: sha256Hex(enc.encode(response)),
      signature: sig,
      transcriptHash: sha256Hex(enc.encode(JSON.stringify(transcript))),
      notesHash: sha256Hex(enc.encode(JSON.stringify(notes))),
    },
  };
}
