import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { base58, decodeBase64Json, includes, lockState, matchAccessKey, matchKeyNow, matchTransaction, parseEvidence, tokenTransfers, type TxEvidence, type TxStatus } from "./evidence.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const WALLET = "wallet.aftercall.testnet";
const b64 = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64");
const transferLog = (to: string, amount: string) => `EVENT_JSON:${JSON.stringify({ standard: "nep141", version: "1.0.0", event: "ft_transfer", data: [{ old_owner_id: WALLET, new_owner_id: to, amount, memo: "Aftercall payment" }] })}`;

/** A pay transaction as EXPERIMENTAL_tx_status returns it (trimmed), from Eq3rPHqz… on testnet. */
function payTx(over: { returns?: unknown; transferOk?: boolean; transferBy?: string; noTransfer?: boolean; signer?: string; args?: Record<string, unknown> } = {}): TxStatus {
  const returned = b64(over.returns ?? { status: "sending", reason: null, left_today: "20000000", cross_chain_left_today: null });
  return {
    status: { SuccessValue: returned },
    transaction: {
      signer_id: over.signer ?? "nov3.testnet",
      receiver_id: WALLET,
      public_key: "ed25519:DRpkJLQVLzSV6nHRdtT6s7ytpwYz13EzLTnuMYKMZW3o",
      actions: [{ FunctionCall: { method_name: "pay", args: b64(over.args ?? { payee: "kemi-ac.testnet", amount: "5000000", memo: "Aftercall payment", followup_id: "1794164530-f1", meeting_id: "1794164530" }), deposit: "0" } }],
    },
    transaction_outcome: { block_hash: "EzzqLpLjWmjWMdA8GbXMvG7yuSRVUdiqahz4q8M7o6aE" },
    receipts_outcome: [
      { outcome: { executor_id: WALLET, logs: [], status: { SuccessValue: returned } } },
      ...(over.noTransfer
        ? []
        : [{ outcome: { executor_id: over.transferBy ?? USDC, logs: [transferLog("kemi-ac.testnet", "5000000")], status: over.transferOk === false ? { Failure: { ActionError: { kind: "FunctionCallError" } } } : { SuccessValue: "" } } }]),
      { outcome: { executor_id: WALLET, logs: [], status: { SuccessValue: b64(true) } } },
    ],
  };
}

const paid: TxEvidence = {
  hash: "Eq3rPHqzDXoanWV8u1kETAkb3WSD1rTrT7ia4CzMqwXH",
  signer: "nov3.testnet",
  receiver: WALLET,
  method: "pay",
  args: { payee: "kemi-ac.testnet", amount: "5000000", meeting_id: "1794164530" },
  outcome: "success",
  returns: { status: "sending", reason: null },
  transfer: { to: "kemi-ac.testnet", amount: "5000000" },
  claim: "paid",
  citedIn: ["README.md"],
};

test("a payment read back from NEAR matches its evidence: signer, method, arguments, return value and the USDC that moved", () => {
  const m = matchTransaction(paid, payTx(), USDC);
  assert.deepEqual(m.problems, []);
  assert.ok(m.ok);
  assert.match(m.found, /^pay by nov3\.testnet; success; returned \{"status":"sending".*\}; 5\.00 USDC to kemi-ac\.testnet$/);
});

test("each difference from the evidence is named: signer, argument, return value", () => {
  const m = matchTransaction(paid, payTx({ signer: "mallory.testnet", args: { payee: "mallory.testnet", amount: "5000000", meeting_id: "1794164530" }, returns: { status: "blocked", reason: "OVER_PAYMENT_CAP" } }), USDC);
  assert.equal(m.ok, false);
  assert.ok(m.problems.includes("signed by mallory.testnet, not nov3.testnet"));
  assert.ok(m.problems.includes("argument payee is mallory.testnet, not kemi-ac.testnet"));
  assert.ok(m.problems.some((p) => p.startsWith('returned {"status":"blocked"')));
  assert.equal(matchTransaction({ ...paid, method: "withdraw" }, payTx(), USDC).problems[0], "calls pay, not withdraw");
});

test("paid means the token contract's own transfer succeeded: a failed transfer, or one logged by another contract, isn't a payment", () => {
  const failed = matchTransaction(paid, payTx({ transferOk: false }), USDC);
  assert.equal(failed.ok, false);
  assert.ok(failed.problems.some((p) => /no USDC transfer of 5000000 .*\(moved: 5000000 to kemi-ac\.testnet, failed\)/.test(p)));
  assert.ok(failed.problems.some((p) => /1 receipt failed/.test(p)));
  const forged = matchTransaction(paid, payTx({ transferBy: "fake-usdc.testnet" }), USDC);
  assert.equal(forged.ok, false);
  assert.deepEqual(tokenTransfers(payTx({ transferBy: "fake-usdc.testnet" }), USDC), []);
});

