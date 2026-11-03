/**
 * Test doubles for attestation: TEEs with real keys, quotes as the Rust side
 * reports them, and an NVIDIA NRAS that signs real ES384 tokens with a local key.
 * Used by the tests only.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { sha256Hex } from "../notes/verify.ts";
import { expectedMrConfig, expectedReportData, replayRtmr3, type EventLogEntry, type QuoteReport, type SigningAlgo, type TeeAttestation } from "./checks.ts";
import type { Jwks } from "./nvidia.ts";

export const randomNonce = () => bytesToHex(crypto.getRandomValues(new Uint8Array(32)));

/** A TEE signing key: EIP-191 secp256k1 (ecdsa) or Ed25519. */
export function teeKey(algo: SigningAlgo) {
  if (algo === "ecdsa") {
    const priv = secp256k1.utils.randomPrivateKey();
    const address = `0x${bytesToHex(keccak_256(secp256k1.getPublicKey(priv, false).slice(1)).slice(-20))}`;
    const sign = (m: string) => {
      const b = utf8ToBytes(m);
      const s = secp256k1.sign(keccak_256(new Uint8Array([...utf8ToBytes(`\x19Ethereum Signed Message:\n${b.length}`), ...b])), priv);
      return `0x${bytesToHex(s.toCompactRawBytes())}${(27 + s.recovery).toString(16)}`;
    };
    return { algo, address, publicKey: undefined as string | undefined, seed: undefined as Uint8Array | undefined, sign };
  }
  const seed = ed25519.utils.randomPrivateKey();
  const publicKey = bytesToHex(ed25519.getPublicKey(seed));
  return { algo, address: publicKey, publicKey, seed, sign: (m: string) => bytesToHex(ed25519.sign(utf8ToBytes(m), seed)) };
}
export type TeeKey = ReturnType<typeof teeKey>;

export const EVENT_LOG: EventLogEntry[] = [
  { imr: 0, event_type: 1, digest: "", event: "boot", event_payload: "00" },
  { imr: 3, event_type: 134217729, event: "app-id", event_payload: "abcd" },
  { imr: 3, event_type: 134217729, event: "compose-hash", event_payload: "0102" },
];
export const IMAGE_DIGEST = "f75c2a8f1a3d8a36ed6cd7479e848edf0a0e814381d7b83993a703201594bc14";
export const COMPOSE = `{"docker_compose_file":"services:\\n  vllm:\\n    image: nearaidev/vllm@sha256:${IMAGE_DIGEST}"}`;
/** A gateway TLS key fingerprint: sha256 of a certificate's SPKI DER, in hex. */
export const GATEWAY_TLS = sha256Hex("gateway SPKI DER");

/** A quote as the Rust side reports it after dcap-qvl verified it. Encoded as the "quote" hex. */
export function quoteFor(key: TeeKey, nonce: string, over: Partial<QuoteReport> = {}, tls?: string): QuoteReport {
  return {
    status: "UpToDate",
    advisoryIds: [],
    reportData: expectedReportData(key.address, nonce, tls),
    mrConfigId: expectedMrConfig(sha256Hex(COMPOSE)),
    tdAttributes: "0000001000000000",
    rtMr3: replayRtmr3(EVENT_LOG).rtmr3,
    ...over,
  };
}

export const encodeQuote = (q: QuoteReport) => bytesToHex(utf8ToBytes(JSON.stringify(q)));
export const decodeQuote = (hex: string): QuoteReport => JSON.parse(new TextDecoder().decode(Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)))));

/**
 * One TEE's attestation. `tls`: a TLS key fingerprint bound into the report data and
 * sent as `tls_cert_fingerprint` (`tlsSent` sends another one instead). `gpus`: how many
 * GPUs the evidence is for (NRAS answers for 2 by default).
 */
export function attestationFor(
  key: TeeKey,
  nonce: string,
  opts: { quote?: Partial<QuoteReport>; gpu?: boolean; nonceInPayload?: string; tls?: string; tlsSent?: string; gpus?: number } = {},
): TeeAttestation {
  const sent = opts.tlsSent ?? opts.tls;
  return {
    signing_address: key.address,
    signing_algo: key.algo,
    ...(key.publicKey ? { signing_public_key: key.publicKey } : {}),
    request_nonce: nonce,
    intel_quote: encodeQuote(quoteFor(key, nonce, opts.quote, opts.tls)),
    event_log: JSON.stringify(EVENT_LOG),
    info: { tcb_info: JSON.stringify({ app_compose: COMPOSE }) },
    ...(sent ? { tls_cert_fingerprint: sent } : {}),
    ...(opts.gpu === false
      ? {}
      : { nvidia_payload: JSON.stringify({ nonce: opts.nonceInPayload ?? nonce, evidence_list: Array.from({ length: opts.gpus ?? 2 }, (_, i) => ({ certificate: `cert-${i}`, evidence: `ev-${i}`, arch: "HOPPER" })) }) }),
  };
}

