import type { Usage } from "../cost.ts";
import { decryptWith } from "../tee/e2ee.ts";

/**
 * Streamed chat completions (stream: true), read from the exact bytes received.
 *
 * What NEAR AI does with a streamed, end-to-end encrypted reply (read in the public
 * source, nearai/inference-proxy and nearai/cloud-api; no live call):
 *
 * - The model TEE's proxy encrypts each chunk on its own: every non-empty
 *   `choices[].delta.content` is a separate ciphertext to the client key, in the same
 *   format as a non-streamed reply. `id`, `finish_reason` and `usage` stay plaintext.
 * - It hashes every byte of the stream it sends (each chunk after encryption) and,
 *   only when the stream ends cleanly with `data: [DONE]`, signs
 *   `model:sha256(request):sha256(stream)` under the chat id, like a non-streamed reply.
 *   Its optional `: keep-alive` comments are not hashed; they are off by default.
 * - With E2EE the gateway forwards the stream byte for byte (no re-serialising).
 *
 * So the response check hashes the whole stream exactly as received, the same check as
 * for a non-streamed body, and everything read here comes from those same bytes. A
 * stream with anything the signature doesn't cover fails that check; nothing is
 * stripped to make it pass.
 */

/** How much of a streamed reply has arrived, as the transport counts it. */
export interface StreamProgress {
  bytes: number;
  /** `data:` events so far: about one token each. */
  events: number;
  /** Output tokens so far, when the chunks report usage. */
  outputTokens?: number;
}

/** A streamed reply put back together; `pieces` are the encrypted content of each chunk, in order. */
export interface ParsedStream {
  id: string;
  pieces: string[];
  finishReason: string | null;
  usage?: Usage;
}

interface Chunk {
  id?: unknown;
  choices?: { index?: number; delta?: { content?: unknown } | null; finish_reason?: string | null }[];
  usage?: Usage | null;
  error?: { message?: unknown } | string;
}

/**
 * Parses a server-sent event stream of chat completion chunks. Throws when it isn't
 * one, when NEAR AI sent an error event, when the chunks disagree on the chat id, or
 * when it ended before `data: [DONE]` (then nothing was signed either).
 */
export function parseChatStream(body: string): ParsedStream {
  const events: string[] = [];
  let data: string[] = [];
  // Per the SSE format: lines end in \n, \r\n or \r; a blank line ends an event; an event's
  // data lines join with \n. Comment lines (":") and other fields carry no data.
  for (const line of body.split(/\r\n|\r|\n/)) {
    if (line === "") {
      if (data.length) events.push(data.join("\n"));
      data = [];
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (data.length) events.push(data.join("\n"));

  let id = "";
  let done = false;
  let finishReason: string | null = null;
  let usage: Usage | undefined;
  const pieces: string[] = [];
  for (const event of events) {
    if (done) throw new Error("NEAR AI sent more after the end of the reply.");
    if (event.trim() === "[DONE]") {
      done = true;
      continue;
    }
    let chunk: Chunk;
    try {
      chunk = JSON.parse(event) as Chunk;
    } catch {
      throw new Error("NEAR AI sent a part of the reply that isn't JSON.");
    }
    if (chunk.error !== undefined) {
      const message = typeof chunk.error === "string" ? chunk.error : String(chunk.error?.message ?? "no reason given");
      throw new Error(`NEAR AI stopped the reply partway: ${message.slice(0, 200)}`);
    }
    if (typeof chunk.id === "string" && chunk.id) {
      if (id && chunk.id !== id) throw new Error("The parts of the reply name different chat ids.");
      id = chunk.id;
    }
    for (const choice of chunk.choices ?? []) {
      if ((choice.index ?? 0) !== 0) continue;
      const content = choice.delta?.content;
      if (typeof content === "string" && content !== "") pieces.push(content);
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
    if (chunk.usage) usage = chunk.usage;
  }
  if (events.length === 0) throw new Error("NEAR AI didn't stream the reply.");
  if (!done) throw new Error("The reply stopped before it was finished, so it wasn't signed. Nothing was saved.");
  if (!id) throw new Error("The reply has no chat id, so its signature can't be fetched.");
  return { id, pieces, finishReason, ...(usage ? { usage } : {}) };
}

/** The reply's text: each chunk's content decrypted on its own, then joined. Throws if any was tampered with. */
export function decryptPieces(pieces: string[], x25519Secret: Uint8Array): string {
  return pieces.map((p) => decryptWith(p, x25519Secret)).join("");
}
