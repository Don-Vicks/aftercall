#!/usr/bin/env bash
# Runs everything for local development: backend (with Postgres), web pages and the Mac app.
#   ./scripts/dev.sh            # backend + web + desktop
#   ./scripts/dev.sh services   # backend + web only (e.g. with the bundled .app)
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${DATABASE_URL:-postgres://localhost/aftercall_dev}"
if command -v psql >/dev/null && ! psql "$DB" -c 'select 1' >/dev/null 2>&1; then
  echo "Creating the aftercall_dev database…"
  createdb aftercall_dev 2>/dev/null || true
fi
[ -f apps/backend/.env ] && set -a && . apps/backend/.env && set +a

trap 'kill 0' EXIT
DATABASE_URL="$DB" pnpm --filter @aftercall/backend dev &
pnpm --filter @aftercall/web dev &
if [ "${1:-}" != "services" ]; then
  pnpm dev:desktop &
fi
wait
