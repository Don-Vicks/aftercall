import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { p384 } from "@noble/curves/nist";
import { sha256 } from "@noble/hashes/sha256";
import { sha384 } from "@noble/hashes/sha512";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import type { Jwk, Jwks } from "./nvidia.ts";
import { NVIDIA_KEY_ARCHIVE } from "./nvidiaArchive.ts";
import { NVIDIA_INTERMEDIATES, parseCertificate, verifyKeyChain } from "./nvidiaChain.ts";

// Two real entries from NVIDIA's JWKS (nras.attestation.nvidia.com) on 12 Nov 2026: the key
// that signed the 12 Nov proof run's GPU token (docs/proof-run.md), whose leaf GPU
// Intermediate 004 signed with RSA, and a key whose leaf GPU Intermediate 005 signed with P-384.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/nvidia-jwks-12nov.json", import.meta.url), "utf8")) as Jwks;
const [rsaKey, ecKey] = fixture.keys as (Jwk & { x5c: string[] })[];
/** When NVIDIA issued the 12 Nov proof's token (its `iat`). */
const TOKEN_IAT = Date.UTC(2026, 10, 12, 9, 47, 54) / 1000;
const der = (b64: string) => Uint8Array.from(Buffer.from(b64, "base64"));
const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s) / 1000;
const INT_004 = "NVIDIA Attestation Service GPU Intermediate 004";
const INT_005 = "NVIDIA Attestation Service GPU Intermediate 005";

test("NVIDIA's certificates read as openssl reads them, and the pins are their intermediates' keys", () => {
  assert.equal(rsaKey.kid, "nv-eat-kid-prod-20261112073338781-09923e39-0960-480b-97d7-daf7f58447be");
  const leaf = parseCertificate(der(rsaKey.x5c[0]));
  assert.equal(leaf.notBefore, at(2026, 11, 12, 7, 33, 7));
  assert.equal(leaf.notAfter, at(2026, 11, 12, 19, 33, 37));
  assert.match(Buffer.from(leaf.subject).toString("latin1"), /NVIDIA Attestation Service GPU GH100/);
  const int4 = parseCertificate(der(rsaKey.x5c[1]));
  assert.deepEqual([int4.notBefore, int4.notAfter], [at(2025, 12, 8), at(2029, 12, 8)]);
  assert.equal(bytesToHex(sha256(int4.spki)), "fd32837f954e2c45db073105166dfe6985ae0480bb113fba63b091a75affe896");
  assert.equal(NVIDIA_INTERMEDIATES[bytesToHex(sha256(int4.spki))], INT_004);
  const int5 = parseCertificate(der(ecKey.x5c[1]));
  assert.equal(NVIDIA_INTERMEDIATES[bytesToHex(sha256(int5.spki))], INT_005);
  assert.throws(() => parseCertificate(der(rsaKey.x5c[0]).subarray(0, 300)));
  assert.throws(() => parseCertificate(concatBytes(der(rsaKey.x5c[0]), new Uint8Array([0]))), /bytes after/);
});

test("a key NVIDIA certified checks out while its certificate was valid, with either intermediate", async () => {
  assert.deepEqual(await verifyKeyChain(rsaKey, TOKEN_IAT), { ok: true, intermediate: INT_004 });
  assert.deepEqual(await verifyKeyChain(ecKey, at(2026, 11, 12)), { ok: true, intermediate: INT_005 });
  const late = await verifyKeyChain(rsaKey, at(2026, 11, 13, 9));
  assert.deepEqual(late, { ok: false, error: "its certificate was valid 2026-11-12 07:33 to 2026-11-12 19:33 UTC, not at 2026-11-13 09:00 UTC" });
  assert.deepEqual(await verifyKeyChain(rsaKey, Number.NaN), { ok: false, error: "the token has no issue time" });
});

