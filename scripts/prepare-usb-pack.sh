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
# CD_WIN_ARCH=x64|arm64|dual (default x64). dual copies both arch artifacts when present.
ARCH_MODE="${CD_WIN_ARCH:-x64}"
EXPECTED_SHA="${CD_SETUP_SHA256:-}"

mkdir -p "$DEST"

pick_exe() {
  local arch="$1"
  local name=""
  if [[ "$arch" == "arm64" ]]; then
    name="ClassroomDesk-Setup-${VERSION}-arm64.exe"
  elif [[ "$arch" == "x64" ]]; then
    name="ClassroomDesk-Setup-${VERSION}-x64.exe"
  else
    name="ClassroomDesk-Setup-${VERSION}.exe"
  fi
  for cand in \
    "$EXE_SRC" \
    "$ROOT/artifacts/windows-pack-check/$name" \
    "$ROOT/apps/student-desktop/release/$name" \
    "$ROOT/apps/student-desktop/release/ClassroomDesk-Setup-${VERSION}.exe"
  do
    if [[ -n "$cand" && -f "$cand" ]]; then
      echo "$cand"
      return 0
    fi
  done
  return 1
}

copy_one() {
  local arch="$1"
  local src
  src=$(pick_exe "$arch") || {
    echo "Missing Setup for arch=$arch (CD_WIN_ARCH=$ARCH_MODE)" >&2
    echo "  Place under apps/student-desktop/release/ or pass path as \$2" >&2
    return 1
  }
  local dest_name
  if [[ "$arch" == "arm64" ]]; then
    dest_name="ClassroomDesk-Setup-${VERSION}-arm64.exe"
  elif [[ "$arch" == "legacy" ]]; then
    dest_name="ClassroomDesk-Setup-${VERSION}.exe"
  else
    dest_name="ClassroomDesk-Setup-${VERSION}-x64.exe"
  fi
  cp -f "$src" "$DEST/$dest_name"
  if [[ -f "${src}.sha256" ]]; then
    cp -f "${src}.sha256" "$DEST/${dest_name}.sha256"
  else
    if command -v shasum >/dev/null 2>&1; then
      HASH=$(shasum -a 256 "$DEST/$dest_name" | awk '{print $1}')
    else
      HASH=$(sha256sum "$DEST/$dest_name" | awk '{print $1}')
    fi
    printf '%s  %s\n' "$HASH" "$dest_name" >"$DEST/${dest_name}.sha256"
  fi
  echo "packed $dest_name"
  # Keep legacy unsuffixed alias for x64 USB scripts.
  if [[ "$arch" == "x64" ]]; then
    cp -f "$DEST/$dest_name" "$DEST/ClassroomDesk-Setup-${VERSION}.exe"
    cp -f "$DEST/${dest_name}.sha256" "$DEST/ClassroomDesk-Setup-${VERSION}.exe.sha256"
  fi
}

# Drop stale Setup builds so the stick only carries the pinned version(s).
shopt -s nullglob
for stale in "$DEST"/ClassroomDesk-Setup-*.exe "$DEST"/ClassroomDesk-Setup-*.exe.sha256; do
  rm -f "$stale"
done
shopt -u nullglob

case "$ARCH_MODE" in
  dual)
    copy_one x64
    copy_one arm64 || echo "WARN: arm64 Setup missing — USB has x64 only" >&2
    ;;
  arm64)
    copy_one arm64
    ;;
  *)
    copy_one x64 || copy_one legacy
    ;;
esac

ACTUAL=$(awk '{print $1}' "$DEST/ClassroomDesk-Setup-${VERSION}.exe.sha256" 2>/dev/null || true)
if [[ -n "$EXPECTED_SHA" && -n "$ACTUAL" && "$ACTUAL" != "$EXPECTED_SHA" ]]; then
  echo "WARN: sha256 $ACTUAL != expected $EXPECTED_SHA (override with CD_SETUP_SHA256=)" >&2
fi

# C2 checklist + Intune version template (fill on sample machine; do not commit filled copy)
cp -f "$ROOT/docs/C2_EVIDENCE_ARCHIVE.md" "$DEST/C2_EVIDENCE_ARCHIVE.md"
if [[ -f "$ROOT/docs/SAMPLE_MACHINE_OPS.md" ]]; then
  cp -f "$ROOT/docs/SAMPLE_MACHINE_OPS.md" "$DEST/SAMPLE_MACHINE_OPS.md"
