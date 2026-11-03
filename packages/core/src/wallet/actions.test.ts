import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSignRequest, describe, encodeSignRequest, toTransactions, USDC_CONTRACT, type SignRequest } from "./actions.ts";

const base = { network: "testnet" as const, contract: "wallet.victor.testnet", owner: "victor.testnet" };

test("every owner method carries exactly 1 yoctoNEAR, as the contract requires", () => {
  for (const action of [
    { kind: "set-cap", dailyCap: "200000000" },
    { kind: "set-payment-cap", perPaymentCap: "50000000" },
    { kind: "set-cross-chain-cap", crossChainCap: "20000000" },
    { kind: "withdraw-storage-credit", yoctoNear: "10000000000000000000000" },
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

test("topping up storage credit attaches the NEAR itself, to the caller's own wallet", () => {
  const r: SignRequest = { ...base, action: { kind: "add-storage-credit", yoctoNear: "50000000000000000000000" } };
  const [tx] = toTransactions(r);
  const a = tx.actions[0];
  assert.ok(a.type === "FunctionCall");
  assert.deepEqual([tx.receiverId, a.params.methodName, a.params.args, a.params.deposit], [base.contract, "add_storage_credit", {}, "50000000000000000000000"]);
  assert.deepEqual(describe(r).rows[0], { label: "Amount", value: "0.05 NEAR", mono: true });
  assert.deepEqual(decodeSignRequest(encodeSignRequest(r)), r);
  assert.throws(() => decodeSignRequest(encodeSignRequest({ ...base, action: { kind: "add-storage-credit", yoctoNear: "0.05" } } as SignRequest)));
});

test("the cross-chain cap is its own owner method, and its page says 0 turns other chains off", () => {
  const r: SignRequest = { ...base, action: { kind: "set-cross-chain-cap", crossChainCap: "20000000" } };
  const a = toTransactions(r)[0].actions[0];
  assert.ok(a.type === "FunctionCall");
  assert.deepEqual([a.params.methodName, a.params.args], ["set_cross_chain_cap", { cross_chain_daily_cap: "20000000" }]);
  const d = describe(r);
  assert.deepEqual(d.rows[0].value, "20.00 USDC");
  assert.match(d.intro, /0 turns payments on other chains off/);
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
    action: { kind: "approve", followupId: "m1-f3", payee: "designer.testnet", amount: "5000000000", context: { payeeName: "Designer", meeting: "Sync with Ada", heard: "the full five thousand", leftToday: "150.00 of 200.00" } },
  });
  assert.deepEqual(d.rows.map((r) => r.value), ["5,000.00 USDC", "Designer · designer.testnet", "Sync with Ada", "“the full five thousand”", "150.00 of 200.00 USDC"]);
  assert.deepEqual(d.rows.at(-1), { label: "Left today", value: "150.00 of 200.00 USDC", mono: true });
  // Parked over either cap; approving pays it once and still counts towards the day (lib.rs approve_pending).
  assert.match(d.intro, /Approving pays it once over your caps, and it counts towards today's spending\./);
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

test("a payee paid on Solana is added and opted in within one signing, each call 1 yoctoNEAR", () => {
  const destination = { chain: "solana" as const, address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" };
  const txs = toTransactions({ ...base, action: { kind: "add-payee", account: "designer.testnet", label: "Designer", registerWithUsdc: false, destination } });
  assert.deepEqual(
    txs.map((t) => t.actions[0].type === "FunctionCall" && [t.actions[0].params.methodName, t.actions[0].params.deposit]),
    [["add_payee", "1"], ["set_payee_destination", "1"]],
  );
  const a = txs[1].actions[0];
  assert.ok(a.type === "FunctionCall");
  assert.deepEqual(a.params.args, { payee: "designer.testnet", destination });
  const d = describe({ ...base, action: { kind: "add-payee", account: "designer.testnet", label: "Designer", registerWithUsdc: false, destination } });
  assert.ok(d.rows.some((r) => r.label === "Paid on" && r.value.startsWith("Solana")));

  const off = toTransactions({ ...base, action: { kind: "set-payee-destination", account: "designer.testnet", label: "Designer", destination: null } });
  assert.ok(off[0].actions[0].type === "FunctionCall" && off[0].actions[0].params.args.destination === null);
});

test("a link with a malformed payout address is refused", () => {
  const good: SignRequest = { ...base, action: { kind: "set-payee-destination", account: "designer.testnet", label: "Designer", destination: { chain: "base", address: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D" } } };
  assert.deepEqual(decodeSignRequest(encodeSignRequest(good)), good);
  for (const destination of [{ chain: "base", address: "0x123" }, { chain: "eth", address: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D" }]) {
    const bad = { ...base, action: { kind: "set-payee-destination", account: "designer.testnet", label: "Designer", destination } } as unknown as SignRequest;
    assert.throws(() => decodeSignRequest(encodeSignRequest(bad)), /BAD_DESTINATION/);
  }
});

const KEY = "ed25519:3w4RMJEvhWGNAjEWrrFgVNeXTqhiGrMvj4jHgYG67b6S";

test("first-time setup is one approval: USDC registration, register then set_cap in one transaction, and the limited key", () => {
  const r: SignRequest = { ...base, action: { kind: "setup", register: true, dailyCap: "25000000", publicKey: KEY, registerUsdc: true } };
  const txs = toTransactions(r);
  assert.deepEqual(txs.map((t) => t.receiverId), [USDC_CONTRACT.testnet, base.contract, base.owner]);

  const [usdc, wallet, key] = txs;
  const reg = usdc.actions[0];
  assert.ok(reg.type === "FunctionCall");
  assert.deepEqual([reg.params.methodName, reg.params.args, reg.params.deposit], ["storage_deposit", { account_id: base.owner, registration_only: true }, "1250000000000000000000"]);

  // One transaction, so NEAR runs register before set_cap and drops both if either fails.
  assert.deepEqual(
    wallet.actions.map((a) => a.type === "FunctionCall" && [a.params.methodName, a.params.args, a.params.deposit]),
    [["register", {}, "100000000000000000000000"], ["set_cap", { daily_cap: "25000000" }, "1"]],
  );

  // The same limited key as authorise-key, nothing wider.
  assert.deepEqual(key, toTransactions({ ...base, action: { kind: "authorise-key", publicKey: KEY } })[0]);

  const d = describe(r);
  assert.match(d.walletNote, /^Your wallet will ask you to approve 3 transactions at once: register and set_cap on wallet\.victor\.testnet, a limited key on victor\.testnet and storage_deposit on the USDC contract\./);
  assert.deepEqual(d.rows.map((x) => x.label), ["Agent wallet", "Daily cap", "This Mac's key", "May call", "Fee allowance", "USDC"]);
  assert.equal(d.rows[1].value, "25.00 USDC a day, all payments together");
  assert.deepEqual(decodeSignRequest(encodeSignRequest(r)), r);
});

test("setup asks only for what's missing: a new key alone is one AddKey transaction", () => {
  const r: SignRequest = { ...base, action: { kind: "setup", register: false, publicKey: KEY, registerUsdc: false } };
  const txs = toTransactions(r);
  assert.equal(txs.length, 1);
  assert.equal(txs[0].receiverId, base.owner);
  assert.equal(txs[0].actions[0].type, "AddKey");
  assert.equal(describe(r).title, "Authorise this Mac");
  assert.match(describe(r).walletNote, /^Your wallet will ask you to approve one transaction: a limited key on victor\.testnet\./);

  // No key yet: register (and the cap) only.
  assert.equal(describe({ ...base, action: { kind: "setup", register: false, registerUsdc: true } }).title, "Register with USDC");
  const walletOnly = toTransactions({ ...base, action: { kind: "setup", register: true, dailyCap: "0", registerUsdc: false } });
  assert.deepEqual(walletOnly.map((t) => [t.receiverId, t.actions.length]), [[base.contract, 2]]);
});

test("setup links with nothing to sign, a bad key, a bad cap or missing flags are refused", () => {
  const bad = (action: object) => assert.throws(() => decodeSignRequest(encodeSignRequest({ ...base, action } as SignRequest)));
  bad({ kind: "setup", register: false, registerUsdc: false });
  bad({ kind: "setup", register: true, publicKey: "secp256k1:abc", registerUsdc: false });
  bad({ kind: "setup", register: true, dailyCap: "25.5", registerUsdc: false });
  bad({ kind: "setup", register: true, dailyCap: null, registerUsdc: false });
  bad({ kind: "setup", register: "yes", registerUsdc: false });
  bad({ kind: "setup", register: true });
});
