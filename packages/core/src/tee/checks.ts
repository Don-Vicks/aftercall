import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { sha384 } from "@noble/hashes/sha512";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { recoverPersonalSign, sha256Hex } from "../notes/verify.ts";

/**
 * Pure checks behind "Verified", written from NEAR AI's verification docs
 * (docs.near.ai/cloud/verification: model attestations, gateway attestation,
 * quote/nonce/signer bindings, response signatures) and NEAR's TypeScript
 * verifier (nearai/nearai-cloud-verifier). No network here: the desktop app feeds
 * them evidence fetched in Rust, and the public Verify page re-runs what it can.
 *
 * Chain of trust:
 *   our fresh nonce
 *     → Intel TDX quote, verified against Intel's collateral, whose report data
 *       holds the TEE's signing key and our nonce
 *     → the TEE's boot log and Docker compose, measured into the quote
 *     → NVIDIA GPU evidence, verified by NVIDIA NRAS, carrying the same nonce
 *     → the response signature over sha256(request) and sha256(response),
 *       made by a signing key whose own quote verified and bound it.
 */

export type CheckScope = "gateway" | "model" | "response";

/** One line of the Verified panel. */
export interface TeeCheck {
  id: string;
  scope: CheckScope;
  /** For scope "model": which model's TEE. */
  model?: string;
  label: string;
  ok: boolean;
  detail: string;
  /** Passed, but with something to know: Intel says the CPU's TCB is out of date. */
  caution?: boolean;
}

export type SigningAlgo = "ecdsa" | "ed25519";

/** One TEE candidate from GET /v1/attestation/report. */
export interface TeeAttestation {
  signing_address?: string;
  signing_algo?: string;
  signing_public_key?: string;
  request_nonce?: string;
  intel_quote?: string;
  nvidia_payload?: string;
  event_log?: string | EventLogEntry[];
  tls_cert_fingerprint?: string;
  info?: { tcb_info?: string | { app_compose?: string; event_log?: string | EventLogEntry[] } };
  [key: string]: unknown;
}

export interface AttestationReport {
  gateway_attestation?: TeeAttestation;
  model_attestations?: TeeAttestation[];
}

/** What the desktop app's Rust side reads from a quote it verified with dcap-qvl. */
export interface QuoteReport {
  /** Intel TCB status: UpToDate, OutOfDate, Revoked, … */
  status: string;
  advisoryIds: string[];
  reportData: string;
  mrConfigId: string;
  tdAttributes: string;
  rtMr3: string;
}

export interface EventLogEntry {
  imr: number;
  event_type: number;
  digest?: string;
  event?: string;
  event_payload?: string;
}

export const strip0x = (s: string) => s.replace(/^0x/i, "").toLowerCase();
export const short = (s: string) => (s.length > 18 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s);

/** TCB statuses accepted, as NEAR's verifier does: OutOfDate still has valid quote crypto. */
export const ACCEPTED_TCB = ["UpToDate", "OutOfDate"];

