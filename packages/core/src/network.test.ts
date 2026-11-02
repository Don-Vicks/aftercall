import { test } from "node:test";
import assert from "node:assert/strict";
import { NETWORK_CONFIG, accountFitsNetwork, exampleAccount, explorerAccountUrl, explorerTxUrl, parseNetwork, plainNearError } from "./network.ts";
import { USDC_CONTRACT } from "./wallet/actions.ts";

test("mainnet and testnet each have their own RPC, USDC and explorer", () => {
  assert.equal(NETWORK_CONFIG.mainnet.usdc, "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1");
  assert.equal(NETWORK_CONFIG.testnet.usdc, "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af");
  assert.equal(USDC_CONTRACT.mainnet, NETWORK_CONFIG.mainnet.usdc);
  assert.equal(USDC_CONTRACT.testnet, NETWORK_CONFIG.testnet.usdc);
  assert.doesNotMatch(NETWORK_CONFIG.mainnet.rpcUrl, /testnet|test\./);
  assert.match(NETWORK_CONFIG.testnet.rpcUrl, /test/);
  assert.equal(explorerTxUrl("mainnet", "abc"), "https://nearblocks.io/txns/abc");
  assert.equal(explorerTxUrl("testnet", "abc"), "https://testnet.nearblocks.io/txns/abc");
  assert.equal(explorerAccountUrl("mainnet", "wallet.victor.near"), "https://nearblocks.io/address/wallet.victor.near");
  assert.equal(exampleAccount("mainnet"), "yourname.near");
  assert.equal(exampleAccount("testnet", "name"), "name.testnet");
});

test("network names from config are checked", () => {
  assert.equal(parseNetwork(undefined), "testnet");
  assert.equal(parseNetwork("", "mainnet"), "mainnet");
  assert.equal(parseNetwork(" Mainnet "), "mainnet");
  assert.throws(() => parseNetwork("main"), /BAD_NETWORK/);
});

test("a testnet account can't be used on mainnet, and the other way round", () => {
  assert.equal(accountFitsNetwork("victor.near", "mainnet"), true);
  assert.equal(accountFitsNetwork("wallet.victor.near", "mainnet"), true);
  assert.equal(accountFitsNetwork("aurora", "mainnet"), true);
  assert.equal(accountFitsNetwork("victor.testnet", "mainnet"), false);
  assert.equal(accountFitsNetwork("victor.testnet", "testnet"), true);
  assert.equal(accountFitsNetwork("victor.near", "testnet"), false);
  const implicit = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
  assert.equal(accountFitsNetwork(implicit, "mainnet"), true);
  assert.equal(accountFitsNetwork(implicit, "testnet"), true);
  assert.equal(accountFitsNetwork("0x" + "ab".repeat(20), "mainnet"), true);
});

test("Aftercall's contract is built in where it's deployed, and fits its network", () => {
  assert.equal(NETWORK_CONFIG.testnet.agentWallet, "wallet.aftercall.testnet");
  assert.equal(NETWORK_CONFIG.mainnet.agentWallet, null);
  for (const n of ["testnet", "mainnet"] as const) {
    const id = NETWORK_CONFIG[n].agentWallet;
    if (id) assert.equal(accountFitsNetwork(id, n), true);
  }
});

test("NEAR failures read as plain sentences", () => {
  const at = { network: "testnet" as const, contract: "wallet.aftercall.testnet" };
  // As the RPC and wallets report them (shapes seen on testnet, 2 Nov 2026).
  assert.equal(plainNearError(new Error("RPC error UNKNOWN_ACCOUNT \"account wallet.aftercall.testnet does not exist while viewing\""), at), "No Aftercall contract at wallet.aftercall.testnet on testnet yet.");
  assert.equal(plainNearError('wasm execution failed with error: CompilationError(CodeDoesNotExist { account_id: "wallet.aftercall.testnet" })', at), "No Aftercall contract at wallet.aftercall.testnet on testnet yet.");
  assert.equal(plainNearError({ ActionError: { index: 0, kind: { AccountDoesNotExist: { account_id: "wallet.aftercall.testnet" } } } }, at), "No Aftercall contract at wallet.aftercall.testnet on testnet yet.");
  assert.equal(plainNearError({ ActionError: { kind: { FunctionCallError: { MethodResolveError: "MethodNotFound" } } } }, at), "wallet.aftercall.testnet isn't the Aftercall contract.");
  assert.equal(plainNearError("InvalidAccessKeyError: { NotEnoughAllowance: { allowance: 0 } }", at), "Authorise this Mac again: its key ran out of allowance.");
  assert.equal(plainNearError("account victor.testnet does not exist while viewing", at), "victor.testnet doesn't exist on testnet.");
  assert.equal(plainNearError({ ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: NOT_REGISTERED" } } } }, at), "Create your agent wallet first.");
  assert.equal(plainNearError("Smart contract panicked: PAUSED", at), "The contract refused it: PAUSED.");
  assert.equal(plainNearError(new Error("User rejected"), at), "User rejected");
});