test("held over the cap: blocked with OVER_PAYMENT_CAP and nothing moved", () => {
  const held: TxEvidence = { ...paid, args: { amount: "5000000000" }, returns: { status: "blocked", reason: "OVER_PAYMENT_CAP" }, transfer: undefined, noTransfer: true };
  const tx = payTx({ returns: { status: "blocked", reason: "OVER_PAYMENT_CAP" }, args: { amount: "5000000000" }, noTransfer: true });
  const m = matchTransaction(held, tx, USDC);
  assert.deepEqual(m.problems, []);
  assert.match(m.found, /nothing moved$/);
  // The same evidence against a transaction that did move USDC.
  const moved = matchTransaction(held, payTx({ returns: { status: "blocked", reason: "OVER_PAYMENT_CAP" }, args: { amount: "5000000000" } }), USDC);
  assert.ok(moved.problems.includes("a token moved, but nothing should have"));
});

test("an expected failure passes only as a failure with the named error", () => {
  const tx: TxStatus = { ...payTx(), status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: UNKNOWN_PAYEE" } } } } } };
  const want: TxEvidence = { ...paid, returns: undefined, transfer: undefined, outcome: "failure", failure: "UNKNOWN_PAYEE" };
  delete want.returns;
  assert.deepEqual(matchTransaction(want, tx, USDC).problems, []);
  assert.match(matchTransaction({ ...want, failure: "LOW_BALANCE" }, tx, USDC).problems[0], /^failed with .*UNKNOWN_PAYEE.*, not LOW_BALANCE$/);
  assert.deepEqual(matchTransaction(want, payTx(), USDC).problems, ["succeeded, but should have failed"]);
});

test("a deployment is matched by its code hash: RPC's base64 sha256, written in base58 as NEAR does", () => {
  // BQXQAhui… on testnet: the 7 Nov upgrade of wallet.aftercall.testnet.
  const tx: TxStatus = {
    status: { SuccessValue: "" },
    transaction: { signer_id: WALLET, receiver_id: WALLET, public_key: "ed25519:8xR2UeaMVeQjpbiyfnFSja3tfxNY7hGyb5hmoYdRR6ko", actions: [{ DeployContract: { code: "rGsC0s2uuTAsR7L4AyUwpHFRXmr3jxvf+4imO038HJI=" } }] },
    transaction_outcome: { block_hash: "HJhbLBGGRJD2vk39u1aZF19cHRhHfrgnJ3Wtxa4A7AeY" },
    receipts_outcome: [{ outcome: { executor_id: WALLET, logs: [], status: { SuccessValue: "" } } }],
  };
  const deploy: TxEvidence = { hash: "BQXQAhui6ixc2B7QacSoSyw6MWqUvgkGvyfSUfCzYpoq", signer: WALLET, receiver: WALLET, deploy: { codeHash: "Cc3mNqSrQeq1Aty91x9iCX521vD55SpJcFA8FEdBgYWm" }, outcome: "success", claim: "upgrade", citedIn: ["README.md"] };
  const m = matchTransaction(deploy, tx, USDC);
  assert.deepEqual(m.problems, []);
  assert.equal(m.found, "deploy by wallet.aftercall.testnet; success; code Cc3mNqSrQeq1Aty91x9iCX521vD55SpJcFA8FEdBgYWm");
  assert.deepEqual(matchTransaction({ ...deploy, deploy: { codeHash: "11111111111111111111111111111111111111111111" } }, tx, USDC).problems, [
    "deploys code Cc3mNqSrQeq1Aty91x9iCX521vD55SpJcFA8FEdBgYWm, not 11111111111111111111111111111111111111111111",
  ]);
  assert.match(matchTransaction(deploy, payTx(), USDC).problems.join("; "), /has no deployment \(FunctionCall\)/);
});

test("base58 and base64 values decode as NEAR writes them", () => {
  assert.equal(base58(new Uint8Array([0, 0, 1])), "112");
  assert.equal(base58(new Uint8Array([])), "");
  assert.equal(decodeBase64Json(""), undefined);
  assert.equal(decodeBase64Json(b64("confirmed")), "confirmed", "a bare string comes back as text");
  assert.equal(decodeBase64Json(b64('"confirmed"')), "confirmed");
  assert.deepEqual(decodeBase64Json(b64({ a: 1 })), { a: 1 });
  assert.ok(includes({ status: "sending", reason: null, left_today: "5" }, { status: "sending", reason: null }));
  assert.ok(!includes({ status: "sending" }, { status: "sending", reason: null }), "a missing field isn't null");
  assert.ok(!includes("confirmed", { state: "confirmed" }));
});

const appKey = { permission: "FunctionCall" as const, receiver: WALLET, methods: ["pay", "record_proof", "open_escrow", "release_escrow"] };
const fc = (methods: string[], receiver = WALLET) => ({ permission: { FunctionCall: { allowance: "1", receiver_id: receiver, method_names: methods } } });

test("the app's limited key: a FunctionCall key for the contract with exactly the stated methods, at that block", () => {
  const pk = "ed25519:DFPdNSBY2bFSX33A2KHnHzLjFT85W6svyS6zAtCUnJZh";
  const ok = matchAccessKey(appKey, pk, fc(["release_escrow", "pay", "open_escrow", "record_proof"]));
  assert.ok(ok.ok, ok.problems.join("; "));
  assert.equal(ok.found, "key DFPdNSBY… was FunctionCall on wallet.aftercall.testnet: release_escrow, pay, open_escrow, record_proof");
  assert.deepEqual(matchAccessKey(appKey, pk, fc([...appKey.methods, "withdraw"])).problems, [
    "key DFPdNSBY… may call pay, record_proof, open_escrow, release_escrow, withdraw, not pay, record_proof, open_escrow, release_escrow",
  ]);
  assert.match(matchAccessKey(appKey, pk, fc([])).problems[0], /may call any method/, "an empty list is any method, not none");
  assert.match(matchAccessKey(appKey, pk, fc(appKey.methods, "other.testnet")).problems[0], /may call other\.testnet, not wallet\.aftercall\.testnet/);
  assert.deepEqual(matchAccessKey(appKey, pk, { permission: "FullAccess" }).problems, ["key DFPdNSBY… was a FullAccess key, not a limited one"]);
  assert.match(matchAccessKey(appKey, pk, { error: "access key ed25519:DFPd… does not exist while viewing" }).problems[0], /wasn't on the account at that block/);
});

test("the owner's own account: a full-access key, never a limited one", () => {
  const pk = "ed25519:2nxgujQ7eXHWmZht1ZDr6uyuFPde5iJZF4tNv2U1i4qy";
  assert.ok(matchAccessKey({ permission: "FullAccess" }, pk, { permission: "FullAccess" }).ok);
  assert.match(matchAccessKey({ permission: "FullAccess" }, pk, fc(["pay"])).problems[0], /was FunctionCall on wallet\.aftercall\.testnet: pay, not FullAccess/);
});

test("a key's state today: deleted since, or unchanged", () => {
  const pk = "ed25519:DFPdNSBY2bFSX33A2KHnHzLjFT85W6svyS6zAtCUnJZh";
  const missing = { error: `access key ${pk} does not exist while viewing` };
  assert.ok(matchKeyNow({ ...appKey, now: "deleted" }, pk, missing).ok);
  assert.match(matchKeyNow({ ...appKey, now: "deleted" }, pk, fc(appKey.methods)).problems[0], /is still on the account/);
  assert.ok(matchKeyNow({ ...appKey, now: "same" }, pk, fc(appKey.methods)).ok);
  assert.match(matchKeyNow({ ...appKey, now: "same" }, pk, fc([...appKey.methods, "withdraw"])).problems[0], /^key DFPdNSBY… today may call/);
  assert.match(matchKeyNow({ ...appKey, now: "same" }, pk, missing).problems[0], /isn't on the account any more/);
});

test("the contract is locked only with no full-access key left", () => {
  assert.deepEqual(lockState([{ public_key: "ed25519:8xR2", access_key: { permission: "FullAccess" } }]), { locked: false, fullAccess: ["ed25519:8xR2"] });
  assert.deepEqual(lockState([{ public_key: "ed25519:app", access_key: fc(["pay"]) }]), { locked: true, fullAccess: [] });
  assert.deepEqual(lockState([]), { locked: true, fullAccess: [] });
});

const evidence = () => JSON.parse(readFileSync(join(repo, "docs", "evidence.json"), "utf8"));

test("docs/evidence.json fits its schema, and lists every transaction the README links", () => {
  const e = parseEvidence(evidence());
  const listed = new Set(e.transactions.map((t) => t.hash));
  const readme = readFileSync(join(repo, "README.md"), "utf8");
  const linked = [...readme.matchAll(/nearblocks\.io\/txns\/([1-9A-HJ-NP-Za-km-z]{43,44})/g)].map((m) => m[1]);
  assert.ok(linked.length >= 13);
  assert.deepEqual(linked.filter((h) => !listed.has(h)), [], "a transaction the README links isn't in docs/evidence.json");
  for (const p of e.proofs) assert.ok(existsSync(join(repo, p.file)), `${p.file} exists`);
});

test("docs/evidence.json is refused when it can't be checked as written", () => {
  const e = evidence();
  assert.throws(() => parseEvidence({ ...e, transactions: [...e.transactions, e.transactions[0]] }), /a transaction is listed twice/);
  assert.throws(() => parseEvidence({ ...e, proofs: [{ ...e.proofs[0], txs: ["11111111111111111111111111111111111111111111"] }] }), /names 1111.*which isn't in transactions/);
  const [first] = e.transactions;
  assert.throws(() => parseEvidence({ ...e, transactions: [{ ...first, deploy: { codeHash: "Cc3mNqSrQeq1Aty91x9iCX521vD55SpJcFA8FEdBgYWm" } }] }), /a method or a deploy, not both/);
  assert.throws(() => parseEvidence({ ...e, transactions: [{ ...first, key: { permission: "FunctionCall" } }] }), /names its receiver and methods/);
  assert.throws(() => parseEvidence({ ...e, transactions: [{ ...first, outcome: "maybe" }] }), /transactions\.0\.outcome/);
  assert.throws(() => parseEvidence({ ...e, transactions: [{ ...first, hash: "0xnothex" }] }), /a base58 hash/);
});
