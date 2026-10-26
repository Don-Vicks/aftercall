#!/usr/bin/env bash
# Deploys the agent-wallet contract to NEAR testnet as a sub-account of yours.
#
#   ./scripts/deploy-testnet.sh yourname.testnet            # deploys to wallet.yourname.testnet
#   ./scripts/deploy-testnet.sh yourname.testnet my-wallet  # deploys to my-wallet.yourname.testnet
#
# Needs near-cli-rs (`near`) with yourname.testnet's key in the keychain, and
# cargo-near. Costs about 3 NEAR of testnet tokens (storage for a ~180 KB contract).
set -euo pipefail

OWNER="${1:?usage: deploy-testnet.sh yourname.testnet [prefix]}"
CONTRACT="${2:-wallet}.${OWNER}"
# Circle USDC on NEAR testnet (6 decimals).
USDC="3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af"
NET="network-config testnet"

cd "$(dirname "$0")/../agent-wallet"
echo "Building agent-wallet…"
cargo near build non-reproducible-wasm
WASM="../target/near/agent_wallet/agent_wallet.wasm"

echo "Creating ${CONTRACT}…"
near account create-account fund-myself "${CONTRACT}" '3 NEAR' \
  autogenerate-new-keypair save-to-keychain sign-as "${OWNER}" ${NET} sign-with-keychain send

echo "Deploying and initialising with USDC ${USDC}…"
near contract deploy "${CONTRACT}" use-file "${WASM}" \
  with-init-call new json-args "{\"usdc\":\"${USDC}\"}" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  ${NET} sign-with-keychain send

echo "Registering the contract with USDC so it can hold and send tokens…"
near contract call-function as-transaction "${USDC}" storage_deposit \
  json-args "{\"account_id\":\"${CONTRACT}\"}" prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' \
  sign-as "${OWNER}" ${NET} sign-with-keychain send

echo
echo "Done. Agent-wallet contract: ${CONTRACT}"
echo "In Aftercall → Settings, enter ${OWNER} and ${CONTRACT}, then run the two commands it shows."
echo "Before mainnet, delete the contract account's full-access key so nobody can redeploy it (M5)."
