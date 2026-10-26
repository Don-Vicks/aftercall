#!/usr/bin/env bash
# Every check in the repo, from a clean checkout:
#   pnpm verify          # everything, including the contract on a local NEAR node (~5 min)
#   pnpm verify --quick  # skips the NEAR node tests
#
# Needs Node 24, pnpm 10, Rust stable with the wasm32-unknown-unknown target and cargo-near.
# Set DATABASE_URL to also run the claim-link tests against Postgres.
set -uo pipefail
cd "$(dirname "$0")/.."

QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1
results=()
failed=0

step() {
  local name="$1"; shift
  printf '\n\033[1m▸ %s\033[0m\n' "$name"
  if "$@"; then results+=("✓ $name"); else results+=("✗ $name"); failed=1; fi
}

step "Install" pnpm install --frozen-lockfile --silent
step "Typecheck (core, backend, web, desktop, mcp)" pnpm -r typecheck
step "Unit tests (core, backend, MCP server incl. a stdio tools/list run)" pnpm -r test
step "Web build (Verify, sign, claim pages)" pnpm --filter @aftercall/web build
step "NEAR signer (crates/near-tx)" cargo test --quiet --manifest-path crates/near-tx/Cargo.toml
step "Desktop recorder and NEAR AI transport" bash -c "pnpm --filter @aftercall/desktop build >/dev/null && cargo test --quiet --manifest-path apps/desktop/src-tauri/Cargo.toml"
step "Agent-wallet contract (unit)" cargo test --quiet --manifest-path contracts/Cargo.toml -p agent-wallet --lib
if [ "$QUICK" = 0 ]; then
  step "Agent-wallet contract on a local NEAR node (sandbox)" cargo test --quiet --manifest-path contracts/Cargo.toml -p agent-wallet --test sandbox -- --test-threads=1
fi

printf '\n\033[1mSummary\033[0m\n'
printf '%s\n' "${results[@]}"
exit $failed
