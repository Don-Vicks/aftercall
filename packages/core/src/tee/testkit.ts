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
export const COMPOSE = '{"docker_compose_file":"services:\\n  vllm:\\n    image: nearaidev/vllm@sha256:00"}';

/** A quote as the Rust side reports it after dcap-qvl verified it. Encoded as the "quote" hex. */
export function quoteFor(key: TeeKey, nonce: string, over: Partial<QuoteReport> = {}): QuoteReport {
  return {
    status: "UpToDate",
    advisoryIds: [],
    reportData: expectedReportData(key.address, nonce),
    mrConfigId: expectedMrConfig(sha256Hex(COMPOSE)),
    tdAttributes: "0000001000000000",
    rtMr3: replayRtmr3(EVENT_LOG).rtmr3,
    ...over,
  };
}

export const encodeQuote = (q: QuoteReport) => bytesToHex(utf8ToBytes(JSON.stringify(q)));
export const decodeQuote = (hex: string): QuoteReport => JSON.parse(new TextDecoder().decode(Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)))));

export function attestationFor(key: TeeKey, nonce: string, opts: { quote?: Partial<QuoteReport>; gpu?: boolean; nonceInPayload?: string } = {}): TeeAttestation {
  return {
    signing_address: key.address,
    signing_algo: key.algo,
    ...(key.publicKey ? { signing_public_key: key.publicKey } : {}),
    request_nonce: nonce,
    intel_quote: encodeQuote(quoteFor(key, nonce, opts.quote)),
    event_log: JSON.stringify(EVENT_LOG),
    info: { tcb_info: JSON.stringify({ app_compose: COMPOSE }) },
    ...(opts.gpu === false ? {} : { nvidia_payload: JSON.stringify({ nonce: opts.nonceInPayload ?? nonce, evidence_list: [] }) }),
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
    const platform = await sign({ iss: "https://nras.attestation.nvidia.com", sub: "NVIDIA-PLATFORM-ATTESTATION", eat_nonce: nonce, exp: now + 3600, iat: now, "x-nvidia-overall-att-result": true, ...opts.platform });
    return [["JWT", platform], gpus];
  };
  return { jwks, sign, answer, gpuClaims, now };
}
