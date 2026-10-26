import { invoke } from "@tauri-apps/api/core";
import type { AudioChunk, Meeting, NearAiTransport, ProcessResult } from "@aftercall/core";
import type { ProofOnChain } from "./near";

/** NEAR AI through the Rust side, which holds the key in the Keychain. */
export const nearAiTransport: NearAiTransport = {
  transcribe: (path, model, prompt) => invoke<string>("nearai_transcribe", { path, model, prompt }),
  chat: (body) => invoke<string>("nearai_chat", { body }),
  get: (path) => invoke<string>("nearai_get", { path }),
  randomHex: () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join(""),
};

export const nearAiKey = {
  has: () => invoke<boolean>("nearai_has_key"),
  set: (key: string) => invoke<void>("nearai_set_key", { key }),
  clear: () => invoke<void>("nearai_clear_key"),
};

export const recordingFiles = {
  chunks: (id: string) => invoke<AudioChunk[]>("list_chunks", { id }),
  saveNotes: (id: string, notes: string) => invoke<void>("save_notes", { id, notes }),
  deleteAudio: (id: string) => invoke<number>("delete_audio", { id }),
};

/** What `notes.json` holds: the meeting plus everything the Verify page and NEAR proof need. */
export type SavedNotes = Omit<ProcessResult, "meeting"> & {
  meeting: Meeting;
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