fi
# 联调旁注表（AA / Intune / 证据目录 / 回滚 XML）— 进 U 盘必带
cp -f "$ROOT/docs/LOCAL_USB_CHECKLIST.md" "$DEST/LOCAL_USB_CHECKLIST.md"
cp -f "$ROOT/docs/intune-student-kiosk.example.xml" "$DEST/intune-student-kiosk.example.xml"
cp -f "$ROOT/docs/intune-student-kiosk.rollback.xml" "$DEST/intune-student-kiosk.rollback.xml"
cp -f "$ROOT/docs/assigned-access-checklist.example.json" "$DEST/assigned-access-checklist.example.json"
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
3. C2 evidence: follow SAMPLE_MACHINE_OPS.md / C2_EVIDENCE_ARCHIVE.md / LOCAL_USB_CHECKLIST.md（联调旁注表）；fill C2-intune-version.txt after Intune sync.
4. 试验组 Intune：用 intune-student-kiosk.example.xml；结束用 intune-student-kiosk.rollback.xml。
5. 打印 C2-PRINT-CHECKLIST.txt：含「物理输入锁须告知学生」勾选。
6. 若有 SEAT-MAP-ID-SHEET.html：浏览器打开后打印（seat_map.id 主键对照；空座/已排均可扫码）。
EOF

# Printable one-pager for sample machine (Chinese checklist).
cat >"$DEST/C2-PRINT-CHECKLIST.txt" <<'EOF'
Classroom Desk · C2 样机打印勾选（勿提交填好的扫描件）
================================================
□ 讲述人 + 标题栏「已锁定」≥10s
□ 关窗 / Alt+F4 → toast「向教师申请解除」
□ Assigned Access 路径正确
□ 任务管理器结束进程失败或被拉起
□ 教师批量解除 ConfirmModal → 学生可退
□ 重新锁定后学生再次无法关
□ 错码限流（剩余次数 + 冷却）
□ 非 Assigned Access 提示可关闭
□ （可选）Intune HideTaskManager 试验组生效
□ DevTools 关 /exit-lock/ws → SSE 备用 toast
□ 【必做】物理输入锁须告知学生：启用键鼠/语音/相机锁或「考试模式」前，
    已当面或投影说明用途与解除方式（学生端有醒目横幅；鼠标锁时仍可「向教师举手」）
□ 机位锁主键：教师端「指定机位」用 seat_map.id（座位图行主键，非学号/clientId）；
    打印/核对时对照教师 UI 只读副本与审计「座位 label」行
□ 多显示器：锁定遮罩仅本窗接收点击，副屏无穿透；触控笔路径与鼠标锁一致

证据目录：证据/C2-YYYYMMDD/（音视频勿入库）
详见 C2_EVIDENCE_ARCHIVE.md / EXIT_LOCK_MDM.md
EOF

# Optional: printable seat_map.id对照表（空座/已排 + 可扫码）
# Requires running API + teacher JWT for the target class:
#   CD_TOKEN=… CD_CLASS_ID=… bash scripts/prepare-usb-pack.sh <ip>
if [[ -n "${CD_CLASS_ID:-}" && -n "${CD_TOKEN:-}" ]]; then
  API_BASE="${CD_API_BASE:-http://127.0.0.1:8787}"
  # Default --filter all（页内仍可切「仅空座 / 仅已排」再打印；见 docs/LOCAL_USB_CHECKLIST.md）
  SEAT_FILTER="${CD_SEAT_FILTER:-all}"
  if node "$ROOT/scripts/gen-seat-map-sheet.mjs" \
    --api "$API_BASE" \
    --token "$CD_TOKEN" \
    --class "$CD_CLASS_ID" \
    --filter "$SEAT_FILTER" \
    --out "$DEST/SEAT-MAP-ID-SHEET.html"
  then
    echo "seat sheet → $DEST/SEAT-MAP-ID-SHEET.html (filter=$SEAT_FILTER)"
  else
    echo "WARN: seat_map.id sheet skipped (API/auth/class?)" >&2
  fi
else
  echo "Tip: set CD_TOKEN + CD_CLASS_ID to emit SEAT-MAP-ID-SHEET.html (scannable seat_map.id 对照表；默认 --filter all)"
fi

echo "Prepared $DEST"
ls -lh "$DEST"
echo "Next: bash scripts/copy-usb-release.sh /Volumes/YOUR_USB $IP"