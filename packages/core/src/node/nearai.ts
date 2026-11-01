import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createRequire } from "node:module";
import type { NearAiTransport } from "../notes/pipeline.ts";
import type { QuoteReport } from "../tee/checks.ts";

/**
 * NEAR AI Cloud from Node, for `pnpm sample:notes`. It mirrors the Mac app's Rust
 * transport (apps/desktop/src-tauri/src/nearai.rs): the same three calls, the same
 * headers, and the exact response bytes, because the summary's signature covers them.
 * Node only: the app itself never imports this (it isn't exported from the package root).
 */

export const NEAR_AI_BASE = "https://cloud-api.near.ai/v1";
const INTEL_PCS = "https://api.trustedservices.intel.com/tdx/certification/v4";
const NRAS = "https://nras.attestation.nvidia.com/v3/attest/gpu";
const NVIDIA_KEYS = "https://nras.attestation.nvidia.com/.well-known/jwks.json";

/**
 * Verifies a TDX quote against Intel's collateral with Phala's dcap-qvl, the
 * WebAssembly build of the same library the Mac app runs in Rust. Rejects when
 * the quote doesn't verify, so callers fail closed.
 */
export async function verifyQuoteNode(quoteHex: string): Promise<QuoteReport> {
  const { js_get_collateral, js_verify } = createRequire(import.meta.url)("@phala/dcap-qvl-node");
  const raw = Buffer.from(quoteHex.trim().replace(/^0x/i, ""), "hex");
  if (raw.length === 0) throw new Error("That isn't a TDX quote");
  const collateral = await js_get_collateral(INTEL_PCS, raw);
  const r = js_verify(raw, collateral, BigInt(Math.floor(Date.now() / 1000)));
  const td = r?.report?.TD10;
  if (!td) throw new Error("Not a TDX quote");
  return {
    status: String(r.status),
    advisoryIds: r.advisory_ids ?? [],
    reportData: String(td.report_data),
    mrConfigId: String(td.mr_config_id),
    tdAttributes: String(td.td_attributes),
    rtMr3: String(td.rt_mr3),
  };
}

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
    async chat(body, e2ee) {
      // End-to-end encryption headers, as nearai.rs e2ee_headers sends them. There is no plaintext request.
      const encrypted: Record<string, string> = { "x-signing-algo": "ed25519", "x-client-pub-key": e2ee.clientPubKey.toLowerCase(), "x-model-pub-key": e2ee.modelPubKey.toLowerCase(), "x-encryption-version": "2" };
      const res = await doFetch(`${base}/chat/completions`, {
        method: "POST",
        // The signature covers the exact response bytes, so no compression in between.
        headers: { ...auth, ...encrypted, "content-type": "application/json", "accept-encoding": "identity", "x-no-aliasing": "true" },
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
    verifyQuote: (quote) => verifyQuoteNode(quote),
    async nvidiaAttest(payload) {
      const res = await doFetch(NRAS, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: payload, signal: AbortSignal.timeout(60_000) });
      const text = await res.text();
      if (!res.ok) throw new Error(`NVIDIA NRAS ${res.status}: ${text.slice(0, 300)}`);
      return text;
    },
    async nvidiaKeys() {
      const res = await doFetch(NVIDIA_KEYS, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`NVIDIA keys ${res.status}`);
      return res.text();
    },
    randomHex: () => randomBytes(32).toString("hex"),
  };
}
