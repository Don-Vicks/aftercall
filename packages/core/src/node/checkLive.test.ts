import { test } from "node:test";
import assert from "node:assert/strict";
import { attestModel, gatewayChecks, type TeeTransport } from "../tee/attest.ts";
import { GATEWAY_TLS, attestationFor, decodeQuote, fakeNras, teeKey } from "../tee/testkit.ts";
import { e2eeNode } from "../notes/pipeline.ts";
import type { Check } from "../notes/proof.ts";
import type { ProofEvidence, TxStatus } from "./evidence.ts";
import { serviceUnavailable, unavailableIn } from "./outage.ts";
import { attestationErrorLine, contractLines, e2eeLine, formatLine, limiter, modelLines, nearRpc, proofLines, recordingFetch, summarize, teeLines, type Line, type Outage, type ProofRun, type TxRead } from "./checkLive.ts";

/** A NEAR AI whose report, Intel, NVIDIA NRAS and NVIDIA's keys can each be down, or a quote bad. */
async function fakeServices(opts: { intelDown?: boolean; nrasDown?: boolean; badBootLog?: boolean } = {}): Promise<TeeTransport> {
  const nv = await fakeNras();
  const gateway = teeKey("ed25519");
  const qwen = teeKey("ed25519");
  const whisper = teeKey("ecdsa");
  let n = 0;
  return {
    randomHex: () => (++n).toString(16).padStart(64, "0"),
    async get(path) {
      const q = new URLSearchParams(path.split("?")[1]);
      const nonce = q.get("nonce")!;
      const key = q.get("model")?.startsWith("Qwen") ? qwen : whisper;
      return JSON.stringify({
        gateway_attestation: attestationFor(gateway, nonce, { gpu: false, ...(q.get("include_tls_fingerprint") === "true" ? { tls: GATEWAY_TLS } : {}) }),
        model_attestations: [attestationFor(key, nonce, opts.badBootLog ? { quote: { rtMr3: "00".repeat(48) } } : {})],
      });
    },
    async verifyQuote(hex) {
      if (opts.intelDown) throw serviceUnavailable("Intel PCS", "HTTP 503");
      return decodeQuote(hex);
    },
    async nvidiaAttest(payload) {
      if (opts.nrasDown) throw serviceUnavailable("NVIDIA NRAS", "HTTP 429 slow down");
      return JSON.stringify(await nv.answer(JSON.parse(payload).nonce));
    },
    nvidiaKeys: async () => JSON.stringify(nv.jwks),
  };
}

const outcomes = (lines: Line[]) => lines.map((l) => `${l.outcome} ${l.text}`);

test("attestation with every service up: each of the app's checks passes, and the summary node's E2EE key is the one in its quote", async () => {
  const t = await fakeServices();
  const jwks = JSON.parse(await t.nvidiaKeys());
  const summary = await attestModel(t, "Qwen/Qwen3.8-27B", "ed25519", { withGateway: true, jwks });
  const gw = teeLines(gatewayChecks(summary), null);
  assert.equal(gw.length, 7);
  assert.ok(gw.every((l) => l.outcome === "pass"));
  const [qwen] = modelLines(summary, null);
  assert.match(qwen.title, /^Qwen\/Qwen3\.8-27B \(ed25519, fresh nonce 00000000…\)$/);
  assert.deepEqual(outcomes(qwen.lines).filter((o) => !o.startsWith("pass")), []);
  assert.equal(qwen.lines.length, 9, "six CPU checks and three GPU checks");
  assert.equal(e2eeLine(e2eeNode(summary), qwen.lines).outcome, "pass");
});

test("Intel's collateral service down: the checks that need the quote read 'service unavailable', the GPU checks still count", async () => {
  const t = await fakeServices({ intelDown: true });
  const summary = await attestModel(t, "Qwen/Qwen3.8-27B", "ed25519", { withGateway: true, jwks: JSON.parse(await t.nvidiaKeys()) });
  const [qwen] = modelLines(summary, null);
  const cpu = qwen.lines.slice(0, 6);
  assert.ok(cpu.every((l) => l.outcome === "unavailable" && l.detail === "service unavailable (Intel PCS): HTTP 503"), JSON.stringify(cpu));
  assert.deepEqual(qwen.lines.slice(6).map((l) => l.outcome), ["pass", "pass", "pass"]);
  assert.ok(teeLines(gatewayChecks(summary), null).every((l) => l.outcome === "unavailable"));
  // The app wouldn't send, but no claim was shown false.
  assert.equal(e2eeLine(e2eeNode(summary), qwen.lines).outcome, "unavailable");
  assert.equal(summarize(qwen.lines).exitCode, 0);
});

