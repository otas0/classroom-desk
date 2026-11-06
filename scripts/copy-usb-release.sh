#!/usr/bin/env bash
# Copy classroom USB drop to a mounted volume.
# Usage: bash scripts/copy-usb-release.sh /Volumes/USB_NAME [192.168.31.179]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST_ROOT="${1:?Usage: $0 /Volumes/USB_NAME [teacher-ip]}"
IP="${2:-192.168.31.179}"
SRC="$ROOT/releases/$IP"
DEST="$DEST_ROOT/classroom-desk-$IP"

if [[ ! -d "$SRC" ]]; then
  echo "Missing $SRC" >&2
  exit 1
fi
if [[ ! -d "$DEST_ROOT" ]]; then
  echo "USB mount not found: $DEST_ROOT" >&2
  exit 1
fi

mkdir -p "$DEST"
rsync -a --exclude 'ops-verify/_docx_src' --exclude 'ops-verify/_zip_src' "$SRC/" "$DEST/"
echo "Copied → $DEST"
ls -lh "$DEST" | head -30
echo "On student PC: install exe, place config.json beside it / in app resources, open http://$IP:8787/ready"
