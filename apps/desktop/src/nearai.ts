import { Channel, invoke } from "@tauri-apps/api/core";
import type { AudioChunk, CostEstimate, Meeting, NotesTransport, ProcessResult, ProofBundle, QuoteReport, StreamProgress, TeeCheck, TranscriptCache } from "@aftercall/core";
import type { ProofOnChain } from "./near";

/**
 * NEAR AI, Intel PCS and NVIDIA NRAS through the Rust side, which holds the key
 * in the Keychain and can reach services that don't allow browser requests.
 */
export const nearAiTransport: NotesTransport = {
  // Rust uploads only over TLS whose certificate carries `tlsPin`, the gateway's attested key.
  transcribe: (path, model, prompt, tlsPin) => invoke<string>("nearai_transcribe", { path, model, prompt, tlsPin }),
  chat: (body, e2ee) => invoke<string>("nearai_chat", { body, e2ee }),
  // The notes, streamed: Rust keeps every byte for the signature check and sends counts as they arrive.
  chatStream: (body, e2ee, onProgress) => {
    const onProgressChannel = new Channel<StreamProgress>();
    if (onProgress) onProgressChannel.onmessage = onProgress;
    return invoke<string>("nearai_chat_stream", { body, e2ee, onProgress: onProgressChannel });
  },
  get: (path) => invoke<string>("nearai_get", { path }),
  verifyQuote: (quote) => invoke<QuoteReport>("tee_verify_quote", { quote }),
  nvidiaAttest: (payload) => invoke<string>("tee_nvidia_attest", { payload }),
  nvidiaKeys: () => invoke<string>("tee_nvidia_keys"),
  randomHex: () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join(""),
};

export const nearAiKey = {
  has: () => invoke<boolean>("nearai_has_key"),
  set: (key: string) => invoke<void>("nearai_set_key", { key }),
  clear: () => invoke<void>("nearai_clear_key"),
  /** Last four characters of the saved key, or null. */
  hint: () => invoke<string | null>("nearai_key_hint"),
  /** Asks NEAR AI whether the key works, without spending anything. */
  check: (key: string) => invoke<"valid" | "invalid" | "unknown">("nearai_check_key", { key }),
};

/** Keeps each chunk's transcription next to the recording until the notes are saved. */
export function transcriptCache(recordingId: string): TranscriptCache {
  const name = (c: AudioChunk) => c.path.split("/").pop()!.replace(/\.wav$/, "");
  return {
    get: (c) => invoke<string | null>("read_chunk_transcript", { id: recordingId, chunk: name(c) }),
    set: (c, raw) => invoke<void>("write_chunk_transcript", { id: recordingId, chunk: name(c), raw }),
  };
}

export const recordingFiles = {
  chunks: (id: string) => invoke<AudioChunk[]>("list_chunks", { id }),
  saveNotes: (id: string, notes: string) => invoke<void>("save_notes", { id, notes }),
  deleteAudio: (id: string) => invoke<number>("delete_audio", { id }),
};

/**
 * What `notes.json` holds: the meeting plus everything the Verify page and NEAR
 * proof need. Notes made before full attestation checks have a version 1 proof
 * and no `checks`; notes made before costs were estimated have no `cost`.
 */
export type SavedNotes = Omit<ProcessResult, "meeting" | "proof" | "checks" | "cost"> & {
  meeting: Meeting;
  proof: ProofBundle;
  checks?: TeeCheck[];
  /** What making these notes probably cost in NEAR AI credit. Not in the proof. */
  cost?: CostEstimate;
  processedAt: string;
  /** Set once the proof is recorded on NEAR. */
  onChain?: ProofOnChain;
};

// USDC amounts are bigints; JSON stores them as strings.
export function serializeNotes(notes: SavedNotes): string {
  return JSON.stringify(notes, (_k, v) => (typeof v === "bigint" ? { $bigint: v.toString() } : v), 2);
}

export function parseNotes(json: string): SavedNotes {
  return JSON.parse(json, (_k, v) => (v && typeof v === "object" && "$bigint" in v ? BigInt(v.$bigint) : v)) as SavedNotes;
}