test("a quote that doesn't match its boot log fails, though every service answered", async () => {
  const t = await fakeServices({ badBootLog: true });
  const summary = await attestModel(t, "Qwen/Qwen3.8-27B", "ed25519", { withGateway: false, jwks: JSON.parse(await t.nvidiaKeys()) });
  const [qwen] = modelLines(summary, null);
  assert.deepEqual(outcomes(qwen.lines).filter((o) => !o.startsWith("pass")), ["fail Boot log matches the quote"]);
  assert.equal(e2eeLine(e2eeNode(summary), qwen.lines).outcome, "fail");
  assert.equal(summarize([...qwen.lines]).exitCode, 1);
});

test("NVIDIA down: NRAS rate-limited, or its keys unreachable, reads 'service unavailable'; no keys without an outage fails", async () => {
  const nras = await fakeServices({ nrasDown: true });
  const a = await attestModel(nras, "openai/whisper-large-v3", "ecdsa", { withGateway: false, jwks: JSON.parse(await nras.nvidiaKeys()) });
  const gpu = modelLines(a, null)[0].lines.find((l) => l.text === "Genuine NVIDIA confidential GPU")!;
  assert.equal(gpu.outcome, "unavailable");
  assert.equal(gpu.detail, "service unavailable (NVIDIA NRAS): HTTP 429 slow down");

  const t = await fakeServices();
  const noKeys = await attestModel(t, "openai/whisper-large-v3", "ecdsa", { withGateway: false, jwks: null });
  const keysDown: Outage = { service: "NVIDIA keys", error: "HTTP 503" };
  assert.equal(modelLines(noKeys, keysDown)[0].lines.find((l) => l.text === "Genuine NVIDIA confidential GPU")!.outcome, "unavailable");
  assert.equal(modelLines(noKeys, null)[0].lines.find((l) => l.text === "Genuine NVIDIA confidential GPU")!.outcome, "fail");
});

test("NEAR AI's report not read: down is unavailable, asking for a key is unavailable and says so, anything else fails", () => {
  assert.equal(attestationErrorLine("report", serviceUnavailable("NEAR AI", "HTTP 502")).detail, "service unavailable (NEAR AI): HTTP 502");
  const key = attestationErrorLine("report", new Error("NEAR AI 401: missing bearer token"));
  assert.equal(key.outcome, "unavailable");
  assert.match(key.detail!, /now asks for an API key .* this check uses none/);
  assert.equal(attestationErrorLine("report", new SyntaxError("Unexpected token <")).outcome, "fail");
  assert.equal(modelLines({ model: "x", nonce: "00", algo: "ecdsa", gateway: null, nodes: [] }, null)[0].lines[0].outcome, "fail");
});

