#!/usr/bin/env bash
# openNDS / FAS helper: poll Classroom Desk gateway policy and authorize clients.
# Preferred (no JWT):
#   CD_API_BASE=http://teacher:8787 ./auth_allowlist.sh
# Legacy (staff JWT still works):
#   CD_API_BASE=... CD_STAFF_TOKEN=... ./auth_allowlist.sh
#
# Requires: curl, jq
# openNDS: set FAS / BinAuth to call this, or run every 15s via systemd timer.

set -euo pipefail

CD_API_BASE="${CD_API_BASE:-http://127.0.0.1:8787}"
CD_STAFF_TOKEN="${CD_STAFF_TOKEN:-}"
STATE_DIR="${CD_OPENNDS_STATE:-/var/lib/classroom-desk/opennds}"
mkdir -p "$STATE_DIR"

BASE="${CD_API_BASE%/}"

# Prefer public policy (DeskDNS-shaped); fall back to JWT allowlist.
json=""
if json="$(curl -fsS "${BASE}/api/v1/gateway/policy" 2>/dev/null)"; then
  echo "$json" | jq -e '.type == "gateway_policy"' >/dev/null
elif [[ -n "$CD_STAFF_TOKEN" ]]; then
  json="$(curl -fsS \
    -H "Authorization: Bearer ${CD_STAFF_TOKEN}" \
    "${BASE}/api/v1/gateway/allowlist")"
  echo "$json" | jq -e '.items' >/dev/null
else
  echo "gateway/policy unreachable and CD_STAFF_TOKEN empty" >&2
  exit 1
fi

# When deep-lock deny: deauth everyone we previously authorized (optional hard cut).
net_mode="$(echo "$json" | jq -r '.deepLock.netMode // "allow"')"
if [[ "$net_mode" == "deny" ]]; then
  if command -v ndsctl >/dev/null 2>&1 || command -v openndsctl >/dev/null 2>&1; then
    for marker in "$STATE_DIR"/allowed_*; do
      [[ -e "$marker" ]] || continue
      ip="${marker##*/allowed_}"
      ip="${ip//_//}"
      if command -v ndsctl >/dev/null 2>&1; then
        ndsctl deauth "$ip" || true
      else
        openndsctl deauth "$ip" || true
      fi
      rm -f "$marker"
    done
  fi
  echo "opennds sync: deepLock deny — cleared local auths"
  exit 0
fi

now="$(date +%s)"
echo "$json" | jq -c '.items[]?' | while read -r row; do
  ip="$(echo "$row" | jq -r '.ip // empty')"
  client_key="$(echo "$row" | jq -r '.clientKey // empty')"
  exp="$(echo "$row" | jq -r '.expiresAt // empty')"
  if [[ -z "$ip" || "$ip" == "null" ]]; then
    continue
  fi
  if [[ -n "$exp" && "$exp" != "null" ]]; then
    if [[ "$exp" =~ ^[0-9]+$ ]]; then
      exp_s="$exp"
      # ms epoch from Desk
      if (( exp_s > 10_000_000_000 )); then
        exp_s=$((exp_s / 1000))
      fi
      if (( exp_s < now )); then
        continue
      fi
    elif date -d "$exp" +%s >/dev/null 2>&1; then
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
  if command -v ndsctl >/dev/null 2>&1; then
    ndsctl auth "$ip" || true
  elif command -v openndsctl >/dev/null 2>&1; then
    openndsctl auth "$ip" || true
  else
    echo "authorize ip=$ip clientKey=$client_key (no ndsctl; log only)"
  fi
  touch "$marker"
done

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

echo "opennds sync ok ($(echo "$json" | jq '.items | length') entries · netMode=$net_mode)"