function tcbInfo(att: TeeAttestation): { app_compose?: string; event_log?: string | EventLogEntry[] } | undefined {
  const raw = att.info?.tcb_info;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** The app compose exactly as attested: hashed as is, never re-serialised. */
export function appCompose(att: TeeAttestation): string | undefined {
  return tcbInfo(att)?.app_compose;
}

/** The identity bound into report_data: an Ethereum address (ecdsa) or an Ed25519 public key. */
export function signingIdentity(att: TeeAttestation): string {
  return strip0x(att.signing_address ?? "");
}

/**
 * report_data[0..32] = signing identity right-padded with zeros (or, with a TLS
 * fingerprint, sha256(identity || fingerprint)); report_data[32..64] = our nonce.
 * The fingerprint is NEAR AI's `tls_cert_fingerprint`: hex sha256 of the TLS
 * certificate's SubjectPublicKeyInfo DER (docs.near.ai/cloud/verification, TLS).
 */
export function expectedReportData(identity: string, nonce: string, tlsFingerprint?: string): string {
  const id = strip0x(identity);
  const first = tlsFingerprint ? bytesToHex(sha256(new Uint8Array([...hexToBytes(id), ...hexToBytes(strip0x(tlsFingerprint))]))) : id.padEnd(64, "0");
  return `${first}${strip0x(nonce)}`;
}

/**
 * Whether the quote's report data binds `identity` and `nonce`. With a TLS fingerprint
 * the binding is sha256(identity || fingerprint); a model TEE may instead bind the
 * identity alone (padded), which still binds its key. A gateway with a fingerprint must
 * bind it, because the audio connection is pinned to it.
 */
export function bindsIdentity(reportData: string, identity: string, nonce: string, tlsFingerprint: string | undefined, scope: "gateway" | "model"): boolean {
  if (!identity) return false;
  const rd = strip0x(reportData).slice(0, 128);
  if (tlsFingerprint && rd === expectedReportData(identity, nonce, tlsFingerprint)) return true;
  return (!tlsFingerprint || scope === "model") && rd === expectedReportData(identity, nonce);
}

/** A 32-byte hex value, as NEAR AI sends `tls_cert_fingerprint`. */
export const isSha256Hex = (s: string | undefined): s is string => typeof s === "string" && /^[0-9a-f]{64}$/.test(strip0x(s));

/** The container images the compose pins by digest: "nearaidev/cloud-api@sha256:f75c…". */
export function imageDigests(compose: string): string[] {
  return [...new Set([...compose.matchAll(/([A-Za-z0-9][A-Za-z0-9._\/:-]*)@sha256:([0-9a-f]{64})/g)].map((m) => `${m[1]}@sha256:${m[2]}`))];
}

/** mr_config_id = 0x01 || sha256(app_compose) || 15 zero bytes. */
export function expectedMrConfig(composeHash: string): string {
  return `01${composeHash}${"00".repeat(15)}`;
}

/**
 * Replays the TDX event log for RTMR3: for each IMR 3 event, digest =
 * SHA-384(event_type as 4 LE bytes || ":" || event || ":" || payload bytes),
 * RTMR3 = SHA-384(RTMR3 || digest), starting from 48 zero bytes.
 */
export function replayRtmr3(log: EventLogEntry[]): { rtmr3: string; events: number; badDigest: number | null } {
  let rtmr: Uint8Array = new Uint8Array(48);
  let events = 0;
  for (const [i, e] of log.entries()) {
    if (e.imr !== 3) continue;
    const type = new Uint8Array(4);
    new DataView(type.buffer).setUint32(0, e.event_type >>> 0, true);
    const digest = sha384(new Uint8Array([...type, 58, ...utf8ToBytes(e.event ?? ""), 58, ...hexToBytes(strip0x(e.event_payload ?? ""))]));
    if (e.digest && strip0x(e.digest) !== bytesToHex(digest)) return { rtmr3: "", events, badDigest: i };
    rtmr = sha384(new Uint8Array([...rtmr, ...digest]));
    events++;
  }
  return { rtmr3: bytesToHex(rtmr), events, badDigest: null };
}

function parseEventLog(att: TeeAttestation): EventLogEntry[] | null {
  const raw = att.event_log ?? tcbInfo(att)?.event_log;
  if (raw === undefined) return null;
  try {
    const log = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(log) ? log : null;
  } catch {
    return null;
  }
}

/** Labels a check for one of several TEE nodes. */
export interface Where {
  scope: "gateway" | "model";
  model?: string;
  /** 1-based node number when the model runs on more than one TEE. */
  node?: number;
}

const idFor = (w: Where, name: string) => `${w.scope === "gateway" ? "gateway" : `model-${w.model}`}-${name}${w.node ? `-${w.node}` : ""}`;
const labelFor = (w: Where, label: string) => (w.node ? `${label} · node ${w.node}` : label);
export const check = (w: Where, name: string, label: string, ok: boolean, detail: string): TeeCheck => ({
  id: idFor(w, name),
  scope: w.scope,
  ...(w.model ? { model: w.model } : {}),
  label: labelFor(w, label),
  ok,
  detail,
});

/** The CPU-side checks for one TEE: quote, debug bit, key and nonce binding, boot log, compose. */
export function cpuChecks(att: TeeAttestation, nonce: string, quote: QuoteReport | null, quoteError: string | null, w: Where): TeeCheck[] {
  const tcbOk = !!quote && ACCEPTED_TCB.includes(quote.status);
  // OutOfDate still has valid quote crypto (NEAR's verifier accepts it), but Intel has
  // published fixes the CPU doesn't have yet: a pass with a caution, not a plain pass.
  const outOfDate = tcbOk && quote.status !== "UpToDate";
  const tdx = check(
    w,
    "tdx",
    outOfDate ? "Genuine Intel TDX confidential VM, firmware out of date" : "Genuine Intel TDX confidential VM",
    tcbOk,
    quote
      ? `Quote verified against Intel's collateral; TCB ${quote.status}${quote.advisoryIds.length ? ` (${quote.advisoryIds.join(", ")})` : ""}${outOfDate ? ". Caution: Intel has published security updates this CPU's firmware doesn't have yet" : ""}`
      : `Quote didn't verify: ${quoteError ?? "no quote"}`,
  );
  const checks: TeeCheck[] = [outOfDate ? { ...tdx, caution: true } : tdx];
  const attrs = quote ? hexToBytes(strip0x(quote.tdAttributes || "00")) : null;
  checks.push(check(w, "debug", "Debug mode off", !!attrs && (attrs[0] & 1) === 0, attrs ? "The quote's TD attributes have the debug bit clear" : "No verified quote to read"));

  const identity = signingIdentity(att);
  const rd = strip0x(quote?.reportData ?? "");
  const fp = att.tls_cert_fingerprint ? strip0x(att.tls_cert_fingerprint) : undefined;
  // The nonce half is its own check below; this one is about the key.
  const bound = !!quote && bindsIdentity(`${rd.slice(0, 64)}${strip0x(nonce)}`, identity, nonce, fp, w.scope);
  checks.push(
    check(
      w,
      "binds-key",
      "The TEE made its signing key",
      bound,
      identity ? `Quote report data holds signing key ${short(identity)}${fp && bound && rd.slice(0, 64) !== identity.padEnd(64, "0") ? ", together with its TLS key" : ""}` : "No signing key in the attestation",
    ),
  );
  if (w.scope === "gateway") {
    // Audio goes over TLS, not end to end: it is uploaded only on a connection whose
    // certificate key is this one, so the gateway's TLS key must be in its quote.
    const tlsBound = !!quote && isSha256Hex(fp) && !!identity && rd.slice(0, 64) === expectedReportData(identity, nonce, fp).slice(0, 64);
    checks.push(
      check(
        w,
        "tls",
        "Gateway's TLS key is in its quote",
        tlsBound,
        !isSha256Hex(fp)
          ? "The gateway sent no TLS key fingerprint to bind"
          : tlsBound
            ? `Report data binds the TLS certificate's public key (SPKI sha256 ${short(fp)}) with the signing key; audio is uploaded only over a connection presenting that key`
            : "The TLS key fingerprint isn't the one bound in the quote's report data",
      ),
    );
  }
  checks.push(
    check(
      w,
      "binds-nonce",
      "Evidence is fresh",
      !!quote && rd.slice(64, 128) === strip0x(nonce) && strip0x(att.request_nonce ?? "") === strip0x(nonce),
      "Quote report data and the reply hold the nonce made for this check",
    ),
  );

  const log = parseEventLog(att);
  const replay = log ? replayRtmr3(log) : null;
  checks.push(
    check(
      w,
      "rtmr3",
      "Boot log matches the quote",
      !!quote && !!replay && replay.badDigest === null && replay.rtmr3 === strip0x(quote.rtMr3),
      !log
        ? "No event log in the attestation"
        : replay?.badDigest !== null
          ? `Event ${replay?.badDigest} in the log has a wrong digest`
          : `${replay.events} boot events replay to the quote's RTMR3`,
    ),
  );

  const compose = appCompose(att);
  const composeHash = compose ? sha256Hex(compose) : "";
  const images = compose ? imageDigests(compose) : [];
  // This proves the setup file shown is the one measured, not that its images are
  // NEAR's releases: there is no pinned list of NEAR's image digests to check them against.
  checks.push(
    check(
      w,
      "compose",
      "Attested setup file matches the hardware",
      !!quote && !!compose && strip0x(quote.mrConfigId) === expectedMrConfig(composeHash),
      compose
        ? `sha256 of the attested Docker compose (${composeHash.slice(0, 12)}…) is the quote's mr_config. ${
            images.length ? `Images: ${images.map((i) => i.replace(/@sha256:([0-9a-f]{12})[0-9a-f]+$/, "@sha256:$1…")).join(", ")}` : "It names no image by digest"
          }; not checked against a list of NEAR's releases`
        : "No app compose in the attestation",
    ),
  );
  return checks;
}

// ---------- response signature ----------

/** The response signature as GET /v1/signature/{id} returns it. */
export interface SignatureResponse {
  text?: string;
  signature?: string;
  signing_address?: string;
  signing_algo?: string;
  signature_kind?: string;
}

/** Verifies an Ed25519 signature over the UTF-8 bytes of `text`. Signature hex (0x optional) or base64. */
export function verifyEd25519(text: string, signature: string, publicKeyHex: string): boolean {
  try {
    const s = signature.trim();
    const sig = /^(0x)?[0-9a-fA-F]{128}$/.test(s) ? hexToBytes(strip0x(s)) : Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    return ed25519.verify(sig, utf8ToBytes(text), hexToBytes(strip0x(publicKeyHex)));
  } catch {
    return false;
  }
}

/** The key that signed: recovered (ecdsa) or claimed and checked (ed25519). Null if the signature is bad. */
export function signerOf(sig: SignatureResponse, algo: SigningAlgo): string | null {
  if (!sig.text || !sig.signature) return null;
  if (algo === "ecdsa") return recoverPersonalSign(sig.text, sig.signature);
  const claimed = strip0x(sig.signing_address ?? "");
  return claimed && verifyEd25519(sig.text, sig.signature, claimed) ? claimed : null;
}

/** "provider_tee" text is model:req:res; "gateway" text is req:res. Model ids hold "/" but no ":". */
export function signedParts(text: string): { model: string | null; request: string; response: string } {
  const parts = text.split(":");
  return parts.length === 3 ? { model: parts[0], request: parts[1], response: parts[2] } : { model: null, request: parts[0] ?? "", response: parts[1] ?? "" };
}

export type SignatureKind = "provider_tee" | "gateway" | "unknown";

export function signatureKind(sig: SignatureResponse): SignatureKind {
  return sig.signature_kind === "provider_tee" || sig.signature_kind === "gateway" ? sig.signature_kind : "unknown";
}

/**
 * Checks one completion's signature against what was sent and received.
 * `modelSigners` are model TEE keys whose quote verified and bound them;
 * `gatewaySigners` the same for the gateway. A provider_tee signature must come
 * from a model TEE, a gateway signature from the gateway, and a signature that
 * doesn't say its kind is refused. For an end-to-end encrypted request pass only the
 * key it was encrypted to and no gateway signers: the reply has no sender
 * authentication (the gateway sees the client key), so only that TEE's signature
 * shows the model wrote it.
 */
export function responseChecks(args: {
  sig: SignatureResponse;
  algo: SigningAlgo;
  requestBody: string;
  responseBody: string;
  model: string;
  modelSigners: string[];
  gatewaySigners: string[];
}): { checks: TeeCheck[]; signer: string | null; kind: SignatureKind } {
  const { sig, algo, model } = args;
  const kind = signatureKind(sig);
  const parts = signedParts(sig.text ?? "");
  const signer = signerOf(sig, algo);
  const allowed = (kind === "provider_tee" ? args.modelSigners : kind === "gateway" ? args.gatewaySigners : []).map(strip0x);
  const signerOk = !!signer && allowed.filter((a) => a === strip0x(signer)).length >= 1;
  const r = (id: string, label: string, ok: boolean, detail: string): TeeCheck => ({ id: `response-${id}`, scope: "response", label, ok, detail });
  const who = kind === "provider_tee" ? "the model TEE" : kind === "gateway" ? "the gateway TEE" : "a TEE";
  const checks = [
    r("request", "Signed over exactly what was sent", !!sig.text && parts.request === sha256Hex(args.requestBody), "sha256 of the request bytes matches the signed text"),
    r("response", "Signed over exactly what came back", !!sig.text && parts.response === sha256Hex(args.responseBody), "sha256 of the response bytes matches the signed text"),
  ];
  if (kind !== "gateway") {
    checks.push(r("model", "Signed for the model asked for", parts.model === model, parts.model ? `Signed text names ${parts.model}` : "Signed text names no model"));
  }
  checks.push(
    r(
      "signer",
      "Signed by an attested TEE",
      signerOk,
      !signer
        ? `${algo === "ed25519" ? "Ed25519" : "ECDSA"} signature didn't verify`
        : kind === "unknown"
          ? "The signature doesn't say which TEE made it, so it isn't accepted"
          : kind === "gateway" && args.gatewaySigners.length === 0
            ? "Signed by the gateway, which only relayed the reply: the model TEE the request was encrypted to didn't sign it"
            : signerOk
          ? `${algo === "ed25519" ? "Ed25519" : "ECDSA"} signer ${short(signer)} is ${who}, bound in a verified quote`
          : `Signer ${short(signer)} isn't a key bound in a verified quote of ${who}`,
    ),
  );
  return { checks, signer, kind };
}
