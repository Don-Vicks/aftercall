import { p384 } from "@noble/curves/nist";
import { sha256 } from "@noble/hashes/sha256";
import { sha384 } from "@noble/hashes/sha512";
import { bytesToHex } from "@noble/hashes/utils";
import type { Jwk } from "./nvidia.ts";

/**
 * Whether an NRAS signing key is one NVIDIA certified, from the certificate chain NVIDIA
 * serves beside it in its JWKS (`x5c`: a short-lived leaf for the key, then the
 * intermediate that signed it). Used for keys NVIDIA no longer lists, which Aftercall
 * keeps in an archive: the archive is only a copy, so each key in it must chain to an
 * intermediate whose public key is pinned here.
 *
 * X.509 DER is read by hand, only as far as this needs. Signatures are checked with
 * WebCrypto (RSA) and @noble/curves (P-384), so this runs in the app, in Node and in
 * the browser on /verify.
 */

/**
 * sha256 of the SubjectPublicKeyInfo (DER) of each NVIDIA intermediate an archived key
 * may chain to, both issued by "NVIDIA Attestation Service CA 001" and taken from NVIDIA's
 * JWKS on 12 Nov 2026, when every listed key chained to one of the two. To re-derive one:
 * `openssl x509 -in int.der -inform der -noout -pubkey | openssl pkey -pubin -outform der | shasum -a 256`.
 */
export const NVIDIA_INTERMEDIATES: Readonly<Record<string, string>> = {
  // RSA 2048, valid 8 Dec 2025 to 8 Dec 2029; signs 12-hour leaves with sha256WithRSAEncryption.
  fd32837f954e2c45db073105166dfe6985ae0480bb113fba63b091a75affe896: "NVIDIA Attestation Service GPU Intermediate 004",
  // P-384, valid 8 Oct 2026 to 8 Oct 2030; signs two-day leaves with ecdsa-with-SHA384.
  ba14d00377699189b6762c22c744a9dbdc62aa9396097ada7150426c6ff39afc: "NVIDIA Attestation Service GPU Intermediate 005",
};

/** Object identifiers, as the hex of their DER contents. */
const OID = {
  rsaEncryption: "2a864886f70d010101",
  sha256WithRSAEncryption: "2a864886f70d01010b",
  ecPublicKey: "2a8648ce3d0201",
  secp384r1: "2b81040022",
  ecdsaWithSHA384: "2a8648ce3d040303",
};

/** One DER element: its tag, where its header and contents start, and where it ends. */
interface Tlv {
  tag: number;
  head: number;
  body: number;
  end: number;
}

function readTlv(der: Uint8Array, at: number, limit: number): Tlv {
  if (at + 2 > limit) throw new Error("truncated");
  const tag = der[at];
  if ((tag & 0x1f) === 0x1f) throw new Error("unsupported tag");
  let len = der[at + 1];
  let body = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n < 1 || n > 3 || body + n > limit) throw new Error("bad length");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + der[body + i];
    body += n;
  }
  if (body + len > limit) throw new Error("truncated");
  return { tag, head: at, body, end: body + len };
}

function childrenOf(der: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let at = parent.body; at < parent.end; ) {
    const c = readTlv(der, at, parent.end);
    out.push(c);
    at = c.end;
  }
  return out;
}

function expect(t: Tlv | undefined, tag: number, what: string): Tlv {
  if (!t || t.tag !== tag) throw new Error(`no ${what}`);
  return t;
}

const whole = (der: Uint8Array, t: Tlv) => der.subarray(t.head, t.end);
const contents = (der: Uint8Array, t: Tlv) => der.subarray(t.body, t.end);

function bitString(der: Uint8Array, t: Tlv): Uint8Array {
  const c = contents(der, t);
  if (c.length < 1 || c[0] !== 0) throw new Error("unexpected bit string");
  return c.subarray(1);
}

