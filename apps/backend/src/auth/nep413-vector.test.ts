import { test } from "node:test";
import assert from "node:assert/strict";
import { base64 } from "@scure/base";
import { verifySignature } from "./nep413";

// Produced by crates/near-tx (the desktop app's signer): seed of 32 x 0x02, nonce of 32 x 0x07.
test("the backend accepts the desktop app's NEP-413 signature (Rust and TypeScript agree)", () => {
  const signed = {
    accountId: "victor.testnet",
    publicKey: "ed25519:9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu",
    signature: "NoYRCFdYCUw2Eixxkqk+/CVhiKOXfABHTf7RqKoswlYaT+ymyWfHV7HEdUOISlrn1R1UNc+jzgwGzOfAKpIiAA==",
    message: "Sign in to Aftercall",
    nonce: base64.encode(new Uint8Array(32).fill(7)),
    recipient: "aftercall",
  };
  assert.equal(verifySignature(signed), true);
  assert.equal(verifySignature({ ...signed, recipient: "other" }), false);
});
