import { buildMeeting, type Dropped, type Payee } from "./build.ts";
import { NOTES_SYSTEM_PROMPT, OVERALL_SYSTEM_PROMPT, SECTION_PROMPT, notesJsonSchema, notesSchema, overallJsonSchema, overallSchema, type Notes } from "./schema.ts";
import { mergeSectionNotes, overallRequestText, planSections, sectionHeading, type Section } from "./sections.ts";
import { decryptPieces, parseChatStream, type StreamProgress } from "./stream.ts";
import { mergeTranscript, numberedTranscript, type TranscribedChunk, type WhisperResult } from "./transcript.ts";
import { sha256Hex, yourNotesHash } from "./verify.ts";
import { attestModel, attestedKeys, failedLabels, gatewayChecks, loadNvidiaKeys, modelChecks, type ModelAttestation, type TeeEvidence, type TeeTransport, type VerifiedTee } from "../tee/attest.ts";
import { responseChecks, short, signingIdentity, strip0x, type SignatureResponse, type TeeCheck } from "../tee/checks.ts";
import { encryptMessages, newClientKeys } from "../tee/e2ee.ts";
import type { Meeting, NoticeLog, Speaker } from "../meeting.ts";
import { estimateCost, type CostEstimate, type Usage } from "../cost.ts";
import { e2eeStaleKey, isNearAiAccountError, nearAiErrorText, nearAiStatus } from "../errors.ts";

export const WHISPER_MODEL = "openai/whisper-large-v3";
export const SUMMARY_MODEL = "Qwen/Qwen3.8-27B";
/** Same Confidential TEE tier; used if the main model is unavailable. Smaller output cap. */
export const FALLBACK_SUMMARY_MODEL = "Qwen/Qwen3.6-35B-A3B-FP8";

/**
 * Output cap for the notes call of a call that goes in one request. Generous until
 * output is measured on live runs: Qwen3.8-27B allows 65,536 output tokens, so an
 * uncapped call could cost about $0.09.
 */
export const SUMMARY_MAX_TOKENS = 12_288;
/** Output cap for each part of a long call: one part is at most about 25 minutes. */
export const SECTION_MAX_TOKENS = 4_096;
/** Output cap for the overall title and summary of a long call. */
export const OVERALL_MAX_TOKENS = 512;
/** Part requests of a long call in flight at once. */
export const SECTIONS_AT_ONCE = 4;

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
  /** POST /v1/chat/completions with exactly these bytes and the E2EE headers; returns exactly the bytes received. */
  chat(body: string, e2ee: E2eeKeys): Promise<string>;
}

/**
 * What the notes pipeline needs: the same, plus a streamed chat. The notes are long
 * to write, and a stream has no long silent wait for a timeout to cut.
 */
export interface NotesTransport extends NearAiTransport {
  /**
   * POST /v1/chat/completions (a `stream: true` body) with exactly these bytes and the
   * E2EE headers; returns exactly the bytes of the event stream received, once it has
   * ended. Stops when nothing arrives for a while, not after a total time.
   */
  chatStream(body: string, e2ee: E2eeKeys, onProgress?: (p: StreamProgress) => void): Promise<string>;
}

export interface AudioChunk {
  path: string;
  speaker: Speaker;
  index: number;
}

export type Stage = "attest" | "transcribe" | "summarise" | "signature";

/** How the notes are coming along while the "summarise" stage runs. */
export interface WritingProgress {
  /** Parts the transcript is written up in: 1 unless the call is long. */
  sections: number;
  /** Part requests whose reply has fully arrived. */
  sectionsDone: number;
  /** Output tokens received so far, over every request (about one per streamed piece). */
  tokens: number;
  /** The overall summary of a long call is being written. */
  overall?: boolean;
}

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
  /**
   * What YOU typed during the call. Cleaned with `cleanYourNotes`, sent inside the
   * encrypted request as context only, saved on the meeting and covered by a salted
   * hash in the proof.
   */
  yourNotes?: string;
  /** That you told everyone on the call before recording, as you logged it. Goes into the proof as your statement. */
  notice?: NoticeLog;
  /**
   * Names of the people the calendar invited (not you), so the model can spell a name
   * it hears on the call the way the invite does. Sent inside the encrypted request only.
   */
  participants?: string[];
}

