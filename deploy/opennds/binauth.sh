#!/usr/bin/env bash
# openNDS BinAuth hook — allow only if Classroom Desk gateway allowlist says yes.
# Install as BinAuth script (see docs/OPENNDS_BINAUTH.md).
#
# openNDS calls BinAuth with: <clientmac> <clientip> ... (version-dependent).
# We only need client IP for /api/v1/gateway/check.
set -euo pipefail

CD_API_BASE="${CD_API_BASE:-http://127.0.0.1:8787}"
CLIENTIP="${2:-${1:-}}"

if [[ -z "$CLIENTIP" ]]; then
  echo "binauth: missing client ip" >&2
  exit 1
fi

# Strip zone id if present (some openNDS builds pass ip/zone)
CLIENTIP="${CLIENTIP%%/*}"

json="$(curl -fsS --max-time 3 "${CD_API_BASE%/}/api/v1/gateway/check?ip=$(printf %s "$CLIENTIP" | jq -sRr @uri)" 2>/dev/null || true)"
if echo "$json" | jq -e '.allowed == true' >/dev/null 2>&1; then
  exit 0
fi
exit 1
