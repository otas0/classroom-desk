#!/usr/bin/env sh
# Exam Box policy poller — follows Classroom Desk (DeskDNS + gateway + deep-lock allowlist).
# Writes JSON snapshots under STATE_DIR for openNDS / local scripts.
#
#   CD_API_BASE=http://teacher:8787 ./policy-sync.sh
# Or loop: while true; do ./policy-sync.sh; sleep 15; done

set -eu

CD_API_BASE="${CD_API_BASE:-http://127.0.0.1:8787}"
STATE_DIR="${CD_EXAM_BOX_STATE:-/var/lib/classroom-desk/exam-box}"
BASE="${CD_API_BASE%/}"
mkdir -p "$STATE_DIR"

fetch() {
  path="$1"
  out="$2"
  if curl -fsS --connect-timeout 5 --max-time 15 "${BASE}${path}" -o "$out.tmp"; then
    mv "$out.tmp" "$out"
    return 0
  fi
  rm -f "$out.tmp"
  return 1
}

ok=0
fetch /api/v1/desk-dns/policy "$STATE_DIR/desk-dns-policy.json" && ok=$((ok + 1)) || true
fetch /api/v1/gateway/policy "$STATE_DIR/gateway-policy.json" && ok=$((ok + 1)) || true
fetch /api/v1/shield/policy "$STATE_DIR/shield-policy.json" && ok=$((ok + 1)) || true
fetch /api/v1/network-zones/export "$STATE_DIR/network-zones-export.json" && ok=$((ok + 1)) || true

# Combined lesson snapshot for local consumers.
if [ -f "$STATE_DIR/gateway-policy.json" ]; then
  cp "$STATE_DIR/gateway-policy.json" "$STATE_DIR/lesson-policy.json"
elif [ -f "$STATE_DIR/desk-dns-policy.json" ]; then
  cp "$STATE_DIR/desk-dns-policy.json" "$STATE_DIR/lesson-policy.json"
fi

# Hint file for ops / healthchecks
{
  echo "at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "api=$BASE"
  echo "fetched=$ok"
  if [ -f "$STATE_DIR/gateway-policy.json" ] && command -v jq >/dev/null 2>&1; then
    echo "netMode=$(jq -r '.deepLock.netMode // empty' "$STATE_DIR/gateway-policy.json")"
    echo "allowedIps=$(jq -r '.allowedIps | length' "$STATE_DIR/gateway-policy.json")"
  fi
} >"$STATE_DIR/sync.status"

echo "exam-box policy-sync: $ok endpoints from $BASE → $STATE_DIR"
[ "$ok" -gt 0 ]