/** At most this many invited names go to the model. */
export const PARTICIPANTS_MAX = 40;

/** The invited names as the model gets them: trimmed, at most 80 characters, no repeats, no `<<<`/`>>>`. */
export function cleanParticipants(names: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names ?? []) {
    const name = raw.replace(/<{3,}|>{3,}/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length >= PARTICIPANTS_MAX) break;
  }
  return out;
}

/** The most of your notes that goes to the model and onto the meeting, in characters. */
export const YOUR_NOTES_MAX = 8000;

/**
 * Your notes as the model and the meeting get them: without `<<<` or `>>>` (so they
 * can't close the block they're quoted in), trimmed, and at most 8,000 characters.
 * Undefined when nothing is left.
 */
export function cleanYourNotes(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let text = raw.replace(/\r\n?/g, "\n");
  // Again until none are left: removing ">>>" from "<<>>><" would leave "<<<".
  while (/<<<|>>>/.test(text)) text = text.replace(/<{3,}|>{3,}/g, "");
  text = text.trim();
  const capped = Array.from(text).slice(0, YOUR_NOTES_MAX).join("").trimEnd();
  return capped || undefined;
}

/** The user message: project, payees, invited people (when known), your notes (when there are any), then the transcript. */
export function summaryRequestText(project: string, payees: Payee[], transcript: string, yourNotes?: string, participants: string[] = []): string {
  const payeeList = payees.map((p) => `${p.name} (${p.account})`);
  const people = participants.length ? `Participants (from the calendar invite, besides you): ${JSON.stringify(participants)}\n` : "";
  const notesBlock = yourNotes ? `Your notes (typed by you during the call; context only):\n<<<\n${yourNotes}\n>>>\n\n` : "";
  return `Project: ${project}\nPayees: ${JSON.stringify(payeeList)}\n${people}\n${notesBlock}Transcript:\n${transcript}`;
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
  /**
   * Why it wasn't used, when it wasn't. Only in proofs from earlier versions, which
   * could send the transcript over TLS; the app now sends it encrypted or not at all.
   */
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
  /**
   * `yourNotesHash(salt, meeting.yourNotes)`, only when you typed notes during the call.
   * The salt stays in notes.json, never in the bundle. Bundles without notes leave the
   * key out, so they hash exactly as before it existed.
   */
  yourNotesHash?: string;
  /**
   * How many items the model proposed that the app dropped because their quote wasn't
   * in the transcript. A statement the app recorded, covered by the hash on NEAR; it
   * can't be re-run from the bundle. Older bundles lack the key and hash as before.
   */
  dropped?: DroppedCounts;
  /** The notice you logged before recording, when you did. Absent otherwise, so older bundles hash as before. */
  notice?: NoticeLog;
}

export interface DroppedCounts {
  decisions: number;
  actionItems: number;
  followUps: number;
}

/** One encrypted chat request of a long call's notes, as the proof keeps it. */
export interface ChatCallRecord {
  /** "section": the notes for one part of the transcript; "overall": the title and summary from the parts' summaries. */
  role: "section" | "overall";
  /** For a section, which part (from 1). */
  part?: number;
  /** sha256 of the exact request bytes sent and of the exact event stream received, as signed by the enclave. */
  requestHash: string;
  responseHash: string;
  signature: SignatureResponse;
}

/**
 * Proofs of a long call's notes, written in several encrypted requests (one per part,
 * then one for the overall summary). The same as version 2, except that every request's
 * hashes and signature are in `calls` instead of one pair at the top. Every request was
 * encrypted to `e2ee.modelKey`, from the attestation behind `attestationNonce.summary`.
 * `notesHash` covers the notes the app merged from the parts (see `mergeSectionNotes`).
 */
export interface ProofBundleV3 extends Omit<ProofBundleV2, "version" | "requestHash" | "responseHash" | "signature"> {
  version: 3;
  calls: ChatCallRecord[];
}

export type ProofBundle = ProofBundleV1 | ProofBundleV2 | ProofBundleV3;