const b64url = (b: Uint8Array | string) => Buffer.from(b).toString("base64url");

/** NVIDIA NRAS with a local ES384 key standing in for NVIDIA's. */
export async function fakeNras() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const kid = "nv-eat-kid-test";
  const jwks: Jwks = { keys: [{ kty: "EC", crv: "P-384", kid, x: jwk.x, y: jwk.y }] };
  const sign = async (claims: object, opts: { kid?: string } = {}) => {
    const head = b64url(JSON.stringify({ alg: "ES384", typ: "JWT", kid: opts.kid ?? kid }));
    const body = b64url(JSON.stringify(claims));
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-384" }, pair.privateKey, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
  };
  const now = Math.floor(Date.now() / 1000);
  const gpuClaims = (nonce: string) => ({
    iss: "https://nras.attestation.nvidia.com",
    eat_nonce: nonce,
    exp: now + 3600,
    iat: now,
    hwmodel: "GH100 A01 GSP BROM",
    ueid: "642960189298007511250958030500749152730221142468",
    secboot: true,
    dbgstat: "disabled",
    measres: "success",
    "x-nvidia-gpu-driver-rim-signature-verified": true,
    "x-nvidia-gpu-attestation-report-cert-chain-validated": true,
    "x-nvidia-attestation-warning": null,
  });
  /** NRAS's answer for `gpus` GPUs, each overridable. */
  const answer = async (nonce: string, opts: { gpus?: number; gpu?: object; platform?: object } = {}) => {
    const gpus: Record<string, string> = {};
    for (let i = 0; i < (opts.gpus ?? 2); i++) gpus[`GPU-${i}`] = await sign({ ...gpuClaims(nonce), ...opts.gpu });
    const submods = Object.fromEntries(Object.keys(gpus).map((name) => [name, ["DIGEST", ["SHA-256", sha256Hex(gpus[name])]]]));
    const platform = await sign({ iss: "https://nras.attestation.nvidia.com", sub: "NVIDIA-PLATFORM-ATTESTATION", eat_nonce: nonce, exp: now + 3600, iat: now, "x-nvidia-overall-att-result": true, submods, ...opts.platform });
    return [["JWT", platform], gpus];
  };
  return { jwks, sign, answer, gpuClaims, now };
}

/**
 * A streamed chat completion as NEAR AI's model proxy sends it under E2EE: one SSE
 * event per piece, each piece's `delta.content` encrypted to the client on its own
 * (`encrypt`), a role-only first chunk with empty content (sent as is), the finish
 * reason and running usage in plaintext, then `data: [DONE]`.
 */
export function sseStream(
  pieces: string[],
  opts: { id?: string; finishReason?: string; usage?: object; encrypt?: (s: string) => string; done?: boolean; lineEnd?: string } = {},
): string {
  const id = opts.id ?? "chatcmpl-42";
  const nl = opts.lineEnd ?? "\n";
  const event = (o: object) => `data: ${JSON.stringify(o)}${nl}${nl}`;
  const base = { id, object: "chat.completion.chunk", created: 1793006441, model: "Qwen/Qwen3.8-27B" };
  let out = event({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  pieces.forEach((p, i) => {
    const last = i === pieces.length - 1;
    out += event({
      ...base,
      choices: [{ index: 0, delta: { content: opts.encrypt ? opts.encrypt(p) : p }, finish_reason: last ? (opts.finishReason ?? "stop") : null }],
      ...(opts.usage ? { usage: { ...opts.usage, completion_tokens: i + 1 } } : {}),
    });
  });
  if (opts.usage) out += event({ ...base, choices: [], usage: opts.usage });
  if (opts.done !== false) out += `data: [DONE]${nl}${nl}`;
  return out;
}

/** `text` cut into pieces of about `size` characters, as a model streams it. */
export function piecesOf(text: string, size = 7): string[] {
  const chars = Array.from(text);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(""));
  return out.length ? out : [""];
}
