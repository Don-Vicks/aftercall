import { sha256Hex } from "../notes/verify.ts";
import { appCompose, cpuChecks, isSha256Hex, signingIdentity, strip0x, type AttestationReport, type QuoteReport, type SigningAlgo, type TeeAttestation, type TeeCheck, type Where } from "./checks.ts";
import { gpuChecks, type Jwks } from "./nvidia.ts";

/**
 * Runs every attestation check for one model: the gateway TEE (optional), then
 * every TEE node serving the model. Network calls go through the transport
 * (Rust in the desktop app); the decisions are the pure checks in checks.ts and
 * nvidia.ts.
 */

export interface TeeTransport {
  /** GET a path under /v1 on NEAR AI Cloud (attestation report, signature). */
  get(path: string): Promise<string>;
  /** Verifies a TDX quote (hex) against Intel's collateral; rejects if it doesn't verify. */
  verifyQuote(quoteHex: string): Promise<QuoteReport>;
  /** POSTs NEAR's GPU evidence to NVIDIA NRAS; returns NRAS's answer. */
  nvidiaAttest(payload: string): Promise<string>;
  /** NVIDIA's NRAS signing keys (JWKS JSON). */
  nvidiaKeys(): Promise<string>;
  /** 32 random bytes as hex, for attestation nonces. */
  randomHex(): string;
}

/**
 * What the proof keeps about one TEE: no quotes or logs, only the values the
 * checks compared, so the public Verify page can show and re-check them.
 */
export interface TeeEvidence {
  scope: "gateway" | "model";
  model?: string;
  node?: number;
  signingAlgo: SigningAlgo;
  signingAddress: string;
  nonce: string;
  tcbStatus: string;
  reportData: string;
  mrConfigId: string;
  composeHash: string;
  /**
   * The TLS key fingerprint bound in this TEE's report data (hex sha256 of the TLS
   * certificate's SPKI DER), when it sent one. For the gateway, the key the audio
   * upload was pinned to. Absent in older proofs.
   */
  tlsCertFingerprint?: string;
  /** NVIDIA's platform token, kept for the node that signed the summary. */
  nvidiaToken?: string;
  /** Every check for this TEE passed. */
  verified: boolean;
}

export interface VerifiedTee {
  att: TeeAttestation;
  checks: TeeCheck[];
  evidence: TeeEvidence;
  verified: boolean;
  platformToken: string | null;
}

export interface ModelAttestation {
  model: string;
  nonce: string;
  algo: SigningAlgo;
  gateway: VerifiedTee | null;
  nodes: VerifiedTee[];
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error: /, "");

async function verifyTee(t: TeeTransport, att: TeeAttestation, nonce: string, algo: SigningAlgo, where: Where, jwks: Jwks | null, now: number): Promise<VerifiedTee> {
  let quote: QuoteReport | null = null;
  let quoteError: string | null = null;
  if (!att.intel_quote) quoteError = "no TDX quote in the attestation";
  else {
    try {
      quote = await t.verifyQuote(strip0x(att.intel_quote));
    } catch (e) {
      quoteError = message(e);
    }
  }
  const checks = cpuChecks(att, nonce, quote, quoteError, where);

  let platformToken: string | null = null;
  if (where.scope === "model") {
    let nras: unknown = null;
    let nrasError: string | undefined;
    if (att.nvidia_payload) {
      try {
        nras = JSON.parse(await t.nvidiaAttest(att.nvidia_payload));
      } catch (e) {
        nrasError = message(e);
      }
    }
    const gpu = await gpuChecks({ payload: att.nvidia_payload, nras, nrasError, jwks, nonce, now, where });
    checks.push(...gpu.checks);
    platformToken = gpu.platformToken;
  }

  const compose = appCompose(att);
  const verified = checks.every((c) => c.ok);
  const fp = att.tls_cert_fingerprint ? strip0x(att.tls_cert_fingerprint) : "";
  return {
    att,
    checks,
    verified,
    platformToken,
    evidence: {
      scope: where.scope,
      ...(where.model ? { model: where.model } : {}),
      ...(where.node ? { node: where.node } : {}),
      signingAlgo: algo,
      signingAddress: signingIdentity(att),
      nonce,
      tcbStatus: quote?.status ?? "Unverified",
      reportData: strip0x(quote?.reportData ?? ""),
      mrConfigId: strip0x(quote?.mrConfigId ?? ""),
      composeHash: compose ? sha256Hex(compose) : "",
      ...(isSha256Hex(fp) ? { tlsCertFingerprint: fp } : {}),
      verified,
    },
  };
}