/** Proofs with the full attestation checks and statements: version 2, and version 3 for long calls. */
export const hasFullChecks = (b: ProofBundle | undefined): b is ProofBundleV2 | ProofBundleV3 => b?.version === 2 || b?.version === 3;

export interface ProcessResult {
  meeting: Meeting;
  /** The model's notes exactly as returned (decrypted); their hash is in the proof. */
  notes: Notes;
  dropped: Dropped[];
  /** Everything checked for this meeting, in panel order. */
  checks: TeeCheck[];
  /** Version 2 when the notes took one request, version 3 when a long call took several. */
  proof: ProofBundleV2 | ProofBundleV3;
  /**
   * The random salt behind `proof.yourNotesHash`, when there are your notes. Saved only
   * in notes.json (encrypted on the Mac), never in the proof or its public link.
   */
  yourNotesSalt?: string;
  /** What this run probably cost in NEAR AI credit. Not in the proof. */
  cost: CostEstimate;
}

const enc = new TextEncoder();

/**
 * Everything that must pass before audio or text leaves the Mac. Throws in plain words
 * if not. Returns the verified summary node the transcript will be encrypted to.
 */
function requireAttested(summary: ModelAttestation, whisper: ModelAttestation): VerifiedTee {
  const gw = gatewayChecks(summary);
  if (!gw.every((c) => c.ok)) throw new Error(`Secure hardware check failed for the NEAR AI gateway (${failedLabels(gw)}). Nothing was sent.`);
  // Audio can't be pinned to one Whisper node, so every node must pass.
  const w = modelChecks(whisper);
  if (!w.every((c) => c.ok)) throw new Error(`Secure hardware check failed for Whisper (${failedLabels(w)}). Nothing was sent.`);
  if (!summary.nodes.some((n) => n.verified)) {
    throw new Error(`Secure hardware check failed for the summary model (${failedLabels(modelChecks(summary))}). Nothing was sent.`);
  }
  // The transcript only ever goes end-to-end encrypted, so without a key nothing goes, audio included.
  const node = e2eeNode(summary);
  if (!node) throw new Error("No attested summary node offered a key for end-to-end encryption, so nothing was sent.");
  return node;
}

/** A verified summary node whose E2EE key is the key bound in its quote. */
export function e2eeNode(summary: ModelAttestation): VerifiedTee | undefined {
  return summary.nodes.find((n) => {
    const key = strip0x(n.att.signing_public_key ?? "");
    return n.verified && /^[0-9a-f]{64}$/.test(key) && key === signingIdentity(n.att);
  });
}


/** An OpenAI-style chat completion: the parts the app reads. Under E2EE only `content` is encrypted. */
export interface Completion {
  id: string;
  choices?: { message?: { content?: string }; finish_reason?: string | null }[];
  usage?: Usage;
}

/**
 * Throws when the reply was cut off at max_tokens: half a JSON object is useless, and
 * a cut list could silently miss a payment. `consequence` finishes the sentence.
 */
export function requireComplete(completion: Completion, maxTokens: number, consequence: string): void {
  if (completion.choices?.[0]?.finish_reason === "length") {
    throw new Error(`The model's reply hit the ${maxTokens.toLocaleString("en-US")}-token limit, so ${consequence}`);
  }
}

const NOTES_CUT = "the notes would be incomplete. Nothing was saved.";

/**
 * Seconds of audio Whisper bills for one chunk: Whisper's `duration`. When it's
 * missing, the chunk's length inferred from the recording (every chunk is
 * `chunkSeconds` long except the last), which is what was uploaded.
 */
function billedSeconds(result: WhisperResult, chunk: AudioChunk, input: ProcessInput): number {
  if (typeof result.duration === "number" && Number.isFinite(result.duration) && result.duration >= 0) return Math.ceil(result.duration);
  const inferred = Math.min(input.chunkSeconds, input.durationSec - chunk.index * input.chunkSeconds);
  const lastSegment = Math.max(0, ...(result.segments ?? []).map((s) => s.end));
  return Math.ceil(inferred > 0 ? inferred : lastSegment);
}