/** A fetch that answers each call with the next reply in turn. */
function replies(...rs: (Response | Error)[]) {
  const urls: string[] = [];
  const f = (async (url: string | URL | Request) => {
    urls.push(String(url));
    const r = rs.shift();
    if (!r) throw new Error("no more replies");
    if (r instanceof Error) throw r;
    return r;
  }) as typeof fetch;
  return { fetch: f, urls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("NEAR RPC: a rate-limited or broken endpoint hands over to the next; only when all are down is it 'service unavailable'", async () => {
  const ok = replies(new Response("slow down", { status: 429 }), json({ jsonrpc: "2.0", id: "check-live", result: { ok: 1 } }));
  assert.deepEqual(await nearRpc(["https://a.example", "https://b.example"], ok.fetch, 0)("status", {}), { ok: 1 });
  assert.deepEqual(ok.urls, ["https://a.example", "https://b.example"]);

  const down = replies(new Response("bad gateway", { status: 502 }), new TypeError("fetch failed"), new Response("<html>", { status: 200 }), json({ error: { name: "HANDLER_ERROR", cause: { name: "TIMEOUT_ERROR" } } }, 408));
  const err = await nearRpc(["https://a.example", "https://b.example"], down.fetch, 0)("tx", {}).then(
    () => assert.fail("every endpoint was down"),
    (e: Error) => e.message,
  );
  assert.deepEqual(unavailableIn(err), { service: "NEAR RPC", error: `a.example HTTP 502; b.example fetch failed; a.example Unexpected token '<', "<html>" is not valid JSON; b.example HTTP 408` });
  assert.equal(down.urls.length, 4, "each endpoint is tried twice");

  // A transaction NEAR doesn't know is an answer, not an outage.
  const unknown = replies(json({ error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_TRANSACTION", info: {} }, data: "Transaction 1111 doesn't exist" } }));
  const why = await nearRpc(["https://a.example"], unknown.fetch, 0)("tx", {}).then(
    () => assert.fail("NEAR doesn't know it"),
    (e: Error) => e.message,
  );
  assert.equal(why, "UNKNOWN_TRANSACTION: Transaction 1111 doesn't exist");
  assert.equal(unavailableIn(why), null);
  const internal = replies(json({ error: { name: "INTERNAL_ERROR", cause: { name: "INTERNAL_ERROR" } } }), json({ result: 7 }));
  assert.equal(await nearRpc(["https://a.example"], internal.fetch, 0)("tx", {}), 7);
});

test("/verify's fetch is recorded: a rate-limited RPC or NVIDIA's keys unreachable are noted by service", async () => {
  const outages: Outage[] = [];
  const f = recordingFetch(outages, replies(new Response("", { status: 429 }), new TypeError("fetch failed")).fetch);
  assert.equal((await f("https://test.rpc.fastnear.com", { method: "POST" })).ok, false);
  await assert.rejects(f("https://nras.attestation.nvidia.com/.well-known/jwks.json"));
  assert.deepEqual(outages, [
    { service: "NEAR RPC", error: "test.rpc.fastnear.com HTTP 429" },
    { service: "NVIDIA keys", error: "nras.attestation.nvidia.com fetch failed" },
  ]);
});

const proof: ProofEvidence = { file: "docs/proof-3-nov.txt", owner: "nov3.testnet", meetingId: "1793631702", passed: 3, of: 3, cantRecheck: 1, txs: ["2oawJPTmRiNky6EGzpURh79FRDkFcx4bp1kL76DevZro"], claim: "", citedIn: ["README.md"] };
const HASH = "8f19a214d417681e2ce61a09297f842ecc37c4fa3d591c516403fd08aa5d60f0";
const check = (id: Check["id"], ok: boolean, extra: Partial<Check> = {}): Check => ({ id, label: id, ok, detail: id, ...extra });
const passing = (): Check[] => [check("on-chain", true), check("matches", true), check("signed", true), check("gpu", false, { cantRecheck: true, detail: "retired" })];
const run = (over: Partial<ProofRun> = {}): ProofRun => ({ checks: passing(), allPassed: true, recorded: [{ id: "gateway-tdx", label: "Intel", ok: true }], owner: "nov3.testnet", meetingId: "1793631702", proofHash: HASH, outages: [], ...over });
const recordProof = (args: Record<string, unknown>, signer = "nov3.testnet"): TxRead => ({
  value: {
    status: { SuccessValue: "" },
    transaction: { signer_id: signer, receiver_id: "wallet.aftercall.testnet", public_key: "ed25519:x", actions: [{ FunctionCall: { method_name: "record_proof", args: Buffer.from(JSON.stringify(args)).toString("base64") } }] },
    transaction_outcome: { block_hash: "b" },
    receipts_outcome: [],
  } satisfies TxStatus,
});
const tied = new Map([[proof.txs[0], recordProof({ meeting_id: "1793631702", proof_hash: HASH })]]);

test("a proof link passes when /verify's count is the README's and the cited transaction recorded this very proof", () => {
  const [head, ...details] = proofLines(proof, run(), tied);
  assert.equal(head.outcome, "pass");
  assert.equal(head.text, "docs/proof-3-nov.txt: 3 of 3 passed, 1 can't be re-checked; the app's 1 recorded checks: 1 passed; Checks out");
  assert.equal(head.detail, "as the README says; the transaction cited for it names this meeting");
  assert.deepEqual(outcomes(details), ["cantRecheck gpu"]);
  const s = summarize([head, ...details]);
  assert.deepEqual(s.counts, { pass: 1, fail: 0, unavailable: 0, cantRecheck: 1 });
  assert.equal(formatLine(details[0]), "        – gpu · retired");
});

test("a proof link fails when its count isn't the README's, when a check fails, or when the cited transaction recorded another proof", () => {
  const more = proofLines({ ...proof, passed: 4, of: 4, cantRecheck: 0 }, run(), tied)[0];
  assert.equal(more.outcome, "fail");
  assert.equal(more.detail, "the README says 4 of 4");
  const signed = proofLines(proof, run({ checks: [...passing().slice(0, 2), check("signed", false), passing()[3]], allPassed: false }), tied);
  assert.deepEqual(outcomes(signed), ["fail docs/proof-3-nov.txt: 2 of 3 passed, 1 can't be re-checked; the app's 1 recorded checks: 1 passed; Doesn't check out", "fail signed", "cantRecheck gpu"]);
  const other = proofLines(proof, run(), new Map([[proof.txs[0], recordProof({ meeting_id: "1793631702", proof_hash: "ab".repeat(32) })]]));
  assert.equal(other[0].outcome, "fail");
  assert.equal(other.find((l) => l.text.endsWith("names this meeting"))!.detail, "proof_hash abababababab…, the link's is 8f19a214d417…");
  const recordedFail = proofLines(proof, run({ recorded: [{ id: "gateway-tdx", label: "Intel", ok: false }], allPassed: false }), tied);
  assert.ok(outcomes(recordedFail).includes("fail Recorded by the app: Intel"));
});

test("NEAR's RPC down while re-checking a proof: the NEAR checks read 'service unavailable', and nothing fails", () => {
  const down = run({
    checks: [check("on-chain", false), check("matches", false), check("signed", true), check("gpu", false, { cantRecheck: true })],
    allPassed: false,
    rpcError: "Unexpected token 'T', \"Too many requests\" is not valid JSON",
    outages: [{ service: "NEAR RPC", error: "test.rpc.fastnear.com HTTP 429" }],
  });
  const lines = proofLines(proof, down, new Map([[proof.txs[0], { unavailable: { service: "NEAR RPC", error: "HTTP 429" } }]]));
  assert.equal(lines[0].outcome, "unavailable");
  assert.deepEqual(
    lines.slice(1).map((l) => l.outcome),
    ["unavailable", "unavailable", "cantRecheck", "unavailable"],
  );
  assert.equal(summarize(lines).exitCode, 0);
  // The same failures with NEAR answering are a failure.
  assert.equal(proofLines(proof, { ...down, rpcError: undefined, outages: [] }, tied)[0].outcome, "fail");
});

test("the contract: its code hash and lock state against the README, and an RPC outage reads as one", () => {
  const e = { account: "wallet.aftercall.testnet", codeHash: "Cc3mNqSrQeq1Aty91x9iCX521vD55SpJcFA8FEdBgYWm", usdc: "3e22", locked: false, claim: "", citedIn: ["README.md"] };
  const keys = [{ public_key: "ed25519:8xR2UeaMVeQjpbiyfnFSja3tfxNY7hGyb5hmoYdRR6ko", access_key: { permission: "FullAccess" as const } }];
  const good = contractLines(e, { codeHash: { value: e.codeHash }, usdc: { value: "3e22" }, stats: { value: { wallets: 2, proofs: 13, payments: 8, parked: 3 } }, keys: { value: keys } });
  assert.deepEqual(outcomes(good), ["pass Deployed code hash", "pass get_usdc", "pass get_stats", "pass Not locked"]);
  assert.equal(good[2].detail, "2 wallets, 13 proofs, 8 payments, 3 parked");
  assert.match(good[3].detail!, /^1 full-access key \(ed25519:8xR2UeaM…\), so its code can still be upgraded, as the README says$/);
  const drifted = contractLines(e, { codeHash: { value: "4fGh" }, usdc: { error: "MethodNotFound" }, stats: { value: { wallets: "2" } }, keys: { value: [] } });
  assert.deepEqual(outcomes(drifted), ["fail Deployed code hash", "fail get_usdc", "fail get_stats", "fail Not locked"]);
  assert.equal(drifted[3].detail, "no full-access key: nobody can deploy new code to it, but the README says it is not locked");
  const rpcDown: Outage = { service: "NEAR RPC", error: "HTTP 503" };
  assert.ok(contractLines(e, { codeHash: { unavailable: rpcDown }, usdc: { unavailable: rpcDown }, stats: { unavailable: rpcDown }, keys: { unavailable: rpcDown } }).every((l) => l.outcome === "unavailable"));
});

test("the summary: exit 1 only when a claim doesn't hold; a service down is said, not failed", () => {
  const pass: Line = { outcome: "pass", text: "a" };
  assert.deepEqual(summarize([pass, pass]), { counts: { pass: 2, fail: 0, unavailable: 0, cantRecheck: 0 }, exitCode: 0, text: "2 passed, 0 failed, 0 service unavailable, 0 can't be re-checked. Every live claim checked holds." });
  const down = summarize([pass, { outcome: "unavailable", text: "b" }]);
  assert.equal(down.exitCode, 0);
  assert.match(down.text, /No claim was found false, but some couldn't be checked because a service was down/);
  const failed = summarize([pass, { outcome: "unavailable", text: "b" }, { outcome: "fail", text: "c" }, { outcome: "fail", text: "detail", depth: 1 }]);
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.counts.fail, 1, "a detail line isn't counted again");
  assert.match(failed.text, /don't match what the README says/);
});

test("the limiter runs at most n calls at once", async () => {
  const slot = limiter(2);
  let active = 0;
  let most = 0;
  await Promise.all(
    Array.from({ length: 6 }, () =>
      slot(async () => {
        most = Math.max(most, ++active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      }),
    ),
  );
  assert.equal(most, 2);
});
