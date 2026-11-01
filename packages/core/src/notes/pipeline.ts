import { buildMeeting, type Dropped, type Payee } from "./build.ts";
import { NOTES_SYSTEM_PROMPT, notesJsonSchema, notesSchema, type Notes } from "./schema.ts";
import { mergeTranscript, transcriptForPrompt, type TranscribedChunk, type WhisperResult } from "./transcript.ts";
import { sha256Hex } from "./verify.ts";
import { attestModel, attestedKeys, failedLabels, gatewayChecks, loadNvidiaKeys, modelChecks, type ModelAttestation, type TeeEvidence, type TeeTransport, type VerifiedTee } from "../tee/attest.ts";
import { responseChecks, short, signingIdentity, strip0x, type SignatureResponse, type TeeCheck } from "../tee/checks.ts";
import { decryptWith, encryptMessages, newClientKeys } from "../tee/e2ee.ts";
import type { Meeting, Speaker } from "../meeting.ts";

export const WHISPER_MODEL = "openai/whisper-large-v3";
export const SUMMARY_MODEL = "Qwen/Qwen3.8-27B";
/** Same Confidential TEE tier; used if the main model is unavailable. Smaller output cap. */
export const FALLBACK_SUMMARY_MODEL = "Qwen/Qwen3.6-35B-A3B-FP8";

/** The public keys for an end-to-end encrypted chat request. */
export interface E2eeKeys {
  clientPubKey: string;
  modelPubKey: string;
}

/**
 * How the pipeline reaches NEAR AI Cloud, Intel and NVIDIA. The desktop app
 * implements this in Rust so the API key stays in the macOS Keychain, audio is
 * read straight from disk, and the attestation services are reachable (no CORS).
 */