/** Only the fields a notice log has, so nothing else can slip into the hashed bundle. */
function cleanNotice(n: NoticeLog | undefined): NoticeLog | undefined {
  if (!n || n.by !== "you" || typeof n.at !== "string" || !n.at) return undefined;
  return { by: "you", at: n.at, ...(n.how ? { how: n.how } : {}) };
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

/** One encrypted, streamed chat request: what to send and how to read it. */
interface CallSpec {
  role: "notes" | "section" | "overall";
  /** For a section, which part (from 1). */
  part?: number;
  messages: { role: string; content: string }[];
  maxTokens: number;
  schemaName: string;
  schema: object;
}

/** One request as sent and received: exact bytes, the decrypted reply, and its plaintext metadata. */
interface CallResult {
  spec: CallSpec;
  request: string;
  response: string;
  content: string;
  id: string;
  usage?: Usage;
}

/** Runs `jobs` with at most `limit` in flight; settles every one, like Promise.allSettled. */
async function settleAll<T>(jobs: (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await jobs[i]() };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

/** Usage summed over several calls to the same model, for one cost estimate. Undefined if any call reported none. */
function sumUsage(usages: (Usage | undefined)[]): Usage | undefined {
  if (usages.some((u) => !u)) return undefined;
  const all = usages as Usage[];
  const reasoning = all.map((u) => u.completion_tokens_details?.reasoning_tokens);
  return {
    prompt_tokens: all.reduce((s, u) => s + (u.prompt_tokens || 0), 0),
    completion_tokens: all.reduce((s, u) => s + (u.completion_tokens || 0), 0),
    ...(reasoning.some((r) => typeof r === "number") ? { completion_tokens_details: { reasoning_tokens: reasoning.reduce<number>((s, r) => s + (r ?? 0), 0) } } : {}),
  };
}

/**
 * Recording -> verified notes: verify the gateway TEE and every Whisper and summary
 * model TEE (Intel TDX quote, key and nonce binding, boot log, compose, NVIDIA GPUs)
 * before anything leaves the Mac; transcribe every chunk of both stems; write the notes
 * into the strict schema, end-to-end encrypted to the attested summary TEE and streamed
 * back; check every reply's signature; keep only items backed by an exact quote; and
 * assemble the proof bundle for NEAR.
 *
 * A call up to `SPLIT_ABOVE_SECONDS` / `SPLIT_ABOVE_TOKENS` takes one notes request. A
 * longer one is written up in parts (`planSections`): one request per part, a few at a
 * time, then one short request for the overall title and summary from the parts'
 * summaries; the parts' items are merged (`mergeSectionNotes`) and every quote is still
 * checked against the whole transcript. Each request is encrypted, signed and checked
 * like the one request of a short call, and all of them are in the proof.
 */
export async function processRecording(
  t: NotesTransport,
  input: ProcessInput,
  onStage: (stage: Stage, detail?: string, progress?: WritingProgress) => void = () => {},
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<ProcessResult> {
  onStage("attest");
  const jwks = await loadNvidiaKeys(t);
  // Ed25519 for the summary model: its key is both the E2EE key and the response signer.
  const [firstSummaryAttest, whisperAttest] = await Promise.all([
    attestModel(t, SUMMARY_MODEL, "ed25519", { withGateway: true, jwks }),
    attestModel(t, WHISPER_MODEL, "ecdsa", { withGateway: false, jwks }),
  ]);
  // Replaced if NEAR AI asks for a fresh attestation before the notes are written.
  let summaryAttest = firstSummaryAttest;
  const node = requireAttested(summaryAttest, whisperAttest);

  const prompt = input.vocabulary.filter(Boolean).join(", ");
  const transcribed: TranscribedChunk[] = [];
  // Only audio sent in this run costs anything: cached chunks were paid for earlier.
  let whisperSeconds = 0;
  for (const [i, chunk] of input.chunks.entries()) {
    onStage("transcribe", `${i + 1} of ${input.chunks.length}`);
    let raw = (await input.transcriptCache?.get(chunk).catch(() => null)) ?? null;
    const fresh = raw === null;
    if (raw === null) {
      raw = await t.transcribe(chunk.path, WHISPER_MODEL, prompt);
      await input.transcriptCache?.set(chunk, raw).catch(() => {});
    }
    const result = JSON.parse(raw) as WhisperResult;
    if (fresh) whisperSeconds += billedSeconds(result, chunk, input);
    transcribed.push({ speaker: chunk.speaker, index: chunk.index, result });
  }
  const transcript = mergeTranscript(transcribed, input.chunkSeconds);

  const yourNotes = cleanYourNotes(input.yourNotes);
  const participants = cleanParticipants(input.participants);
  const sections = planSections(transcript);
  const split = sections.length > 1;
  const userText = (s: Section, i: number) =>
    `${split ? `${sectionHeading(s, i, sections.length)}\n` : ""}${summaryRequestText(input.project, input.payees, numberedTranscript(s.lines, s.context), yourNotes, participants)}`;
  const notesSpecs: CallSpec[] = sections.map((s, i) => ({
    role: split ? "section" : "notes",
    ...(split ? { part: i + 1 } : {}),
    messages: [
      { role: "system", content: split ? `${NOTES_SYSTEM_PROMPT} ${SECTION_PROMPT}` : NOTES_SYSTEM_PROMPT },
      { role: "user", content: userText(s, i) },
    ],
    maxTokens: split ? SECTION_MAX_TOKENS : SUMMARY_MAX_TOKENS,
    schemaName: "meeting_notes",
    schema: notesJsonSchema,
  }));

  // Progress while the notes are written: output tokens per request, parts finished.
  const tokens: number[] = [];
  let sectionsDone = 0;
  let overallRunning = false;
  const progress = () =>
    onStage("summarise", undefined, { sections: sections.length, sectionsDone, tokens: tokens.reduce((a, b) => a + (b || 0), 0), ...(overallRunning ? { overall: true } : {}) });
  onStage("summarise", undefined, { sections: sections.length, sectionsDone: 0, tokens: 0 });

  /**
   * One request encrypted to `tee`'s attested key and streamed back. End-to-end
   * encryption: the text is encrypted here, so the gateway only relays ciphertext,
   * and every piece of the reply comes back encrypted to a key made for this request.
   */
  const send = async (tee: VerifiedTee, spec: CallSpec, slot: number): Promise<CallResult> => {
    const client = newClientKeys();
    const key = tee.evidence.signingAddress;
    const request = JSON.stringify({
      model: SUMMARY_MODEL,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: spec.maxTokens,
      // No thinking first: pulling decisions and items out of a transcript doesn't need it,
      // and on a long call the reasoning alone ran past NEAR AI's 10-minute limit. Every
      // item still has to quote the transcript exactly. A plaintext control, like max_tokens.
      chat_template_kwargs: { enable_thinking: false },
      messages: encryptMessages(spec.messages, key),
      response_format: { type: "json_schema", json_schema: { name: spec.schemaName, strict: true, schema: spec.schema } },
    });
    const response = await t.chatStream(request, { clientPubKey: client.publicKey, modelPubKey: key }, (p) => {
      tokens[slot] = p.outputTokens ?? p.events;
      progress();
    });
    const reply = parseChatStream(response);
    // finish_reason sits outside the encrypted content, so this needs no decryption.
    requireComplete({ id: reply.id, choices: [{ finish_reason: reply.finishReason }] }, spec.maxTokens, NOTES_CUT);
    const content = decryptPieces(reply.pieces, client.x25519Secret);
    if (spec.role === "section") sectionsDone++;
    progress();
    return { spec, request, response, content, id: reply.id, ...(reply.usage ? { usage: reply.usage } : {}) };
  };

  /** The JSON in a reply, or a plain error saying which request it was. */
  const readJson = (r: CallResult): unknown => {
    try {
      return JSON.parse(r.content);
    } catch {
      throw new Error(`The model's ${r.spec.role === "section" ? `notes for part ${r.spec.part}` : "notes"} weren't valid JSON. Nothing was saved.`);
    }
  };

  /** Every notes request for this call, all to one attested key; the parts a few at a time. */
  const writeAll = async (tee: VerifiedTee): Promise<{ calls: CallResult[]; notes: Notes }> => {
    tokens.length = 0;
    sectionsDone = 0;
    overallRunning = false;
    if (!split) {
      const only = await send(tee, notesSpecs[0], 0);
      return { calls: [only], notes: notesSchema.parse(readJson(only)) };
    }
    const settled = await settleAll(
      notesSpecs.map((spec, i) => () => send(tee, spec, i)),
      SECTIONS_AT_ONCE,
    );
    const failures = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason);
    // A key NEAR AI no longer serves fails every part sent to it: attest again for all of them.
    if (failures.length) throw failures.find(e2eeStaleKey) ?? failures[0];
    const parts = settled.map((r) => (r as PromiseFulfilledResult<CallResult>).value);
    const partNotes = parts.map((r) => notesSchema.parse(readJson(r)));
    overallRunning = true;
    progress();
    const overallSpec: CallSpec = {
      role: "overall",
      messages: [
        { role: "system", content: OVERALL_SYSTEM_PROMPT },
        { role: "user", content: overallRequestText(input.project, sections, partNotes) },
      ],
      maxTokens: OVERALL_MAX_TOKENS,
      schemaName: "meeting_summary",
      schema: overallJsonSchema,
    };
    const overall = await send(tee, overallSpec, sections.length);
    overallRunning = false;
    return { calls: [...parts, overall], notes: mergeSectionNotes(sections, partNotes, overallSchema.parse(readJson(overall))) };
  };

  /** What to throw for a failed encrypted request: any other 4xx is about the request, so it stops in plain words. */
  const requestError = (e: unknown): unknown => {
    const status = nearAiStatus(e);
    if (status !== null && status >= 400 && status < 500 && !isNearAiAccountError(e)) {
      return new Error(`NEAR AI turned down the encrypted summary request (${status}: ${nearAiErrorText(e) || "no reason given"}). The transcript wasn't sent again.`);
    }
    return e;
  };
  // There is no TLS fallback: if NEAR AI turns the encrypted request down, nothing else is sent.
  let written: { calls: CallResult[]; notes: Notes };
  let modelKey = node.evidence.signingAddress;
  try {
    written = await writeAll(node);
  } catch (e) {
    if (!e2eeStaleKey(e)) throw requestError(e);
    // NEAR AI no longer serves the attested key and asks for a fresh attestation.
    // The node set may have changed: attest again and send encrypted once more, to a
    // key from the new quotes. Every request of a long call goes again, so the proof
    // rests on one attestation.
    summaryAttest = await attestModel(t, SUMMARY_MODEL, "ed25519", { withGateway: true, jwks });
    const gw = gatewayChecks(summaryAttest);
    const fresh = gw.every((c) => c.ok) ? e2eeNode(summaryAttest) : undefined;
    if (!fresh) {
      throw new Error(`NEAR AI asked for a fresh attestation and no summary TEE passed it with an attested key (${failedLabels([...gw, ...modelChecks(summaryAttest)]) || "no attested Ed25519 key"}). The transcript wasn't sent again.`);
    }
    try {
      written = await writeAll(fresh);
      modelKey = fresh.evidence.signingAddress;
    } catch (again) {
      if (e2eeStaleKey(again)) {
        throw new Error(`NEAR AI turned down the encrypted summary request again after a fresh attestation (${nearAiStatus(again)}: ${nearAiErrorText(again)}). The transcript wasn't sent without end-to-end encryption.`);
      }
      throw requestError(again);
    }
  }
  const { calls, notes } = written;
  const e2ee: E2eeRecord = { used: true, modelKey };

  onStage("signature");
  const sigs = await Promise.all(calls.map((c) => fetchSignature(t, c.id, SUMMARY_MODEL, wait)));
  const modelSigners = attestedKeys(summaryAttest.nodes);
  const gatewaySigners = attestedKeys([summaryAttest.gateway]);
  const signedAll = calls.map((c, i) => {
    const r = responseChecks({ sig: sigs[i], algo: "ed25519", requestBody: c.request, responseBody: c.response, model: SUMMARY_MODEL, modelSigners, gatewaySigners });
    if (!split) return r;
    // Several requests: each check says which one it is about.
    const which = c.spec.role === "overall" ? "overall summary" : `part ${c.spec.part}`;
    return { ...r, checks: r.checks.map((ch) => ({ ...ch, id: `${ch.id}-${i + 1}`, label: `${ch.label} · ${which}` })) };
  });
  const signers = new Set(signedAll.map((s) => s.signer && strip0x(s.signer)).filter((s): s is string => !!s));

  const e2eeCheck: TeeCheck = {
    id: "response-e2ee",
    scope: "response",
    label: "Transcript encrypted to the attested model",
    ok: true,
    detail: split
      ? `Each of the ${calls.length} requests was encrypted on this Mac to Ed25519 key ${short(modelKey)}, bound in a verified quote; each reply came back encrypted to a key made for that request`
      : `Encrypted on this Mac to Ed25519 key ${short(modelKey)}, bound in a verified quote; the reply came back encrypted to a key made for this request`,
  };

  const checks = [...gatewayChecks(summaryAttest), ...modelChecks(whisperAttest), ...modelChecks(summaryAttest), ...signedAll.flatMap((s) => s.checks), e2eeCheck];
  // "Verified" means attested and signed. The E2EE line always passes: nothing is sent without it.
  const verified = checks.every((c) => c.ok);

  // Keep NVIDIA's platform token for the node that signed, so the Verify page can check it.
  const evidence = [summaryAttest.gateway, ...whisperAttest.nodes, ...summaryAttest.nodes]
    .filter((n): n is VerifiedTee => !!n)
    .map((n) => (n.platformToken && n.evidence.model === SUMMARY_MODEL && signers.has(n.evidence.signingAddress) ? { ...n.evidence, nvidiaToken: n.platformToken } : n.evidence));

  const { meeting, dropped } = buildMeeting({
    id: input.id,
    project: input.project,
    startedAt: input.startedAt,
    durationSec: input.durationSec,
    notes,
    transcript,
    payees: input.payees,
    verified,
    yourNotes,
  });
  const yourNotesSalt = yourNotes ? t.randomHex() : undefined;
  const notice = cleanNotice(input.notice);
  const count = (kind: Dropped["kind"]) => dropped.filter((d) => d.kind === kind).length;

  const common = {
    meetingId: input.id,
    summaryModel: SUMMARY_MODEL,
    whisperModel: WHISPER_MODEL,
    attestationNonce: { summary: summaryAttest.nonce, whisper: whisperAttest.nonce },
    signingAlgo: "ed25519" as const,
    attestedSigners: modelSigners,
    gatewaySigners,
    e2ee,
    checks,
    evidence,
    checkedAt: new Date().toISOString(),
    transcriptHash: sha256Hex(enc.encode(JSON.stringify(transcript))),
    notesHash: sha256Hex(enc.encode(JSON.stringify(notes))),
    ...(yourNotes && yourNotesSalt ? { yourNotesHash: yourNotesHash(yourNotesSalt, yourNotes) } : {}),
    dropped: { decisions: count("decision"), actionItems: count("action item"), followUps: count("follow-up") },
    ...(notice ? { notice } : {}),
  };
  const proof: ProofBundleV2 | ProofBundleV3 = split
    ? {
        version: 3,
        ...common,
        calls: calls.map((c, i) => ({
          role: c.spec.role === "overall" ? "overall" : "section",
          ...(c.spec.part ? { part: c.spec.part } : {}),
          requestHash: sha256Hex(c.request),
          responseHash: sha256Hex(c.response),
          signature: sigs[i],
        })),
      }
    : { version: 2, ...common, requestHash: sha256Hex(calls[0].request), responseHash: sha256Hex(calls[0].response), signature: sigs[0] };

  return {
    meeting,
    notes,
    dropped,
    checks,
    ...(yourNotesSalt ? { yourNotesSalt } : {}),
    cost: estimateCost({ whisperSeconds, chat: { model: SUMMARY_MODEL, usage: sumUsage(calls.map((c) => c.usage)) } }),
    proof,
  };
}