test("a tampered chain fails: a changed certificate, a swapped leaf, another key, a missing intermediate", async () => {
  const errorOf = async (k: Jwk, when = TOKEN_IAT) => {
    const r = await verifyKeyChain(k, when);
    assert.equal(r.ok, false);
    return r.ok ? "" : r.error;
  };
  const edit = (b64: string, from: string, to: string) => {
    const bytes = Buffer.from(b64, "base64");
    const i = bytes.indexOf(from, 0, "latin1");
    assert.ok(i > 0);
    bytes.write(to, i, "latin1");
    return bytes.toString("base64");
  };
  // The leaf's subject edited (RSA signature), and the P-384 leaf's (ECDSA signature).
  assert.equal(await errorOf({ ...rsaKey, x5c: [edit(rsaKey.x5c[0], "GH100", "GH200"), rsaKey.x5c[1]] }), `its certificate's signature doesn't match ${INT_004}`);
  assert.equal(await errorOf({ ...ecKey, x5c: [edit(ecKey.x5c[0], "GH100", "GH200"), ecKey.x5c[1]] }, at(2026, 11, 12)), `its certificate's signature doesn't match ${INT_005}`);
  // A leaf from another chain, a leaf for another key, an entry whose key isn't its leaf's.
  assert.equal(await errorOf({ ...rsaKey, x5c: [ecKey.x5c[0], rsaKey.x5c[1]] }), `its certificate wasn't issued by ${INT_004}`);
  assert.equal(await errorOf({ ...ecKey, x5c: rsaKey.x5c }), "its certificate is for a different key");
  assert.equal(await errorOf({ ...rsaKey, y: ecKey.y }), "its certificate is for a different key");
  assert.equal(await errorOf({ ...rsaKey, x5c: [rsaKey.x5c[0]] }), "the key has no certificate chain");
  assert.equal(await errorOf({ ...rsaKey, x5c: undefined }), "the key has no certificate chain");
  assert.match(await errorOf({ ...rsaKey, x5c: ["AAAA", rsaKey.x5c[1]] }), /^a certificate in its chain can't be read/);
});

test("every key in the archive is one NVIDIA certified, and the 12 Nov proof's key is there", async () => {
  assert.ok(NVIDIA_KEY_ARCHIVE.keys.some((k) => k.kid === rsaKey.kid));
  for (const k of NVIDIA_KEY_ARCHIVE.keys) {
    const r = await verifyKeyChain(k, parseCertificate(der(k.x5c?.[0] ?? "")).notBefore);
    assert.equal(r.ok, true, `${k.kid}: ${r.ok ? "" : r.error}`);
  }
});

// A minimal DER writer, to build a chain under an intermediate Aftercall doesn't pin.
const tlv = (tag: number, ...parts: Uint8Array[]) => {
  const body = concatBytes(...parts);
  const n = body.length;
  return concatBytes(new Uint8Array([tag, ...(n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255])]), body);
};
const seq = (...parts: Uint8Array[]) => tlv(0x30, ...parts);
const oid = (hex: string) => tlv(0x06, hexToBytes(hex));
const bits = (b: Uint8Array) => tlv(0x03, new Uint8Array([0]), b);
const nameOf = (cn: string) => seq(tlv(0x31, seq(oid("550403"), tlv(0x0c, utf8ToBytes(cn)))));
const ECDSA_SHA384 = seq(oid("2a8648ce3d040303"));

test("a chain to an intermediate Aftercall doesn't pin fails, even when every signature in it is valid", async () => {
  const priv = p384.utils.randomSecretKey();
  const spki = seq(seq(oid("2a8648ce3d0201"), oid("2b81040022")), bits(p384.getPublicKey(priv, false)));
  const issuer = nameOf("NVIDIA Attestation Service GPU Intermediate 004");
  const certificate = (subject: Uint8Array, key: Uint8Array) => {
    const tbs = seq(tlv(0xa0, tlv(0x02, new Uint8Array([2]))), tlv(0x02, new Uint8Array([1])), ECDSA_SHA384, issuer, seq(tlv(0x17, utf8ToBytes("261112000000Z")), tlv(0x17, utf8ToBytes("261113000000Z"))), subject, key);
    return seq(tbs, ECDSA_SHA384, bits(p384.sign(sha384(tbs), priv, { prehash: false }).toDERRawBytes()));
  };
  // NVIDIA's real key, in a leaf "issued" by a look-alike intermediate.
  const leaf = certificate(nameOf("NVIDIA Attestation Service GPU GH100"), parseCertificate(der(rsaKey.x5c[0])).spki);
  const intermediate = certificate(issuer, spki);
  const forged: Jwk = { ...rsaKey, x5c: [Buffer.from(leaf).toString("base64"), Buffer.from(intermediate).toString("base64")] };
  assert.deepEqual(await verifyKeyChain(forged, TOKEN_IAT), { ok: false, error: "its certificate chain doesn't lead to an NVIDIA intermediate Aftercall pins" });
  // The same chain passes once its intermediate is pinned: only the pin stops it.
  assert.deepEqual(await verifyKeyChain(forged, TOKEN_IAT, { [bytesToHex(sha256(spki))]: "a test intermediate" }), { ok: true, intermediate: "a test intermediate" });
});