/** An AlgorithmIdentifier: its OID, and its parameter when that is an OID too (an EC key's curve). */
function algorithm(der: Uint8Array, t: Tlv): { oid: string; param: string | null } {
  const [oid, param] = childrenOf(der, t);
  return { oid: bytesToHex(contents(der, expect(oid, 0x06, "algorithm"))), param: param?.tag === 0x06 ? bytesToHex(contents(der, param)) : null };
}

const UTC_TIME = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/;
const GENERALIZED_TIME = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/;

/** A UTCTime or GeneralizedTime, in seconds since 1970. */
function derTime(der: Uint8Array, t: Tlv | undefined, what: string): number {
  const m = t?.tag === 0x17 ? UTC_TIME.exec(new TextDecoder().decode(contents(der, t))) : t?.tag === 0x18 ? GENERALIZED_TIME.exec(new TextDecoder().decode(contents(der, t))) : null;
  if (!t || !m) throw new Error(`no ${what}`);
  // RFC 5280: a two-digit year of 50 or more is 19xx.
  const year = t.tag === 0x17 ? Number(m[1]) + (Number(m[1]) < 50 ? 2000 : 1900) : Number(m[1]);
  return Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) / 1000;
}

/** The parts of an X.509 certificate a chain check reads. Byte fields are views into the DER. */
export interface Certificate {
  /** The signed part, tbsCertificate, as DER. */
  tbs: Uint8Array;
  /** The issuer's signature algorithm (OID hex). */
  signatureAlgorithm: string;
  signature: Uint8Array;
  /** Distinguished names as DER, to compare byte for byte. */
  issuer: Uint8Array;
  subject: Uint8Array;
  /** Validity, in seconds since 1970. */
  notBefore: number;
  notAfter: number;
  /** SubjectPublicKeyInfo as DER. */
  spki: Uint8Array;
  /** The key's algorithm and, for an EC key, its curve (OID hex). */
  keyAlgorithm: string;
  keyCurve: string | null;
  /** The public key bits: an RSAPublicKey, or an uncompressed EC point. */
  publicKey: Uint8Array;
}

