import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { NearAiTransport } from "../notes/pipeline.ts";

/**
 * NEAR AI Cloud from Node, for `pnpm sample:notes`. It mirrors the Mac app's Rust
 * transport (apps/desktop/src-tauri/src/nearai.rs): the same three calls, the same
 * headers, and the exact response bytes, because the summary's signature covers them.
 * Node only: the app itself never imports this (it isn't exported from the package root).
 */

export const NEAR_AI_BASE = "https://cloud-api.near.ai/v1";

export class MissingKeyError extends Error {
  constructor() {
    super(
      "No NEAR AI API key. Put NEAR_AI_API_KEY=... in a .env file at the repo root (or export it), then run this again. " +
        "Get a key at https://cloud.near.ai. Nothing was sent anywhere.",
    );
    this.name = "MissingKeyError";
  }
}

/** The key from the environment: NEAR_AI_API_KEY, or NEARAI_API_KEY as the Mac app reads it in development. */
export function apiKeyFrom(env: Record<string, string | undefined>): string {
  const raw = env.NEAR_AI_API_KEY ?? env.NEARAI_API_KEY ?? "";
  const key = raw.trim().replace(/^["']|["']$/g, "").replace(/^Bearer /, "").trim();
  if (!key) throw new MissingKeyError();
  return key;
}

/** Same rule as nearai.rs `check_get_path`: only the attestation report and response signatures. */
export function isAllowedGetPath(path: string): boolean {
  return (path.startsWith("attestation/report?") || path.startsWith("signature/")) && !path.includes("..") && !path.includes("://");
}

/** The body as exact UTF-8 text (no BOM stripping), or an error that names the status. */
async function bodyText(res: Response): Promise<string> {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await res.arrayBuffer());
  if (!res.ok) throw new Error(`NEAR AI ${res.status}: ${text.slice(0, 300)}`);
  return text;
}

export function nodeNearAiTransport(opts: { apiKey: string; baseUrl?: string; fetch?: typeof fetch }): NearAiTransport {
  const base = (opts.baseUrl ?? NEAR_AI_BASE).replace(/\/$/, "");
  const doFetch = opts.fetch ?? fetch;
  const auth = { authorization: `Bearer ${opts.apiKey}` };
  return {
    async transcribe(path, model, prompt) {
      if (!path.endsWith(".wav")) throw new Error("Only WAV recordings can be transcribed");
      const form = new FormData();
      form.append("file", new Blob([await readFile(path)], { type: "audio/wav" }), basename(path));
      form.append("model", model);
      form.append("response_format", "verbose_json");
      if (prompt) form.append("prompt", prompt);
      return bodyText(await doFetch(`${base}/audio/transcriptions`, { method: "POST", headers: auth, body: form, signal: AbortSignal.timeout(180_000) }));
    },
    async chat(body) {
      const res = await doFetch(`${base}/chat/completions`, {
        method: "POST",
        // The signature covers the exact response bytes, so no compression in between.
        headers: { ...auth, "content-type": "application/json", "accept-encoding": "identity", "x-no-aliasing": "true" },
        body,
        signal: AbortSignal.timeout(180_000),
      });
      return bodyText(res);
    },
    async get(path) {
      if (!isAllowedGetPath(path)) throw new Error("Not an allowed NEAR AI path");
      const res = await doFetch(`${base}/${path}`, {
        headers: { ...auth, accept: "application/json", "x-no-aliasing": "true" },
        signal: AbortSignal.timeout(60_000),
      });
      return bodyText(res);
    },
    randomHex: () => randomBytes(32).toString("hex"),
  };
}
