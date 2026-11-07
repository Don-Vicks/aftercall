import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDealEmail,
  checkDeal,
  confirmEscrowTransaction,
  dealLink,
  dealTermsFor,
  dealTermsHash,
  decodeDeal,
  escrowStateText,
  newDealSalt,
  readDealOnChain,
  returnEscrowTransaction,
  type DealTerms,
  type EscrowView,
} from "./deal.ts";
import { RECAP_FOOTER_MARK } from "./recap.ts";
import type { PaymentFollowUp } from "../meeting.ts";

const payment: PaymentFollowUp = {
  id: "f2",
  kind: "payment",
  status: "proposed",
  payeeName: "Kemi",
  payeeAccount: "kemi.testnet",
  payeeListed: true,
  amount: 500_000_000n,
  heard: "five hundred dollars",
  evidence: { quote: "I'll pay Kemi five hundred dollars", at: 40 },
  condition: { text: "when the icons are delivered", evidence: { quote: "once the icons are delivered on Friday", at: 40 } },
};
const at = {
  network: "testnet" as const,
  contract: "wallet.aftercall.testnet",
  owner: "victor.testnet",
  escrowId: "1793006441-f2",
  meetingId: "1793006441",
  proofHash: "ab".repeat(32),
  salt: "0123456789abcdef0123456789abcdef",
};
const terms = dealTermsFor({ title: "Icons for the launch" }, payment, at)!;

const escrowFor = (t: DealTerms): EscrowView => ({
  payee: t.payee,
  amount: t.amount,
  proof: { meeting_id: t.meetingId, proof_hash: t.proofHash },
  terms_hash: dealTermsHash(t),
  has_condition: t.condition !== null,
  state: "open",
  day: 20399,
  opened_at: "1762500000000000000",
  confirmed_at: "0",
});

test("the terms are the amount, the words heard, the condition and both quotes, from the follow-up", () => {
  assert.deepEqual(
    [terms.amount, terms.heard, terms.amountQuote, terms.condition, terms.conditionQuote, terms.payee],
    ["500000000", "five hundred dollars", "I'll pay Kemi five hundred dollars", "when the icons are delivered", "once the icons are delivered on Friday", "kemi.testnet"],
  );
  // Not a deal yet: no amount, or a payee who isn't on the list.
  assert.equal(dealTermsFor({ title: "x" }, { ...payment, amount: null }, at), null);
  assert.equal(dealTermsFor({ title: "x" }, { ...payment, payeeListed: false }, at), null);
  // The model heard a condition it couldn't quote: held without one, confirming would pay at once.
  assert.equal(dealTermsFor({ title: "x" }, { ...payment, condition: undefined, conditionDropped: true }, at), null);
  const plain = dealTermsFor({ title: "x" }, { ...payment, condition: undefined }, at)!;
  assert.deepEqual([plain.condition, plain.conditionQuote], [null, null]);
});

test("the hash changes with every term and the salt, and not with the names shown", () => {
  const h = dealTermsHash(terms);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(dealTermsHash({ ...terms }), h, "the same terms hash the same");
  const changed: Partial<DealTerms>[] = [
    { amount: "500000001" },
    { heard: "five hundred" },
    { amountQuote: "I'll pay Kemi five hundred" },
    { condition: "after the invoice" },
    { conditionQuote: "once the icons are delivered" },
    { payee: "eve.testnet" },
    { owner: "mallory.testnet" },
    { escrowId: "1793006441-f3" },
    { proofHash: "cd".repeat(32) },
    { salt: "f".repeat(32) },
  ];
  for (const c of changed) assert.notEqual(dealTermsHash({ ...terms, ...c }), h, JSON.stringify(c));
  assert.equal(dealTermsHash({ ...terms, payeeName: "K", meetingTitle: "Other" }), h, "display names aren't terms");
  assert.match(newDealSalt(), /^[0-9a-f]{32}$/);
  assert.notEqual(newDealSalt(), newDealSalt());
});

test("the confirm link carries the terms in its #fragment only, and anything odd is refused", () => {
  const link = dealLink("https://getaftercall.vercel.app/deal", terms);
  assert.ok(link.startsWith("https://getaftercall.vercel.app/deal#"));
  assert.ok(!link.includes("?"), "never in a query string, which a server would see");
  assert.deepEqual(decodeDeal(new URL(link).hash), terms);

  const encode = (t: unknown) => dealLink("https://x/deal", t as DealTerms).split("#")[1];
  for (const bad of [
    { ...terms, v: 2 },
    { ...terms, network: "devnet" },
    { ...terms, payee: "Kemi Testnet" },
    { ...terms, amount: "0" },
    { ...terms, amount: "5.5" },
    { ...terms, salt: "short" },
    { ...terms, amountQuote: "" },
    { ...terms, amountQuote: "x".repeat(601) },
    { ...terms, condition: null },
    { ...terms, escrowId: "x".repeat(65) },
  ]) {
    assert.throws(() => decodeDeal(encode(bad)), JSON.stringify(Object.keys(bad)));
  }
  assert.throws(() => decodeDeal("not-base64-json"));
});

