import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSignRequest, describe, encodeSignRequest, toTransactions, USDC_CONTRACT, type SignRequest } from "./actions.ts";

const base = { network: "testnet" as const, contract: "wallet.victor.testnet", owner: "victor.testnet" };

test("every owner method carries exactly 1 yoctoNEAR, as the contract requires", () => {
  for (const action of [
    { kind: "set-cap", dailyCap: "200000000" },
    { kind: "set-payment-cap", perPaymentCap: "50000000" },
    { kind: "remove-payee", account: "designer.testnet", label: "Designer" },
    { kind: "withdraw", amount: "1000000" },
    { kind: "approve", followupId: "m1-f3", payee: "designer.testnet", amount: "5000000000" },
    { kind: "cancel", followupId: "m1-f3", payee: "designer.testnet", amount: "5000000000" },
    { kind: "pause", paused: true },
  ] as const) {
    const [tx] = toTransactions({ ...base, action });
    assert.equal(tx.receiverId, base.contract);
    const a = tx.actions[0];
    assert.ok(a.type === "FunctionCall" && a.params.deposit === "1", action.kind);
  }
});

test("adding a payee can register them with USDC first, in the same signing", () => {
  const txs = toTransactions({ ...base, action: { kind: "add-payee", account: "designer.testnet", label: "Designer", registerWithUsdc: true } });
  assert.deepEqual(txs.map((t) => t.receiverId), [USDC_CONTRACT.testnet, base.contract]);
  const reg = txs[0].actions[0];
  assert.ok(reg.type === "FunctionCall" && reg.params.methodName === "storage_deposit" && reg.params.deposit === "1250000000000000000000");
});

test("deposits go to the USDC contract as ft_transfer_call to the agent wallet", () => {
  const [tx] = toTransactions({ ...base, action: { kind: "deposit", amount: "250000000" } });
  assert.equal(tx.receiverId, USDC_CONTRACT.testnet);
  const a = tx.actions[0];
  assert.ok(a.type === "FunctionCall");
  assert.deepEqual(a.params.args, { receiver_id: base.contract, amount: "250000000", msg: "" });
});

test("authorising the Mac adds a key limited to pay and record_proof on the contract", () => {
  const [tx] = toTransactions({ ...base, action: { kind: "authorise-key", publicKey: "ed25519:3w4RMJEvhWGNAjEWrrFgVNeXTqhiGrMvj4jHgYG67b6S" } });
  assert.equal(tx.receiverId, base.owner);
  const a = tx.actions[0];
  assert.ok(a.type === "AddKey");
  assert.deepEqual(a.params.accessKey.permission, { receiverId: base.contract, allowance: "250000000000000000000000", methodNames: ["pay", "record_proof"] });
});

test("the approve page shows the amount, payee, meeting and the words heard", () => {
  const d = describe({
    ...base,
    action: { kind: "approve", followupId: "m1-f3", payee: "designer.testnet", amount: "5000000000", context: { payeeName: "Designer", meeting: "Sync with Ada", heard: "the full five thousand", leftToday: "150.00" } },
  });
  assert.deepEqual(d.rows.map((r) => r.value), ["5,000.00 USDC", "Designer · designer.testnet", "Sync with Ada", "“the full five thousand”", "150.00 left; this goes past it once"]);
});

test("links round-trip, and tampered or malformed requests are refused", () => {
  const r: SignRequest = { ...base, action: { kind: "set-cap", dailyCap: "200000000" } };
  assert.deepEqual(decodeSignRequest(`#${encodeSignRequest(r)}`), r);
  const bad = (x: object) => assert.throws(() => decodeSignRequest(encodeSignRequest(x as SignRequest)));
  bad({ ...r, network: "devnet" });
  bad({ ...r, owner: "Victor Testnet" });
  bad({ ...r, action: { kind: "set-cap", dailyCap: "-1" } });
  bad({ ...r, action: { kind: "delete-account" } });
  bad({ ...r, action: { kind: "authorise-key", publicKey: "secp256k1:abc" } });
});
