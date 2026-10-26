import { test } from "node:test";
import assert from "node:assert/strict";
import { NETWORK_CONFIG, accountFitsNetwork, exampleAccount, explorerAccountUrl, explorerTxUrl, parseNetwork } from "./network.ts";
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
