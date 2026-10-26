#!/usr/bin/env bash
# Deploys the agent-wallet contract to NEAR MAINNET as a sub-account of yours, with
# tiny caps on your own wallet, then (as a separate, confirmed step) locks it.
#
#   ./scripts/deploy-mainnet.sh yourname.near              # deploys to wallet.yourname.near
#   ./scripts/deploy-mainnet.sh yourname.near my-wallet    # deploys to my-wallet.yourname.near
#   ./scripts/deploy-mainnet.sh --lock wallet.yourname.near   # only the lock step, later
#   DRY_RUN=1 ./scripts/deploy-mainnet.sh yourname.near    # prints every command, signs nothing
#
# Real money: every step that signs asks you to type the account id first.
# Locking deletes the contract account's full-access keys. It can't be undone:
# nobody, you included, can redeploy, upgrade or delete the contract afterwards.
#
# Needs near-cli-rs (`near`) with yourname.near's key in the keychain, cargo-near,
# curl and node. Costs about 3 NEAR (storage for a ~180 KB contract) plus 0.1 NEAR
# for your own wallet's registration and 0.00125 NEAR for USDC storage.
#
# Env: DAILY_CAP_USDC (default 5), PAYMENT_CAP_USDC (default 2), CONTRACT_FUNDING (default '3 NEAR'),
#      NEAR_RPC_URL (default https://free.rpc.fastnear.com).
set -euo pipefail

# Circle USDC on NEAR mainnet (6 decimals).
USDC="17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"
NET="network-config mainnet"
RPC="${NEAR_RPC_URL:-https://free.rpc.fastnear.com}"
DAILY_CAP_USDC="${DAILY_CAP_USDC:-5}"
PAYMENT_CAP_USDC="${PAYMENT_CAP_USDC:-2}"
CONTRACT_FUNDING="${CONTRACT_FUNDING:-3 NEAR}"
DRY_RUN="${DRY_RUN:-0}"

usage() { echo "usage: deploy-mainnet.sh yourname.near [prefix]  |  deploy-mainnet.sh --lock contract.near"; exit 1; }

# Runs a command, or only prints it under DRY_RUN=1.
run() {
  printf '  $'; printf ' %q' "$@"; printf '\n'
  [ "$DRY_RUN" = 1 ] || "$@"
}

# Asks the person to type `expected` exactly. Anything else stops the script.
confirm() {
  local prompt="$1" expected="$2" answer=""
  if [ ! -t 0 ] && [ "$DRY_RUN" != 1 ]; then
    echo "Refusing to run without a terminal: this needs you to type '${expected}'." >&2
    exit 1
  fi
  printf '\n%s\nType %s to continue (anything else stops): ' "$prompt" "$expected"
  read -r answer || true
  if [ "$answer" != "$expected" ]; then
    echo "Stopped. Nothing more was signed."
    exit 1
  fi
}

# Stops when a tool is missing (only warns under DRY_RUN, which runs none of them).
need() {
  command -v "$1" >/dev/null && return 0
  if [ "$DRY_RUN" = 1 ]; then echo "(dry run) $1 isn't installed: $2"; return 0; fi
  echo "Needs $1: $2" >&2
  exit 1
}

