#!/usr/bin/env bash
# DeskDNS :53 acceptance on the teacher host.
# Usage: CLASSROOM_DESK_API=http://127.0.0.1:8787 ./scripts/deskdns-port53-check.sh
set -euo pipefail

API="${CLASSROOM_DESK_API:-http://127.0.0.1:8787}"
OUT_DIR="${DESKDNS_EVIDENCE_DIR:-./tmp/deskdns-evidence}"
mkdir -p "$OUT_DIR"

echo "== /health deskDns =="
curl -fsS "$API/health" | tee "$OUT_DIR/health.json" | (command -v jq >/dev/null && jq '.deskDns, .shield' || cat)

echo "== ss -ulnp | grep :53 =="
if command -v ss >/dev/null 2>&1; then
  ss -ulnp 2>/dev/null | tee "$OUT_DIR/ss-ulnp.txt" | grep -E ':53\b' || {
    echo "WARN: no listener on udp/53 (ok if using 5353 or CAP missing)" | tee -a "$OUT_DIR/ss-ulnp.txt"
  }
else
  echo "ss not available on this host" | tee "$OUT_DIR/ss-ulnp.txt"
fi

echo "== evidence dir: $OUT_DIR =="
echo "Paste health.json + ss-ulnp.txt into ops ticket / PR for DeskDNS:53 sign-off."
