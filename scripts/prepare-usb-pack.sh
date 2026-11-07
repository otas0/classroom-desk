#!/usr/bin/env bash
# Assemble releases/<teacher-ip>/ with Setup 0.1.7 + sha + C2 checklist for USB copy.
# Usage:
#   bash scripts/prepare-usb-pack.sh 192.168.31.179
#   bash scripts/prepare-usb-pack.sh 192.168.31.179 /path/to/ClassroomDesk-Setup-0.1.7.exe
# Then: bash scripts/copy-usb-release.sh /Volumes/USB_NAME 192.168.31.179
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IP="${1:?Usage: $0 <teacher-ip> [path-to-Setup.exe]}"
EXE_SRC="${2:-}"
DEST="$ROOT/releases/$IP"
VERSION="${CD_SETUP_VERSION:-0.1.7}"
EXPECTED_SHA="${CD_SETUP_SHA256:-992ee805ff2a8e92f66dfaee6d26068b29ac598d08082af0ebc399408f898b57}"

mkdir -p "$DEST"

if [[ -z "$EXE_SRC" ]]; then
  for cand in \
    "$ROOT/artifacts/windows-pack-check/ClassroomDesk-Setup-${VERSION}.exe" \
    "$ROOT/apps/student-desktop/release/ClassroomDesk-Setup-${VERSION}.exe"
  do
    if [[ -f "$cand" ]]; then EXE_SRC="$cand"; break; fi
  done
fi

if [[ -z "$EXE_SRC" || ! -f "$EXE_SRC" ]]; then
  echo "Missing Setup.exe. Pass path or place under artifacts/windows-pack-check/" >&2
  echo "  gh release download v${VERSION} -p 'ClassroomDesk-Setup-${VERSION}.exe*' -D artifacts/windows-pack-check" >&2
  exit 1
fi

cp -f "$EXE_SRC" "$DEST/ClassroomDesk-Setup-${VERSION}.exe"
SIDE="${EXE_SRC}.sha256"
if [[ -f "$SIDE" ]]; then
  cp -f "$SIDE" "$DEST/ClassroomDesk-Setup-${VERSION}.exe.sha256"
else
  if command -v shasum >/dev/null 2>&1; then
    HASH=$(shasum -a 256 "$DEST/ClassroomDesk-Setup-${VERSION}.exe" | awk '{print $1}')
  else
    HASH=$(sha256sum "$DEST/ClassroomDesk-Setup-${VERSION}.exe" | awk '{print $1}')
  fi
  printf '%s  ClassroomDesk-Setup-%s.exe\n' "$HASH" "$VERSION" >"$DEST/ClassroomDesk-Setup-${VERSION}.exe.sha256"
fi

ACTUAL=$(awk '{print $1}' "$DEST/ClassroomDesk-Setup-${VERSION}.exe.sha256")
if [[ -n "$EXPECTED_SHA" && "$ACTUAL" != "$EXPECTED_SHA" ]]; then
  echo "WARN: sha256 $ACTUAL != expected $EXPECTED_SHA (override with CD_SETUP_SHA256=)" >&2
fi

# C2 checklist + Intune version template (fill on sample machine; do not commit filled copy)
cp -f "$ROOT/docs/C2_EVIDENCE_ARCHIVE.md" "$DEST/C2_EVIDENCE_ARCHIVE.md"
if [[ -f "$ROOT/docs/SAMPLE_MACHINE_OPS.md" ]]; then
  cp -f "$ROOT/docs/SAMPLE_MACHINE_OPS.md" "$DEST/SAMPLE_MACHINE_OPS.md"
fi
if [[ -f "$ROOT/artifacts/C2-intune-version.txt" ]]; then
  cp -f "$ROOT/artifacts/C2-intune-version.txt" "$DEST/C2-intune-version.txt"
elif [[ -f "$ROOT/docs/C2_intune-version.example.txt" ]]; then
  cp -f "$ROOT/docs/C2_intune-version.example.txt" "$DEST/C2-intune-version.txt"
fi

cat >"$DEST/README-USB.txt" <<EOF
Classroom Desk USB pack — teacher IP hint: $IP
Setup: ClassroomDesk-Setup-${VERSION}.exe
SHA256: $ACTUAL
1. Install exe on student PCs; place config.json from prepare:live / pack-classroom-config.
2. Teacher: open http://$IP:8787/ready from a student browser.
3. C2 evidence: follow SAMPLE_MACHINE_OPS.md / C2_EVIDENCE_ARCHIVE.md; fill C2-intune-version.txt after Intune sync.
EOF

echo "Prepared $DEST"
ls -lh "$DEST"
echo "Next: bash scripts/copy-usb-release.sh /Volumes/YOUR_USB $IP"
