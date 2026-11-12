import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ledgerCsv } from "../export.ts";
import { chainCallFrom, ledgerFromChain, type ChainCall, type ChainState, type RpcTxStatus } from "./ledger.ts";

const OWNER = "demo-owner.aftercall.testnet";
const PAYEE = "demo-freelancer.aftercall.testnet";
const CONTRACT = "wallet.aftercall.testnet";
const USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const at = { network: "testnet" as const, contract: CONTRACT, owner: OWNER, usdc: USDC };

/**
 * Real transactions from NEAR testnet on 12 Nov (EXPERIMENTAL_tx_status, trimmed to what is
 * read): the command-line run (a deposit, a 0.50 payment within the caps, a 2.00 payment held
 * over the per-payment cap and approved in the owner's wallet, a deal refused for having no
 * proof) and the headless proof run in docs/proof-run.md.
 */
const fixture = JSON.parse(readFileSync(new URL("./fixtures/ledger-testnet-12nov.json", import.meta.url), "utf8")) as { at: number; key: ChainCall["key"]; tx: RpcTxStatus }[];
const calls = fixture.map((f) => chainCallFrom(f.tx, f.at, f.key)!);
const byHash = (prefix: string) => calls.find((c) => c.hash.startsWith(prefix))!;

/** What the contract's views said after those runs. */
const state: ChainState = {
  paid: new Set(["proof-12nov-in-cap", "proof-12nov-over-cap", "proof-run-202611120947-f1"]),
  pending: new Set(),
  escrows: new Map([["proof-run-202611120947-f2", { payee: PAYEE, amount: "500000", state: "released" as const }]]),
  labels: new Map([[PAYEE, "Illustrator"]]),
};

test("a transaction reads as its call, its return value and what its callbacks said", () => {
  const pay = byHash("Ay4Yte5e");
  assert.equal(pay.method, "pay");
  assert.equal(pay.signer, OWNER);
  assert.deepEqual(pay.args, { amount: "1000000", followup_id: "proof-run-202611120947-f1", meeting_id: "proof-run-202611120947", memo: "Aftercall payment", payee: PAYEE });
  assert.deepEqual(pay.value, { status: "sending", reason: null, left_today: "5000000", cross_chain_left_today: null });
  assert.deepEqual(pay.callbacks, { on_pay_complete: true }, "the transfer landed");
  assert.equal(pay.failure, null);

  assert.deepEqual(byHash("CGqtWddP").value, { status: "blocked", reason: "OVER_PAYMENT_CAP", left_today: "4500000", cross_chain_left_today: null });
  assert.deepEqual(byHash("8d7msRRg").callbacks, { on_escrow_released: true });
  assert.equal(byHash("4eEmcyis").value, "confirmed");
  assert.equal(byHash("Got5dPmi").value, "3000000", "a deposit returns the USDC the agent wallet kept");
  assert.equal(byHash("6ZM7p1DE").failure, "PROOF_NOT_FOUND");
  assert.equal(byHash("3ZDmriAJ").failure, "TERMS_DIFFER");

  const notACall = { ...fixture[0].tx, transaction: { ...fixture[0].tx.transaction, actions: ["CreateAccount"] } };
  assert.equal(chainCallFrom(notACall, 0, "unknown"), null, "only single function calls are on the trail");
});

test("12 Nov on testnet reads as a ledger: deposit, paid, held then approved, paid by the proof run, and its deal released", () => {
  const { rows, skipped } = ledgerFromChain(calls, state, at);
  assert.deepEqual(
    rows.map((r) => [r.date, r.meeting, r.payee, r.amount, r.status, r.approvedBy, r.tx.slice(0, 8), r.proofTx.slice(0, 8)]),
    [
      ["2026-11-12T08:34:13Z", "", "Your agent wallet", 3_000_000n, "deposited", "your wallet", "Got5dPmi", ""],
      ["2026-11-12T08:35:30Z", "", "Illustrator", 500_000n, "paid", "you or autopilot", "25hyBPU5", ""],
      ["2026-11-12T08:35:56Z", "", "Illustrator", 2_000_000n, "approved and paid", "your wallet", "6CbYm7qU", ""],
      ["2026-11-12T09:49:30Z", "proof-run-202611120947", "Illustrator", 1_000_000n, "paid", "you or autopilot", "Ay4Yte5e", "Af4cs3Pn"],
      ["2026-11-12T09:49:57Z", "proof-run-202611120947", "Illustrator", 500_000n, "released", "the payee confirmed, then you released it", "8d7msRRg", "Af4cs3Pn"],
    ],
  );
  assert.deepEqual(
    skipped.map((s) => [s.hash.slice(0, 8), s.method, s.why]),
    [
      ["6ZM7p1DE", "open_escrow", "PROOF_NOT_FOUND"],
      ["3ZDmriAJ", "confirm_escrow", "TERMS_DIFFER"],
    ],
    "refused calls moved nothing: listed, not rows",
  );

  const [deposit, inCap, approved, autopilot, deal] = rows;
  assert.equal(deposit.payeeAccount, CONTRACT);
  assert.match(deposit.note, /USDC from your NEAR account demo-owner\.aftercall\.testnet into your agent wallet\./);
  assert.equal(inCap.payeeAccount, PAYEE);
  assert.match(inCap.note, /Memo: "Logo draft, as agreed on the call"\. No meeting proof is linked to it on NEAR\./);
  assert.match(approved.note, /^Over your per-payment cap, so the contract held it on 2026-11-12T08:35:41Z \(transaction CGqtWddPhTKHMPqPbRRConbC7wSxAo8oSsYzTb5HEdfm\); you approved it in your wallet, which paid it\./);
  assert.equal(autopilot.note, "Paid from your agent wallet within your caps.", "the app's own memo isn't repeated");
  assert.equal(
    deal.note,
    "Set aside in the contract on 2026-11-12T09:49:37Z (transaction AFvFRrFxu5dNkXEawpWF3RuptPTEjZR9fVqSLxmHZDWi); the payee confirmed the terms from their own NEAR account on 2026-11-12T09:49:50Z (transaction 4eEmcyisyppCVkXDN7ikymrQDSLw5oEtoLqXs7trLcLp); then you released it to them.",
  );

  const csv = ledgerCsv(rows);
  assert.match(csv, /"2026-11-12T09:49:30Z","proof-run-202611120947","Illustrator","demo-freelancer\.aftercall\.testnet","1\.00","USDC","paid","you or autopilot","https:\/\/testnet\.nearblocks\.io\/txns\/Ay4Yte5eqPX5MYg676jfAjiBcCQgnyoXnSG1faFVcPDP","https:\/\/testnet\.nearblocks\.io\/txns\/Af4cs3PnouGWKhciSgbHmmE1kgqD1rsggXT4GdtLJZzi"/);
});

