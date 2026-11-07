#!/usr/bin/env bash
# Create local 证据/C2-YYYYMMDD/ (gitignored) with Intune template + placeholders.
# Does NOT record video — operator fills on Windows sample machines.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DAY="${1:-$(date +%Y%m%d)}"
DEST="${CD_EVIDENCE_DIR:-$ROOT/证据}/C2-$DAY"
mkdir -p "$DEST"
cp -f "$ROOT/docs/C2_intune-version.example.txt" "$DEST/C2-intune-version.txt"
cat > "$DEST/README.txt" <<EOF
Classroom Desk C2 证据目录（勿 git commit；.gitignore 已忽略 证据/）

操作顺序（样机 Windows）:
1. 编辑 C2-intune-version.txt —— 分别填【22H2】【24H2】段（HideTaskManager + USB DenyWrite/Execute）
2. 展台账户录屏：删除 C2-alttab-win.mp4.PLACEHOLDER，放入真实 C2-alttab-win.mp4
3. 同目录再放 C2-taskmgr-deny.mp4 / C2-titlebar.png / C2-intune-policy.png（见下）

必填 / 必录:
  C2-intune-version.txt   — 22H2 / 24H2 对照表（模板已拷入）
  C2-alttab-win.mp4        — Assigned Access 下 Alt+Tab / Win 负向
  C2-taskmgr-deny.mp4      — 任务管理器结束失败
  C2-titlebar.png          — 标题栏「已锁定」
  C2-narrator.mp4          — 讲述人 ≥10s（可选）
  C2-intune-policy.png     — 试验组策略截图

说明: docs/C2_EVIDENCE_ARCHIVE.md · docs/EXIT_LOCK_MDM.md · docs/SAMPLE_MACHINE_OPS.md
EOF
touch "$DEST/C2-alttab-win.mp4.PLACEHOLDER"
# Keep a blank second copy name hint for operators who drag-drop
printf '%s\n' "REPLACE_WITH_REAL_RECORDING" > "$DEST/C2-alttab-win.mp4.PLACEHOLDER"
echo "Created $DEST"
echo "Next: fill C2-intune-version.txt on 22H2+24H2 sample PCs; replace PLACEHOLDER with real C2-alttab-win.mp4"
ls -la "$DEST"
