#!/usr/bin/env bash
# Run in local Terminal (outside Cursor sandbox) to free :8787 and start latest API.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDS=$(lsof -t -iTCP:8787 -sTCP:LISTEN 2>/dev/null || true)
if [[ -n "${PIDS}" ]]; then
  echo "Killing: $PIDS"
  kill -9 $PIDS || true
  sleep 1
fi
cd "$ROOT"
export HOST=0.0.0.0 PORT=8787
export CLASSROOM_DESK_DATA_DIR="${CLASSROOM_DESK_DATA_DIR:-$ROOT/apps/server/data}"
export JWT_SECRET="${JWT_SECRET:-dev-secret-change-me}"
echo "Data: $CLASSROOM_DESK_DATA_DIR"
echo "Starting on http://0.0.0.0:8787 …"
exec node --import tsx/esm apps/server/src/index.ts