export interface NearAiTransport extends TeeTransport {
  /** POST /v1/audio/transcriptions with the file at `path`; returns the raw response body. */
  transcribe(path: string, model: string, prompt: string): Promise<string>;
  /** POST /v1/chat/completions with exactly these bytes (and E2EE headers if given); returns exactly the bytes received. */
  chat(body: string, e2ee?: E2eeKeys): Promise<string>;
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

/** Proofs made before full attestation checks: the signature and attested signers only. */
export interface ProofBundleV1 {
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

/** How the transcript reached the summary model. */
export interface E2eeRecord {
  used: boolean;
  /** The model TEE's attested Ed25519 key the transcript was encrypted to. */
  modelKey?: string;
  /** Why it wasn't used, when it wasn't. */
  reason?: string;
}

/**
 * Proofs with every attestation check: the gateway TEE and each model TEE,
 * verified against Intel and NVIDIA with a fresh nonce, and the summary's
 * signature bound to an attested key. Still no meeting content.
 */
export interface ProofBundleV2 extends Omit<ProofBundleV1, "version"> {
  version: 2;
  /** Algorithm of the summary signature and of the keys in `attestedSigners`/`gatewaySigners`. */
  signingAlgo: "ecdsa" | "ed25519";
  /** Gateway keys whose quote verified and bound them. */
  gatewaySigners: string[];
  e2ee: E2eeRecord;
  /** Every check the app ran, pass or fail. */
  checks: TeeCheck[];
  /** The values those checks compared, per TEE. */
  evidence: TeeEvidence[];
  checkedAt: string;
}

export type ProofBundle = ProofBundleV1 | ProofBundleV2;

export interface ProcessResult {
  meeting: Meeting;
  /** The model's notes exactly as returned (decrypted); their hash is in the proof. */
  notes: Notes;
  dropped: Dropped[];
  /** Everything checked for this meeting, in panel order. */
  checks: TeeCheck[];
  proof: ProofBundleV2;
}

const enc = new TextEncoder();

/** Everything that must pass before audio or text leaves the Mac. Throws in plain words if not. */
function requireAttested(summary: ModelAttestation, whisper: ModelAttestation): void {
  const gw = gatewayChecks(summary);
  if (!gw.every((c) => c.ok)) throw new Error(`Secure hardware check failed for the NEAR AI gateway (${failedLabels(gw)}). Nothing was sent.`);
  // Audio can't be pinned to one Whisper node, so every node must pass.
  const w = modelChecks(whisper);
  if (!w.every((c) => c.ok)) throw new Error(`Secure hardware check failed for Whisper (${failedLabels(w)}). Nothing was sent.`);
  if (!summary.nodes.some((n) => n.verified)) {
    throw new Error(`Secure hardware check failed for the summary model (${failedLabels(modelChecks(summary))}). Nothing was sent.`);
  }
}

/** A verified summary node whose E2EE key is the key bound in its quote. */
export function e2eeNode(summary: ModelAttestation): VerifiedTee | undefined {
  return summary.nodes.find((n) => {
    const key = strip0x(n.att.signing_public_key ?? "");
    return n.verified && /^[0-9a-f]{64}$/.test(key) && key === signingIdentity(n.att);
  });
}

/** NEAR AI answered 4xx to the encrypted request for a reason other than the key, credit or rate. */
function e2eeRefused(e: unknown): string | null {
  const m = /NEAR AI (4\d\d)/.exec(e instanceof Error ? e.message : String(e));
  return m && !["401", "402", "403", "429"].includes(m[1]) ? `NEAR AI refused the encrypted request (${m[1]})` : null;
}

/** Waits for the signature, which NEAR AI publishes a moment after the response. */
export async function fetchSignature(t: NearAiTransport, chatId: string, model: string, wait: (ms: number) => Promise<void>): Promise<SignatureResponse> {
  const q = new URLSearchParams({ model, signing_algo: "ed25519" });
  for (let attempt = 0; ; attempt++) {
    try {
      const sig = JSON.parse(await t.get(`signature/${encodeURIComponent(chatId)}?${q}`)) as SignatureResponse & { error_code?: unknown };
      // A 2xx with error_code means "not available yet" on the node that answered.
      if (!sig.text || !sig.signature) throw new Error(`Signature not available: ${JSON.stringify(sig).slice(0, 200)}`);
      return sig;
    } catch (e) {
      if (attempt >= 10) throw e;
      await wait(2000);
    }
  }
}

/**
 * Recording -> verified notes: verify the gateway TEE and every Whisper and summary
 * model TEE (Intel TDX quote, key and nonce binding, boot log, compose, NVIDIA GPUs)
 * before anything leaves the Mac; transcribe every chunk of both stems; summarise
 * into the strict schema, end-to-end encrypted to the attested summary TEE; check
 * the summary's signature; keep only items backed by an exact quote; and assemble
 * the proof bundle for NEAR.
 */
export async function processRecording(
  t: NearAiTransport,
  input: ProcessInput,
  onStage: (stage: Stage, detail?: string) => void = () => {},
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<ProcessResult> {
  onStage("attest");
  const jwks = await loadNvidiaKeys(t);
  // Ed25519 for the summary model: its key is both the E2EE key and the response signer.
  const [summaryAttest, whisperAttest] = await Promise.all([
    attestModel(t, SUMMARY_MODEL, "ed25519", { withGateway: true, jwks }),
    attestModel(t, WHISPER_MODEL, "ecdsa", { withGateway: false, jwks }),
  ]);
  requireAttested(summaryAttest, whisperAttest);

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
  const messages = [
    { role: "system", content: NOTES_SYSTEM_PROMPT },
    { role: "user", content: `Project: ${input.project}\nPayees: ${JSON.stringify(payeeList)}\n\nTranscript:\n${transcriptForPrompt(transcript)}` },
  ];
  const requestFor = (msgs: typeof messages) =>
    JSON.stringify({
      model: SUMMARY_MODEL,
      stream: false,
      messages: msgs,
      response_format: { type: "json_schema", json_schema: { name: "meeting_notes", strict: true, schema: notesJsonSchema } },
    });

  // End-to-end encryption: the transcript is encrypted here to the attested key of
  // a verified model TEE, so the gateway only relays ciphertext.
  let e2ee: E2eeRecord = { used: false, reason: "No verified summary TEE offered an attested Ed25519 key" };
  let request = "";
  let response = "";
  let content: string | undefined;
  const node = e2eeNode(summaryAttest);
  if (node) {
    const client = newClientKeys();
    const modelKey = node.evidence.signingAddress;
    request = requestFor(encryptMessages(messages, modelKey));
    try {
      response = await t.chat(request, { clientPubKey: client.publicKey, modelPubKey: modelKey });
      const sealed = (JSON.parse(response) as Completion).choices?.[0]?.message?.content ?? "";
      content = decryptWith(sealed, client.x25519Secret);
      e2ee = { used: true, modelKey };
    } catch (e) {
      const refused = e2eeRefused(e);
      if (!refused) throw e;
      e2ee = { used: false, reason: refused };
    }
  }
  if (!e2ee.used) {
    // Without E2EE the request can reach any node, so every node must have passed.
    if (!summaryAttest.nodes.every((n) => n.verified)) {
      throw new Error(`End-to-end encryption isn't available and not every summary TEE passed (${failedLabels(modelChecks(summaryAttest))}). Nothing was sent.`);
    }
    request = requestFor(messages);
    response = await t.chat(request);
    content = (JSON.parse(response) as Completion).choices?.[0]?.message?.content;
  }
  const completion = JSON.parse(response) as Completion;
  const notes = notesSchema.parse(JSON.parse(content ?? "null"));

  onStage("signature");
  const sig = await fetchSignature(t, completion.id, SUMMARY_MODEL, wait);
  const modelSigners = attestedKeys(summaryAttest.nodes);
  const gatewaySigners = attestedKeys([summaryAttest.gateway]);
  const signed = responseChecks({ sig, algo: "ed25519", requestBody: request, responseBody: response, model: SUMMARY_MODEL, modelSigners, gatewaySigners });

  const e2eeCheck: TeeCheck = {
    id: "response-e2ee",
    scope: "response",
    label: "Transcript encrypted to the attested model",
    ok: e2ee.used,
    detail: e2ee.used
      ? `Encrypted on this Mac to Ed25519 key ${short(e2ee.modelKey!)}, bound in a verified quote; the reply came back encrypted to a key made for this request`
      : `Not end to end: ${e2ee.reason}. It went over TLS to the attested gateway`,
  };

  const checks = [...gatewayChecks(summaryAttest), ...modelChecks(whisperAttest), ...modelChecks(summaryAttest), ...signed.checks, e2eeCheck];
  // "Verified" means attested and signed. E2EE is shown on its own line.
  const verified = checks.filter((c) => c !== e2eeCheck).every((c) => c.ok);

  // Keep NVIDIA's platform token for the node that signed, so the Verify page can check it.
  const evidence = [summaryAttest.gateway, ...whisperAttest.nodes, ...summaryAttest.nodes]
    .filter((n): n is VerifiedTee => !!n)
    .map((n) => (n.platformToken && n.evidence.model === SUMMARY_MODEL && signed.signer && n.evidence.signingAddress === strip0x(signed.signer) ? { ...n.evidence, nvidiaToken: n.platformToken } : n.evidence));

  const { meeting, dropped } = buildMeeting({
    id: input.id,
    project: input.project,
    startedAt: input.startedAt,
    durationSec: input.durationSec,
    notes,
    transcript,
    payees: input.payees,
    verified,
  });

  return {
    meeting,
    notes,
    dropped,
    checks,
    proof: {
      version: 2,
      meetingId: input.id,
      summaryModel: SUMMARY_MODEL,
      whisperModel: WHISPER_MODEL,
      attestationNonce: { summary: summaryAttest.nonce, whisper: whisperAttest.nonce },
      signingAlgo: "ed25519",
      attestedSigners: modelSigners,
      gatewaySigners,
      requestHash: sha256Hex(request),
      responseHash: sha256Hex(response),
      signature: sig,
      e2ee,
      checks,
      evidence,
      checkedAt: new Date().toISOString(),
      transcriptHash: sha256Hex(enc.encode(JSON.stringify(transcript))),
      notesHash: sha256Hex(enc.encode(JSON.stringify(notes))),
    },
  };
}

interface Completion {
  id: string;
  choices?: { message?: { content?: string } }[];
}