/** NVIDIA's keys, fetched once per run. Null if they can't be read (every GPU check then fails). */
export async function loadNvidiaKeys(t: TeeTransport): Promise<Jwks | null> {
  try {
    const jwks = JSON.parse(await t.nvidiaKeys()) as Jwks;
    return Array.isArray(jwks.keys) ? jwks : null;
  } catch {
    return null;
  }
}

/**
 * Fetches the attestation report for `model` with a fresh nonce and verifies
 * every TEE in it. `withGateway` also verifies the gateway TEE from the same report,
 * asking for its TLS key fingerprint to be bound into its quote
 * (`include_tls_fingerprint=true`), so the audio upload can be pinned to that key.
 */
export async function attestModel(
  t: TeeTransport,
  model: string,
  algo: SigningAlgo,
  opts: { withGateway: boolean; jwks: Jwks | null; now?: number },
): Promise<ModelAttestation> {
  const nonce = t.randomHex();
  const q = new URLSearchParams({ model, signing_algo: algo, nonce, include_tls_fingerprint: opts.withGateway ? "true" : "false" });
  const report = JSON.parse(await t.get(`attestation/report?${q}`)) as AttestationReport;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const nodes = report.model_attestations ?? [];
  const [gateway, ...verifiedNodes] = await Promise.all([
    opts.withGateway && report.gateway_attestation ? verifyTee(t, report.gateway_attestation, nonce, algo, { scope: "gateway" }, opts.jwks, now) : Promise.resolve(null),
    ...nodes.map((att, i) => verifyTee(t, att, nonce, algo, { scope: "model", model, node: nodes.length > 1 ? i + 1 : undefined }, opts.jwks, now)),
  ]);
  return { model, nonce, algo, gateway, nodes: verifiedNodes as VerifiedTee[] };
}

/**
 * The gateway alone (a report without `model`), with a fresh nonce and its TLS key
 * fingerprint bound in: for pinning the audio upload again when the gateway's
 * certificate changed. Null when the report has no gateway attestation.
 */
export async function attestGateway(t: TeeTransport, algo: SigningAlgo, opts: { jwks: Jwks | null; now?: number }): Promise<{ nonce: string; gateway: VerifiedTee | null }> {
  const nonce = t.randomHex();
  const q = new URLSearchParams({ signing_algo: algo, nonce, include_tls_fingerprint: "true" });
  const report = JSON.parse(await t.get(`attestation/report?${q}`)) as AttestationReport;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  return { nonce, gateway: report.gateway_attestation ? await verifyTee(t, report.gateway_attestation, nonce, algo, { scope: "gateway" }, opts.jwks, now) : null };
}

/** The TLS key the audio upload is pinned to: a verified gateway's bound fingerprint, or null. */
export const gatewayTlsPin = (gw: VerifiedTee | null): string | null => (gw?.verified && gw.evidence.tlsCertFingerprint ? gw.evidence.tlsCertFingerprint : null);

/**
 * The transports' answer when the gateway's TLS certificate key isn't the pinned one:
 * nothing was uploaded on that connection.
 */
export const TLS_PIN_MISMATCH = "TLS_PIN_MISMATCH";
export const tlsPinMismatch = (e: unknown) => (e instanceof Error ? e.message : String(e)).includes(TLS_PIN_MISMATCH);

/** Every check for a model, including a failing line when NEAR returned no TEE for it. */
export function modelChecks(a: ModelAttestation): TeeCheck[] {
  if (a.nodes.length === 0) {
    return [{ id: `model-${a.model}-present`, scope: "model", model: a.model, label: "Model attestation returned", ok: false, detail: "NEAR AI returned no TEE for this model" }];
  }
  return a.nodes.flatMap((n) => n.checks);
}

export function gatewayChecks(a: ModelAttestation): TeeCheck[] {
  return a.gateway ? a.gateway.checks : [{ id: "gateway-present", scope: "gateway", label: "Gateway attestation returned", ok: false, detail: "The report had no gateway attestation" }];
}

/** Signing keys whose own quote verified and bound them. */
export const attestedKeys = (tees: (VerifiedTee | null)[]) => tees.filter((n): n is VerifiedTee => !!n && n.verified).map((n) => n.evidence.signingAddress);

/** The labels of failed checks, for an error message. */
export const failedLabels = (checks: TeeCheck[]) => [...new Set(checks.filter((c) => !c.ok).map((c) => c.label.replace(/ · node \d+$/, "")))].join(", ");