test("the page passes a link only when every term matches the escrow and the proof on NEAR", () => {
  const proof = { proof_hash: terms.proofHash };
  const ok = checkDeal(terms, escrowFor(terms), proof);
  assert.ok(ok.every((c) => c.ok), JSON.stringify(ok));
  assert.deepEqual(ok.map((c) => c.label), ["Aftercall's contract", "Held on NEAR", "These exact terms", "Amount", "Paid to", "Condition", "The meeting's proof"]);

  const failing = (t: DealTerms, e: EscrowView | null, p = proof) => checkDeal(t, e, p).filter((c) => !c.ok).map((c) => c.label);
  // Someone edits the link: a bigger amount, no condition, other words.
  assert.deepEqual(failing({ ...terms, amount: "900000000" }, escrowFor(terms)), ["These exact terms", "Amount"]);
  assert.deepEqual(failing({ ...terms, condition: null, conditionQuote: null }, escrowFor(terms)), ["These exact terms", "Condition"]);
  assert.deepEqual(failing({ ...terms, amountQuote: "I'll pay Kemi nine hundred dollars" }, escrowFor(terms)), ["These exact terms"]);
  // The escrow on NEAR says something else.
  assert.deepEqual(failing(terms, { ...escrowFor(terms), payee: "eve.testnet" }), ["Paid to"]);
  assert.deepEqual(failing(terms, { ...escrowFor(terms), has_condition: false }), ["Condition"]);
  assert.deepEqual(failing(terms, escrowFor(terms), { proof_hash: "cd".repeat(32) }), ["The meeting's proof"]);
  assert.deepEqual(failing(terms, escrowFor(terms), null as unknown as typeof proof), ["The meeting's proof"]);
  assert.deepEqual(failing(terms, null), ["Held on NEAR"]);
});

test("a link to any other contract fails, however well its escrow matches: only Aftercall's own holds the money by its rules", () => {
  const proof = { proof_hash: terms.proofHash };
  const failing = (t: DealTerms) => checkDeal(t, escrowFor(t), proof).filter((c) => !c.ok).map((c) => c.label);
  // A look-alike contract that answers get_escrow and get_proof with exactly the link's terms.
  assert.deepEqual(failing({ ...terms, contract: "wallet-aftercall.testnet" }), ["Aftercall's contract"]);
  // No agent-wallet contract on mainnet yet, so no mainnet deal passes.
  assert.deepEqual(failing({ ...terms, network: "mainnet", contract: "wallet.aftercall.near" }), ["Aftercall's contract"]);
  assert.deepEqual(checkDeal({ ...terms, contract: "x.testnet" }, null, proof).filter((c) => !c.ok).map((c) => c.label), ["Aftercall's contract", "Held on NEAR"]);
});

test("the payee confirms exactly these terms with 1 yoctoNEAR, and can give the money back", () => {
  const tx = confirmEscrowTransaction(terms);
  assert.equal(tx.receiverId, terms.contract);
  const a = tx.actions[0];
  assert.ok(a.type === "FunctionCall");
  assert.deepEqual([a.params.methodName, a.params.args, a.params.deposit], ["confirm_escrow", { owner: "victor.testnet", escrow_id: "1793006441-f2", terms_hash: dealTermsHash(terms) }, "1"]);
  assert.equal(a.params.gas, "100000000000000", "enough to pay out at once when there's no condition");
  const back = returnEscrowTransaction(terms).actions[0];
  assert.ok(back.type === "FunctionCall" && back.params.methodName === "return_escrow" && back.params.deposit === "1");
});

test("the email carrying the link says what's checked, in the footer the backend requires", () => {
  const link = dealLink("https://x/deal", terms);
  const mail = buildDealEmail(terms, link, "Victor");
  assert.equal(mail.subject, "Confirm: 500.00 USDC from Victor");
  assert.ok(mail.text.includes(link));
  assert.ok(mail.text.includes(RECAP_FOOTER_MARK));
  assert.match(mail.text, /Aftercall can't check whether a condition was met/);
  assert.match(buildDealEmail({ ...terms, condition: null, conditionQuote: null }, link).text, /it's paid to kemi\.testnet straight away/);
});

test("escrow states read as plain words", () => {
  assert.equal(escrowStateText("open", "Kemi"), "Set aside · waiting for Kemi to confirm");
  assert.equal(escrowStateText("confirmed", "Kemi"), "Kemi confirmed · waiting for you to release it");
  assert.equal(escrowStateText("released", "Kemi"), "Released to Kemi");
});

test("the page reads the escrow and the proof from the contract named in the link, read-only", async () => {
  const asked: { method: string; args: unknown; account: string; finality: string }[] = [];
  const answers: Record<string, unknown> = { get_escrow: escrowFor(terms), get_proof: { proof_hash: terms.proofHash, model: "Qwen/Qwen3.8-27B", recorded_at: "1" } };
  const fakeFetch = (async (_url: string, init: { body: string }) => {
    const { params } = JSON.parse(init.body);
    asked.push({ method: params.method_name, args: JSON.parse(atob(params.args_base64)), account: params.account_id, finality: params.finality });
    const bytes = [...new TextEncoder().encode(JSON.stringify(answers[params.method_name]))];
    return { json: async () => ({ result: { result: bytes } }) };
  }) as unknown as typeof fetch;
  const read = await readDealOnChain(terms, "https://rpc.testnet.near.org", fakeFetch);
  assert.ok(checkDeal(terms, read.escrow, read.proof).every((c) => c.ok));
  assert.deepEqual(
    asked.map((a) => [a.method, a.args, a.account, a.finality]),
    [
      ["get_escrow", { owner: "victor.testnet", escrow_id: "1793006441-f2" }, "wallet.aftercall.testnet", "final"],
      ["get_proof", { owner: "victor.testnet", meeting_id: "1793006441" }, "wallet.aftercall.testnet", "final"],
    ],
  );
});