// ---------- Every other path, on made-up calls ----------

let n = 0;
function call(method: string, args: Record<string, unknown>, more: Partial<ChainCall> = {}): ChainCall {
  n += 1;
  return { hash: `Tx${n}`, at: Date.UTC(2026, 10, 12, 10, n), signer: OWNER, receiver: CONTRACT, method, args, key: "limited", failure: null, value: null, callbacks: {}, ...more };
}
const none: ChainState = { paid: new Set(), pending: new Set(), escrows: new Map(), labels: new Map() };
const rowsOf = (cs: ChainCall[], s: Partial<ChainState> = {}) => ledgerFromChain(cs, { ...none, ...s }, at).rows;
const pay = (id: string, more: Partial<ChainCall> = {}) =>
  call("pay", { payee: PAYEE, amount: "5000000000", followup_id: id, meeting_id: "m1" }, { value: { status: "sending", reason: null }, callbacks: { on_pay_complete: true }, ...more });
const held = (id: string, reason = "OVER_CAP") => pay(id, { value: { status: "blocked", reason }, callbacks: {} });

test("a held payment waits, is declined, or is paid; a bounced transfer is refunded", () => {
  const [waiting] = rowsOf([held("a")], { pending: new Set(["a"]) });
  assert.deepEqual([waiting.status, waiting.approvedBy, waiting.amount], ["held for approval", "", 5_000_000_000n]);
  assert.match(waiting.note, /^Over your daily cap, so the contract holds it for your wallet\. Nothing has been paid\./);

  const h = held("b");
  const cancel = call("cancel_pending", { followup_id: "b" }, { key: "full-access" });
  const [declined] = rowsOf([h, cancel]);
  assert.deepEqual([declined.status, declined.approvedBy, declined.tx], ["declined", "your wallet", cancel.hash]);
  assert.match(declined.note, new RegExp(`held it on .* \\(transaction ${h.hash}\\); you declined it in your wallet\\. Nothing was paid\\.`));

  const [bounced] = rowsOf([pay("c", { callbacks: { on_pay_complete: false } })]);
  assert.deepEqual([bounced.status, bounced.approvedBy], ["failed and refunded", "you or autopilot"]);
  const [approvedBounced] = rowsOf([held("d"), call("approve_pending", { followup_id: "d" }, { key: "full-access", callbacks: { on_pay_complete: false } })]);
  assert.deepEqual([approvedBounced.status, approvedBounced.approvedBy], ["failed and refunded", "your wallet"]);

  const [byWallet] = rowsOf([pay("e", { key: "full-access" })], { paid: new Set(["e"]) });
  assert.equal(byWallet.approvedBy, "your wallet", "a payment the owner's own key signed");
});

test("the contract's views say where a payment stands now, and the note says when the transactions read disagree", () => {
  const [r] = rowsOf([held("a")], { paid: new Set(["a"]) });
  assert.equal(r.status, "approved and paid");
  assert.match(r.note, /\(The transactions read here end with it held for approval; the contract says approved and paid now\.\)$/);
  const [same] = rowsOf([pay("b")], { paid: new Set(["b"]) });
  assert.doesNotMatch(same.note, /the contract says/);
});