valid_account() { [[ "$1" =~ ^([a-z0-9]+[-_])*[a-z0-9]+(\.([a-z0-9]+[-_])*[a-z0-9]+)*$ ]] && [ ${#1} -ge 2 ] && [ ${#1} -le 64 ]; }

# Whole USDC to the token's 6-decimal units.
usdc_units() {
  [[ "$1" =~ ^[0-9]{1,6}$ ]] || { echo "Caps are whole USDC (0-999999), got '$1'" >&2; exit 1; }
  echo "$(( 10#$1 * 1000000 ))"
}

# The public keys of the account's full-access keys, comma-separated, read over RPC.
full_access_keys() {
  curl -fsS "$RPC" -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":\"aftercall\",\"method\":\"query\",\"params\":{\"request_type\":\"view_access_key_list\",\"finality\":\"final\",\"account_id\":\"$1\"}}" |
    node -e '
      let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => {
        if (!s) process.exit(2);
        const body = JSON.parse(s);
        if (body.error || !body.result) { console.error(JSON.stringify(body.error ?? body)); process.exit(2); }
        const keys = body.result.keys.filter((k) => k.access_key.permission === "FullAccess").map((k) => k.public_key);
        process.stdout.write(keys.join(","));
      });'
}

lock() {
  local contract="$1" keys
  echo
  echo "Lock ${contract}"
  echo "  Deletes every full-access key on the contract account. Afterwards:"
  echo "  - nobody can redeploy, upgrade or delete the contract, or move the account's NEAR;"
  echo "  - users keep working: owners still change rules with their own wallets (1 yoctoNEAR),"
  echo "    the app's limited keys still pay and record proofs, and owners can always withdraw;"
  echo "  - a bug in the code can't be fixed in place. You would deploy a new contract and move users."
  echo "  This can't be undone."
  keys="$(full_access_keys "$contract")" || { echo "Couldn't read ${contract}'s keys from ${RPC}." >&2; [ "$DRY_RUN" = 1 ] || exit 1; keys="ed25519:<key>"; }
  if [ -z "$keys" ]; then
    echo "  ${contract} has no full-access keys: it's already locked."
    return 0
  fi
  echo "  Full-access keys to delete: ${keys}"
  confirm "Permanently lock ${contract}?" "LOCK ${contract}"
  run near account delete-keys "$contract" public-keys "$keys" ${NET} sign-with-keychain send
  [ "$DRY_RUN" = 1 ] && return 0
  if [ -n "$(full_access_keys "$contract")" ]; then
    echo "A full-access key is still on ${contract}. Check with: near account list-keys ${contract} ${NET} now" >&2
    exit 1
  fi
  echo "Locked. Check any time: near account list-keys ${contract} ${NET} now (no full-access keys listed)."
}

[ "$DRY_RUN" = 1 ] && echo "DRY RUN: commands are printed, nothing is signed."

if [ "${1:-}" = "--lock" ]; then
  CONTRACT="${2:-}"
  valid_account "$CONTRACT" || usage
  [[ "$CONTRACT" == *.testnet ]] && { echo "${CONTRACT} is a testnet account."; exit 1; }
  need near "https://github.com/near/near-cli-rs#installation"
  lock "$CONTRACT"
  exit 0
fi

OWNER="${1:-}"
valid_account "$OWNER" || usage
[[ "$OWNER" == *.testnet ]] && { echo "${OWNER} is a testnet account. Use ./scripts/deploy-testnet.sh for testnet."; exit 1; }
PREFIX="${2:-wallet}"
CONTRACT="${PREFIX}.${OWNER}"
valid_account "$CONTRACT" || usage
DAILY_CAP="$(usdc_units "$DAILY_CAP_USDC")"
PAYMENT_CAP="$(usdc_units "$PAYMENT_CAP_USDC")"

need near "https://github.com/near/near-cli-rs#installation (then: near account import-account)"
need cargo-near "https://github.com/near/cargo-near#installation"
need node "https://nodejs.org"
need curl "your package manager"

echo "Deploy the Aftercall agent wallet to NEAR MAINNET"
echo "  Contract:          ${CONTRACT} (funded with ${CONTRACT_FUNDING} from ${OWNER})"
echo "  USDC:              ${USDC} (Circle)"
echo "  Your wallet caps:  ${DAILY_CAP_USDC} USDC a day, ${PAYMENT_CAP_USDC} USDC a payment"
echo "  Every transaction is signed by ${OWNER}'s key from your keychain."
confirm "This spends real NEAR on mainnet." "$CONTRACT"

cd "$(dirname "$0")/../agent-wallet"
echo
echo "Building agent-wallet…"
run cargo near build non-reproducible-wasm
WASM="../target/near/agent_wallet/agent_wallet.wasm"
[ "$DRY_RUN" = 1 ] || shasum -a 256 "$WASM"

echo
echo "Creating ${CONTRACT}…"
run near account create-account fund-myself "${CONTRACT}" "${CONTRACT_FUNDING}" \
  autogenerate-new-keypair save-to-keychain sign-as "${OWNER}" ${NET} sign-with-keychain send

echo
echo "Deploying and initialising with USDC ${USDC}…"
run near contract deploy "${CONTRACT}" use-file "${WASM}" \
  with-init-call new json-args "{\"usdc\":\"${USDC}\"}" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  ${NET} sign-with-keychain send

echo
echo "Registering the contract with USDC so it can hold and send tokens…"
run near contract call-function as-transaction "${USDC}" storage_deposit \
  json-args "{\"account_id\":\"${CONTRACT}\"}" prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' \
  sign-as "${OWNER}" ${NET} sign-with-keychain send

echo
echo "Creating your own agent wallet with tiny caps (signed by ${OWNER}, 1 yoctoNEAR each)…"
run near contract call-function as-transaction "${CONTRACT}" register json-args '{}' \
  prepaid-gas '30 Tgas' attached-deposit '0.1 NEAR' sign-as "${OWNER}" ${NET} sign-with-keychain send
run near contract call-function as-transaction "${CONTRACT}" set_cap json-args "{\"daily_cap\":\"${DAILY_CAP}\"}" \
  prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as "${OWNER}" ${NET} sign-with-keychain send
run near contract call-function as-transaction "${CONTRACT}" set_payment_cap json-args "{\"per_payment_cap\":\"${PAYMENT_CAP}\"}" \
  prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as "${OWNER}" ${NET} sign-with-keychain send

echo
echo "Checking…"
run near contract call-function as-read-only "${CONTRACT}" get_usdc json-args '{}' ${NET} now
run near contract call-function as-read-only "${CONTRACT}" get_wallet json-args "{\"owner\":\"${OWNER}\"}" ${NET} now

echo
echo "Deployed: ${CONTRACT}. Try it with a tiny deposit before locking."
echo "Locking is separate and permanent. You can also run it later: ./scripts/deploy-mainnet.sh --lock ${CONTRACT}"
lock "${CONTRACT}"

echo
echo "Done. In Aftercall → Settings, pick Mainnet and enter ${OWNER} and ${CONTRACT}."
echo "Backend: AFTERCALL_NETWORK=mainnet AFTERCALL_CONTRACT=${CONTRACT}"
