import { test } from "node:test";
import assert from "node:assert/strict";
import { gpuChecks, nrasTokens, verifyNrasJwt } from "./nvidia.ts";
import { fakeNras, randomNonce } from "./testkit.ts";

const where = { scope: "model" as const, model: "Qwen/Qwen3.8-27B" };
/** NEAR's GPU evidence for `gpus` GPUs (NRAS answers for 2 unless told otherwise). */
const payload = (nonce: string, gpus = 2) => JSON.stringify({ nonce, evidence_list: Array.from({ length: gpus }, (_, i) => ({ certificate: `c${i}`, evidence: `e${i}` })) });

test("NRAS tokens signed with NVIDIA's key verify; others don't", async () => {
  const nv = await fakeNras();
  const token = await nv.sign({ iss: "https://nras.attestation.nvidia.com", eat_nonce: "x" });
  assert.equal((await verifyNrasJwt(token, nv.jwks)).ok, true);

  const [h, p, s] = token.split(".");
  const forged = `${h}.${Buffer.from(JSON.stringify({ iss: "https://nras.attestation.nvidia.com", eat_nonce: "y" })).toString("base64url")}.${s}`;
  assert.deepEqual(await verifyNrasJwt(forged, nv.jwks), { ok: false, error: "signature doesn't match NVIDIA's key" });

  const impostor = await fakeNras();
  const theirs = await impostor.sign({ iss: "https://nras.attestation.nvidia.com" });
  assert.equal((await verifyNrasJwt(theirs, nv.jwks)).ok, false, "same kid, different key");

  const unknownKid = await nv.sign({ iss: "https://nras.attestation.nvidia.com" }, { kid: "retired" });
  const r = await verifyNrasJwt(unknownKid, nv.jwks);
  assert.ok(!r.ok && /isn't published/.test(r.error));

  const wrongIssuer = await nv.sign({ iss: "https://evil.example" });
  assert.equal((await verifyNrasJwt(wrongIssuer, nv.jwks)).ok, false);

  const expired = await nv.sign({ iss: "https://nras.attestation.nvidia.com", exp: 1000 });
  assert.equal((await verifyNrasJwt(expired, nv.jwks, nv.now)).ok, false);
  assert.equal((await verifyNrasJwt(expired, nv.jwks)).ok, true, "without `now` only the signature counts");
  assert.ok(p.length > 0);
});

test("NRAS's two-part answer yields the platform token then one per GPU", () => {
  assert.deepEqual(nrasTokens([["JWT", "a"], { "GPU-0": "b", "GPU-1": "c" }])?.map((t) => t.name), ["platform", "GPU-0", "GPU-1"]);
  assert.equal(nrasTokens({ result: true }), null);
});

test("a passing GPU answer passes all three GPU checks", async () => {
  const nv = await fakeNras();
  const nonce = randomNonce();
  const r = await gpuChecks({ payload: payload(nonce, 8), nras: await nv.answer(nonce, { gpus: 8 }), jwks: nv.jwks, nonce, now: nv.now, where });
  assert.deepEqual(r.checks.map((c) => [c.id.split("-").slice(-2).join("-"), c.ok]), [["27B-gpu", true], ["gpu-nonce", true], ["gpu-secure", true]]);
  assert.match(r.checks[0].detail, /8 GPUs; all 9 tokens signed by NVIDIA/);
  assert.ok(r.platformToken);
});

test("each GPU failure is caught", async () => {
  const nv = await fakeNras();
  const nonce = randomNonce();
  const failedIds = async (opts: Parameters<typeof nv.answer>[1], p = payload(nonce)) =>
    (await gpuChecks({ payload: p, nras: await nv.answer(nonce, opts), jwks: nv.jwks, nonce, now: nv.now, where })).checks.filter((c) => !c.ok).map((c) => c.id.replace("model-Qwen/Qwen3.8-27B-", ""));

  assert.deepEqual(await failedIds({ platform: { "x-nvidia-overall-att-result": false } }), ["gpu"]);
  assert.deepEqual(await failedIds({ gpu: { secboot: false } }), ["gpu-secure"]);
  assert.deepEqual(await failedIds({ gpu: { dbgstat: "enabled" } }), ["gpu-secure"]);
  assert.deepEqual(await failedIds({ gpu: { measres: "fail" } }), ["gpu-secure"]);
  assert.deepEqual(await failedIds({ gpu: { "x-nvidia-attestation-warning": "RIM expired" } }), ["gpu-secure"]);
  assert.deepEqual(await failedIds({ gpu: { "x-nvidia-gpu-driver-rim-signature-verified": false } }), ["gpu-secure"]);
  assert.deepEqual(await failedIds({ gpu: { eat_nonce: randomNonce() } }), ["gpu-nonce"], "per-GPU nonce");
  assert.deepEqual(await failedIds({ platform: { eat_nonce: randomNonce() } }), ["gpu-nonce"], "platform nonce");
  assert.deepEqual(await failedIds({}, payload(randomNonce())), ["gpu-nonce"], "evidence made for another nonce");
  assert.deepEqual(await failedIds({ gpus: 0 }, payload(nonce, 0)), ["gpu", "gpu-secure"], "no GPUs is not a pass");
  // Per-GPU claims the skill's table names, and every yes/no claim NVIDIA sends.
  assert.deepEqual(await failedIds({ gpu: { hwmodel: undefined } }), ["gpu-secure"], "no hardware model");
  assert.deepEqual(await failedIds({ gpu: { ueid: "" } }), ["gpu-secure"], "no GPU identifier");
  assert.deepEqual(await failedIds({ gpu: { "x-nvidia-gpu-attestation-report-nonce-match": false } }), ["gpu-secure"]);
  assert.deepEqual(await failedIds({ gpu: { "x-nvidia-gpu-driver-rim-fetched": false } }), ["gpu-secure"]);
  assert.deepEqual(await failedIds({ gpu: { "x-nvidia-gpu-arch-check": false } }), ["gpu-secure"]);
  // NVIDIA's tokens must cover the GPUs NEAR sent evidence for, no more and no fewer.
  assert.deepEqual(await failedIds({ gpus: 1 }), ["gpu"], "a GPU missing from NVIDIA's answer");
  assert.deepEqual(await failedIds({ gpus: 3 }), ["gpu"], "an extra GPU in NVIDIA's answer");
  assert.deepEqual(await failedIds({ platform: { submods: { "GPU-0": [], "GPU-7": [] } } }), ["gpu"], "the platform token lists other GPUs");
});

test("missing evidence, NRAS errors, missing keys and bad signatures fail closed", async () => {
  const nv = await fakeNras();
  const nonce = randomNonce();
  const base = { payload: payload(nonce), nras: await nv.answer(nonce), jwks: nv.jwks, nonce, now: nv.now, where };
  const detail = async (over: Partial<typeof base> & { nrasError?: string }) => {
    const r = await gpuChecks({ ...base, ...over });
    assert.equal(r.checks.length, 1);
    assert.equal(r.checks[0].ok, false);
    return r.checks[0].detail;
  };
  assert.match(await detail({ payload: undefined }), /No GPU evidence/);
  assert.match(await detail({ nrasError: "NVIDIA NRAS 503" }), /didn't answer/);
  assert.match(await detail({ jwks: null as never }), /signing keys/);
  assert.match(await detail({ jwks: (await fakeNras()).jwks }), /platform token didn't verify/);
  assert.match(await detail({ nras: { verdict: true } as never }), /unknown format/);
});
