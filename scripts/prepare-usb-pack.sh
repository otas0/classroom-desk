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

# Drop stale Setup builds so the stick only carries the pinned version.
shopt -s nullglob
for stale in "$DEST"/ClassroomDesk-Setup-*.exe "$DEST"/ClassroomDesk-Setup-*.exe.sha256; do
  base=$(basename "$stale")
  if [[ "$base" != "ClassroomDesk-Setup-${VERSION}.exe" && "$base" != "ClassroomDesk-Setup-${VERSION}.exe.sha256" ]]; then
    rm -f "$stale"
    echo "removed stale $base"
  fi
done
shopt -u nullglob

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
4. 打印 C2-PRINT-CHECKLIST.txt：含「物理输入锁须告知学生」勾选。
5. 若有 SEAT-MAP-ID-SHEET.html：浏览器打开后打印（seat_map.id 主键对照；空座/已排均可扫码）。
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