test("a deal is held, set aside, confirmed, released, given back or taken back", () => {
  const open = (id: string, state = "open") => call("open_escrow", { escrow_id: id, payee: PAYEE, amount: "500000", meeting_id: "m1", has_condition: true }, { value: { state, reason: state === "parked" ? "OVER_PAYMENT_CAP" : null } });
  const confirm = (id: string, value = "confirmed", callbacks = {}) => call("confirm_escrow", { owner: OWNER, escrow_id: id }, { signer: PAYEE, key: "unknown", value, callbacks });
  const one = (cs: ChainCall[]) => rowsOf(cs)[0];

  const parked = one([open("p", "parked")]);
  assert.deepEqual([parked.status, parked.approvedBy], ["held for approval", ""]);
  assert.match(parked.note, /^Over your per-payment cap, so the deal waits for your wallet/);

  const o = open("o");
  const waiting = one([o]);
  assert.deepEqual([waiting.status, waiting.approvedBy, waiting.tx], ["in escrow", "you", o.hash]);
  assert.match(waiting.note, /waits for the payee to confirm the terms/);

  const approvedInWallet = one([open("w", "parked"), call("approve_escrow", { escrow_id: "w" }, { key: "full-access" })]);
  assert.deepEqual([approvedInWallet.status, approvedInWallet.approvedBy], ["in escrow", "your wallet"]);

  // Made in time order: a call's time is when it's made here.
  const oc = open("c");
  const c = confirm("c");
  const confirmed = one([c, oc]);
  assert.equal(confirmed.status, "in escrow");
  assert.match(confirmed.note, new RegExp(`the payee confirmed the terms from their own NEAR account on .* \\(transaction ${c.hash}\\)\\. It's paid when you release it\\.`));

  const oa = open("a");
  const auto = confirm("a", "released", { on_escrow_released: true });
  const released = one([auto, oa]);
  assert.deepEqual([released.status, released.approvedBy, released.tx], ["released", "the payee confirmed", auto.hash]);
  assert.match(released.note, /which released it to them\.$/);

  const bounced = one([open("b"), confirm("b"), call("release_escrow", { escrow_id: "b" }, { callbacks: { on_escrow_released: false } })]);
  assert.equal(bounced.status, "in escrow", "a release whose transfer bounced is confirmed again, money still set aside");

  const given = one([open("g"), call("return_escrow", { owner: OWNER, escrow_id: "g" }, { signer: PAYEE, key: "unknown" })]);
  assert.deepEqual([given.status, given.approvedBy], ["returned", "the payee"]);
  assert.match(given.note, /the payee gave it back\. The amount is back in your agent wallet; nothing was paid\./);

  const taken = one([open("t"), call("cancel_escrow", { escrow_id: "t" }, { key: "full-access" })]);
  assert.deepEqual([taken.status, taken.approvedBy], ["returned", "your wallet"]);

  const [fromView] = rowsOf([open("v")], { escrows: new Map([["v", { payee: PAYEE, amount: "500000", state: "returned" as const }]]) });
  assert.deepEqual([fromView.status, fromView.approvedBy], ["returned", "the payee"], "the contract's state wins over a trail that stops early");
});

test("withdrawals and deposits are rows; a deposit the wallet didn't keep is not", () => {
  const w = call("withdraw", { amount: "2500000" }, { key: "full-access", callbacks: { on_withdraw_complete: true } });
  assert.deepEqual(
    rowsOf([w]).map((r) => [r.payee, r.payeeAccount, r.amount, r.status, r.approvedBy]),
    [["You", OWNER, 2_500_000n, "withdrawn", "your wallet"]],
  );
  assert.equal(rowsOf([call("withdraw", { amount: "1" }, { key: "full-access", callbacks: { on_withdraw_complete: false } })])[0].status, "failed and refunded");

  const deposit = (value: unknown, receiver_id = CONTRACT) => call("ft_transfer_call", { receiver_id, amount: "1000000", msg: "" }, { receiver: USDC, key: "full-access", value });
  assert.equal(rowsOf([deposit("1000000")])[0].status, "deposited");
  const back = ledgerFromChain([deposit("0")], none, at);
  assert.deepEqual([back.rows.length, back.skipped[0]?.why], [0, "Not credited (the agent wallet wasn't registered), so the USDC went back"]);
  assert.equal(rowsOf([deposit("1000000", "someone-else.testnet")]).length, 0, "USDC sent anywhere else isn't this wallet's");
});

test("only this owner's calls are on the trail: other signers, other owners' deals and other contracts are left out", () => {
  const theirs = call("confirm_escrow", { owner: "someone.testnet", escrow_id: "x" }, { signer: PAYEE, value: "confirmed" });
  const stranger = pay("s", { signer: "someone.testnet" });
  const elsewhere = pay("e", { receiver: "other-wallet.testnet" });
  const ownerOnly = call("set_cap", { daily_cap: "1" });
  const payeeCantPay = pay("p", { signer: PAYEE, args: { owner: OWNER, followup_id: "p", payee: PAYEE, amount: "1" } });
  assert.deepEqual(ledgerFromChain([theirs, stranger, elsewhere, ownerOnly, payeeCantPay], none, at), { rows: [], skipped: [] });
});