/** Reads a DER certificate. Throws on anything else. */
export function parseCertificate(der: Uint8Array): Certificate {
  const cert = expect(readTlv(der, 0, der.length), 0x30, "certificate");
  if (cert.end !== der.length) throw new Error("bytes after the certificate");
  const [tbs, outerAlg, sig, ...rest] = childrenOf(der, cert);
  if (rest.length) throw new Error("unexpected certificate field");
  expect(tbs, 0x30, "tbsCertificate");
  expect(outerAlg, 0x30, "signature algorithm");
  expect(sig, 0x03, "signature");
  const f = childrenOf(der, tbs);
  let i = f[0]?.tag === 0xa0 ? 1 : 0;
  expect(f[i++], 0x02, "serial number");
  const innerAlg = expect(f[i++], 0x30, "signature algorithm");
  const issuer = expect(f[i++], 0x30, "issuer");
  const validity = expect(f[i++], 0x30, "validity");
  const subject = expect(f[i++], 0x30, "subject");
  const spki = expect(f[i++], 0x30, "public key");
  // RFC 5280: the signed copy of the algorithm must match the one outside the signature.
  if (!sameBytes(whole(der, innerAlg), whole(der, outerAlg))) throw new Error("two signature algorithms");
  const [notBefore, notAfter] = childrenOf(der, validity);
  const [keyAlg, keyBits] = childrenOf(der, spki);
  const key = algorithm(der, expect(keyAlg, 0x30, "key algorithm"));
  return {
    tbs: whole(der, tbs),
    signatureAlgorithm: algorithm(der, outerAlg).oid,
    signature: bitString(der, sig),
    issuer: whole(der, issuer),
    subject: whole(der, subject),
    notBefore: derTime(der, notBefore, "notBefore"),
    notAfter: derTime(der, notAfter, "notAfter"),
    spki: whole(der, spki),
    keyAlgorithm: key.oid,
    keyCurve: key.param,
    publicKey: bitString(der, expect(keyBits, 0x03, "public key bits")),
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

const base64Bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const base64UrlBytes = (s: string) => base64Bytes(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));

/** Whether `cert` carries a valid signature by `issuer`'s key, in one of the two forms NVIDIA's intermediates use. */
async function signedBy(cert: Certificate, issuer: Certificate): Promise<boolean> {
  try {
    if (issuer.keyAlgorithm === OID.rsaEncryption && cert.signatureAlgorithm === OID.sha256WithRSAEncryption) {
      const key = await crypto.subtle.importKey("spki", issuer.spki as BufferSource, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
      return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, cert.signature as BufferSource, cert.tbs as BufferSource);
    }
    if (issuer.keyAlgorithm === OID.ecPublicKey && issuer.keyCurve === OID.secp384r1 && cert.signatureAlgorithm === OID.ecdsaWithSHA384) {
      return p384.verify(cert.signature, sha384(cert.tbs), issuer.publicKey, { prehash: false, lowS: false, format: "der" });
    }
    return false;
  } catch {
    return false;
  }
}

/** The leaf certifies exactly the JWK's P-384 key. */
function certifiesKey(leaf: Certificate, jwk: Jwk): boolean {
  if (leaf.keyAlgorithm !== OID.ecPublicKey || leaf.keyCurve !== OID.secp384r1) return false;
  if (jwk.kty !== "EC" || jwk.crv !== "P-384" || !jwk.x || !jwk.y) return false;
  try {
    return sameBytes(leaf.publicKey, new Uint8Array([4, ...base64UrlBytes(jwk.x), ...base64UrlBytes(jwk.y)]));
  } catch {
    return false;
  }
}

export type ChainCheck = { ok: true; intermediate: string } | { ok: false; error: string };

const utc = (s: number) => new Date(s * 1000).toISOString().replace("T", " ").slice(0, 16);

/**
 * Whether NVIDIA certified `jwk` as of `at` (seconds; the time its token was issued):
 * the key's `x5c` leaf names exactly this key, carries a valid signature by the
 * intermediate after it, that intermediate's public key is pinned (`pins`, NVIDIA's by
 * default), and both certificates were valid at `at`. Says which check failed, if one did.
 */
export async function verifyKeyChain(jwk: Jwk, at: number, pins: Readonly<Record<string, string>> = NVIDIA_INTERMEDIATES): Promise<ChainCheck> {
  const fail = (error: string): ChainCheck => ({ ok: false, error });
  if (!Number.isFinite(at)) return fail("the token has no issue time");
  const [leafText, intermediateText] = jwk.x5c ?? [];
  if (!leafText || !intermediateText) return fail("the key has no certificate chain");
  let leaf: Certificate;
  let intermediate: Certificate;
  try {
    leaf = parseCertificate(base64Bytes(leafText));
    intermediate = parseCertificate(base64Bytes(intermediateText));
  } catch (e) {
    return fail(`a certificate in its chain can't be read (${e instanceof Error ? e.message : String(e)})`);
  }
  const name = pins[bytesToHex(sha256(intermediate.spki))];
  if (!name) return fail("its certificate chain doesn't lead to an NVIDIA intermediate Aftercall pins");
  if (!sameBytes(leaf.issuer, intermediate.subject)) return fail(`its certificate wasn't issued by ${name}`);
  if (!(await signedBy(leaf, intermediate))) return fail(`its certificate's signature doesn't match ${name}`);
  if (at < intermediate.notBefore || at > intermediate.notAfter) return fail(`${name} wasn't valid at ${utc(at)} UTC`);
  if (at < leaf.notBefore || at > leaf.notAfter) return fail(`its certificate was valid ${utc(leaf.notBefore)} to ${utc(leaf.notAfter)} UTC, not at ${utc(at)} UTC`);
  if (!certifiesKey(leaf, jwk)) return fail("its certificate is for a different key");
  return { ok: true, intermediate: name };
}
