#!/usr/bin/env bash
# openNDS / FAS helper: poll Classroom Desk gateway allowlist and authorize clients.
# Usage (cron or openNDS custom script):
#   CD_API_BASE=http://teacher:8787 CD_STAFF_TOKEN=... ./auth_allowlist.sh
#
# Requires: curl, jq
# openNDS: set FAS / BinAuth to call this, or run every 15s via systemd timer.

set -euo pipefail

CD_API_BASE="${CD_API_BASE:-http://127.0.0.1:8787}"
CD_STAFF_TOKEN="${CD_STAFF_TOKEN:-}"
STATE_DIR="${CD_OPENNDS_STATE:-/var/lib/classroom-desk/opennds}"
mkdir -p "$STATE_DIR"

if [[ -z "$CD_STAFF_TOKEN" ]]; then
  echo "CD_STAFF_TOKEN required (teacher/admin JWT)" >&2
  exit 1
fi

json="$(curl -fsS \
  -H "Authorization: Bearer ${CD_STAFF_TOKEN}" \
  "${CD_API_BASE%/}/api/v1/gateway/allowlist")"

echo "$json" | jq -e '.items' >/dev/null

now="$(date +%s)"
echo "$json" | jq -c '.items[]?' | while read -r row; do
  ip="$(echo "$row" | jq -r '.ip // empty')"
  client_key="$(echo "$row" | jq -r '.clientKey // empty')"
  exp="$(echo "$row" | jq -r '.expiresAt // empty')"
  if [[ -z "$ip" || "$ip" == "null" ]]; then
    continue
  fi
  if [[ -n "$exp" && "$exp" != "null" ]]; then
    # ISO expiry — skip if past (best-effort via date -d when available)
    if date -d "$exp" +%s >/dev/null 2>&1; then
      exp_s="$(date -d "$exp" +%s)"
      if (( exp_s < now )); then
        continue
      fi
    fi
  fi
  marker="$STATE_DIR/allowed_${ip//\//_}"
  if [[ -f "$marker" ]]; then
    continue
  fi
  # Prefer ndsctl when present (openNDS / nodogsplash family).
  if command -v ndsctl >/dev/null 2>&1; then
    ndsctl auth "$ip" || true
  elif command -v openndsctl >/dev/null 2>&1; then
    openndsctl auth "$ip" || true
  else
    echo "authorize ip=$ip clientKey=$client_key (no ndsctl; log only)"
  fi
  touch "$marker"
done

# De-auth IPs no longer on allowlist (optional cleanup)
if command -v ndsctl >/dev/null 2>&1 || command -v openndsctl >/dev/null 2>&1; then
  allowed_ips="$(echo "$json" | jq -r '.items[]?.ip // empty')"
  for marker in "$STATE_DIR"/allowed_*; do
    [[ -e "$marker" ]] || continue
    ip="${marker##*/allowed_}"
    ip="${ip//_//}"
    if ! grep -qxF "$ip" <<<"$allowed_ips"; then
      if command -v ndsctl >/dev/null 2>&1; then
        ndsctl deauth "$ip" || true
      else
        openndsctl deauth "$ip" || true
      fi
      rm -f "$marker"
    fi
  done
fi

echo "opennds sync ok ($(echo "$json" | jq '.items | length') entries)"
