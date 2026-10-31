import { check, strip0x, type TeeCheck, type Where } from "./checks.ts";

/**
 * NVIDIA GPU attestation, as NEAR's model-verification docs describe it: NEAR's
 * `nvidia_payload` goes to NVIDIA NRAS unchanged; NRAS answers
 *   [["JWT", <platform token>], { "GPU-0": <token>, … }]
 * and every token must be signed by NVIDIA (ES384, keys from NRAS's JWKS), carry
 * our nonce, and report a passing GPU.
 *
 * Signatures use WebCrypto, so the same code runs in the app, in Node tests and in
 * the public Verify page.
 */

export const NRAS_ISSUER = "https://nras.attestation.nvidia.com";

export interface Jwk {
  kty: string;
  crv?: string;
  kid?: string;
  x?: string;
  y?: string;
}

export interface Jwks {
  keys: Jwk[];
}

export type JwtClaims = Record<string, unknown>;

function b64urlBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const b64urlJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

/** Claims of a JWT without checking it. Only for display; never for a decision. */
export function decodeJwt(token: string): JwtClaims | null {
  try {
    return b64urlJson(token.split(".")[1]);
  } catch {
    return null;
  }
}

/**
 * Verifies an NRAS token's ES384 signature with the JWKS key named by its `kid`,
 * and its issuer. Expiry is checked only when `now` (seconds) is given: a stored
 * token is still NVIDIA's statement after it expires, so the Verify page checks
 * the signature but not freshness, and says so.
 */
export async function verifyNrasJwt(token: string, jwks: Jwks, now?: number): Promise<{ ok: true; claims: JwtClaims } | { ok: false; error: string }> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, error: "not a JWT" };
  let header: { alg?: string; kid?: string };
  let claims: JwtClaims;
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch {
    return { ok: false, error: "unreadable JWT" };
  }
  if (header.alg !== "ES384") return { ok: false, error: `unexpected algorithm ${header.alg}` };
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-384" || !jwk.x || !jwk.y) return { ok: false, error: `NVIDIA key ${header.kid ?? "?"} isn't published` };
  try {
    const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-384", x: jwk.x, y: jwk.y, ext: true }, { name: "ECDSA", namedCurve: "P-384" }, false, ["verify"]);
    const sig = b64urlBytes(parts[2]);
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-384" }, key, sig as BufferSource, data as BufferSource);
    if (!valid) return { ok: false, error: "signature doesn't match NVIDIA's key" };
  } catch (e) {
    return { ok: false, error: `signature check failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (claims.iss !== NRAS_ISSUER) return { ok: false, error: `issuer ${String(claims.iss)}` };
  if (now !== undefined && typeof claims.exp === "number" && claims.exp < now) return { ok: false, error: "token expired" };
  return { ok: true, claims };
}

/** The tokens in an NRAS answer: the platform token first, then one per GPU. */
export function nrasTokens(body: unknown): { name: string; token: string }[] | null {
  if (!Array.isArray(body) || !Array.isArray(body[0]) || typeof body[0][1] !== "string") return null;
  const gpus = body[1] && typeof body[1] === "object" ? Object.entries(body[1] as Record<string, unknown>) : [];
  return [{ name: "platform", token: body[0][1] }, ...gpus.filter(([, t]) => typeof t === "string").map(([name, token]) => ({ name, token: token as string }))];
}

/** A GPU token passes when secure boot is on, debug off, measurements match and nothing is flagged. */
export function gpuClaimsOk(c: JwtClaims): boolean {
  const flags = Object.entries(c).filter(([k]) => /^x-nvidia-.*-(verified|validated)$/.test(k));
  return (
    c.secboot === true &&
    c.dbgstat === "disabled" &&
    c.measres === "success" &&
    (c["x-nvidia-attestation-warning"] === null || c["x-nvidia-attestation-warning"] === undefined) &&
    flags.every(([, v]) => v === true)
  );
}

/**
 * The GPU checks for one model TEE, from NEAR's payload and NRAS's answer.
 * Returns the platform token too, so the proof can keep it for the Verify page.
 */
export async function gpuChecks(args: {
  payload: string | undefined;
  nras: unknown;
  nrasError?: string;
  jwks: Jwks | null;
  nonce: string;
  now: number;
  where: Where;
}): Promise<{ checks: TeeCheck[]; platformToken: string | null }> {
  const w = args.where;
  const fail = (detail: string) => ({ checks: [check(w, "gpu", "Genuine NVIDIA confidential GPU", false, detail)], platformToken: null });
  if (!args.payload) return fail("No GPU evidence in the attestation");
  let payloadNonce = "";
  try {
    payloadNonce = strip0x(String(JSON.parse(args.payload).nonce ?? ""));
  } catch {
    return fail("GPU evidence isn't valid JSON");
  }
  if (args.nrasError) return fail(`NVIDIA NRAS didn't answer: ${args.nrasError}`);
  if (!args.jwks) return fail("Couldn't get NVIDIA's signing keys");
  const tokens = nrasTokens(args.nras);
  if (!tokens) return fail("NVIDIA NRAS answered in an unknown format");

  const claims: { name: string; claims: JwtClaims }[] = [];
  for (const t of tokens) {
    const v = await verifyNrasJwt(t.token, args.jwks, args.now);
    if (!v.ok) return fail(`NVIDIA's ${t.name} token didn't verify: ${v.error}`);
    claims.push({ name: t.name, claims: v.claims });
  }
  const platform = claims[0].claims;
  const gpus = claims.slice(1);
  const nonce = strip0x(args.nonce);
  const n = gpus.length;
  return {
    platformToken: tokens[0].token,
    checks: [
      check(
        w,
        "gpu",
        "Genuine NVIDIA confidential GPU",
        platform["x-nvidia-overall-att-result"] === true && n > 0,
        `NVIDIA NRAS passed ${n} GPU${n === 1 ? "" : "s"}; all ${tokens.length} tokens signed by NVIDIA (ES384)`,
      ),
      check(
        w,
        "gpu-nonce",
        "GPU evidence is fresh",
        payloadNonce === nonce && claims.every((c) => strip0x(String(c.claims.eat_nonce ?? "")) === nonce),
        "GPU evidence and every NVIDIA token carry the nonce made for this check",
      ),
      check(
        w,
        "gpu-secure",
        "GPUs in secure mode",
        n > 0 && gpus.every((g) => gpuClaimsOk(g.claims)),
        "Secure boot on, debug off, measurements match NVIDIA's reference, no warnings",
      ),
    ],
  };
}
