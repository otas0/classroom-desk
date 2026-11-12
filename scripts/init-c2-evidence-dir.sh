#!/usr/bin/env bash
# Create local 证据/C2-YYYYMMDD/ (gitignored) with Intune templates + placeholders.
# Does NOT record video — operator fills on Windows sample machines (+ Intune tenant).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DAY="${1:-$(date +%Y%m%d)}"
DEST="${CD_EVIDENCE_DIR:-$ROOT/证据}/C2-$DAY"
mkdir -p "$DEST"
cp -f "$ROOT/docs/C2_intune-version.example.txt" "$DEST/C2-intune-version.txt"
cp -f "$ROOT/docs/intune-student-kiosk.example.xml" "$DEST/intune-student-kiosk.example.xml"
cp -f "$ROOT/docs/intune-student-kiosk.rollback.xml" "$DEST/intune-student-kiosk.rollback.xml"
cp -f "$ROOT/docs/assigned-access-checklist.example.json" "$DEST/assigned-access-checklist.example.json"
cp -f "$ROOT/scripts/c2-windows-ops.ps1" "$DEST/c2-windows-ops.ps1"
cat > "$DEST/README.txt" <<EOF
Classroom Desk C2 证据目录（勿 git commit；.gitignore 已忽略 证据/）

学校机房生产：Assigned Access + Intune 试验组为考试深锁 L3 必配。
无 AA 时 Alt+Tab / 任务管理器仍可切 = 部署未完成（见 docs/SECURITY.md）。
禁止：对学生隐瞒的屏幕/键鼠/麦克风采集（学校机亦禁止）。

操作顺序（样机 Windows + IT 试验组）:
1. 试验组上传 intune-student-kiosk.example.xml → 设备同步（勿推全校）
2. Assigned Access 单应用 → Classroom Desk 安装路径
3. 编辑 C2-intune-version.txt —— 分别填【22H2】【24H2】（HideTaskManager + USB）
4. 展台账户录屏：删除 C2-alttab-win.mp4.PLACEHOLDER，放入真实 C2-alttab-win.mp4
5. 同目录再放 C2-taskmgr-deny.mp4 / C2-titlebar.png / C2-intune-policy.png
6. 试验结束：下发 intune-student-kiosk.rollback.xml 或取消分配 → 同步
7. 教师机/开发机：npm run verify:c2-evidence

也可在样机直接跑：powershell -ExecutionPolicy Bypass -File .\c2-windows-ops.ps1

必填 / 必录:
  C2-intune-version.txt   — 22H2 / 24H2 对照表（模板已拷入）
  C2-alttab-win.mp4        — Assigned Access 下 Alt+Tab / Win 负向
  C2-taskmgr-deny.mp4      — 任务管理器结束失败
  C2-titlebar.png          — 标题栏「已锁定」
  C2-intune-policy.png     — 试验组策略截图
  C2-narrator.mp4          — 讲述人 ≥10s（可选）

说明: docs/C2_EVIDENCE_ARCHIVE.md · docs/EXIT_LOCK_MDM.md · docs/SAMPLE_MACHINE_OPS.md
EOF
printf '%s\n' "REPLACE_WITH_REAL_RECORDING" > "$DEST/C2-alttab-win.mp4.PLACEHOLDER"
printf '%s\n' "REPLACE_WITH_REAL_RECORDING" > "$DEST/C2-taskmgr-deny.mp4.PLACEHOLDER"
# Printable day checklist (operator fills; not committed with media)
cat > "$DEST/CHECKLIST.md" <<'EOF'
# C2 当日勾选（样机）

复制自 docs/C2_EVIDENCE_ARCHIVE.md · docs/INTUNE_TRIAL_FILL.md · docs/UTM_ARM64_CHECKLIST.md · docs/HANDTEST_MULTI_CLASSROOM.md

| # | 项 | □ | 日期 |
|---|-----|---|------|
| 1 | C2-narrator + titlebar | | |
| 2 | C2-alttab-win.mp4（删 PLACEHOLDER） | | |
| 3 | C2-taskmgr-deny.mp4（删 PLACEHOLDER） | | |
| 4 | C2-intune-version.txt 22H2+24H2 填「是/否」 | | |
| 5 | C2-intune-policy.png | | |
| 6 | 回滚 XML 已验证并记入 txt | | |
| 7 | （可选）UTM arm64 全流程 | | |
| 8 | （可选）多教室房间码手测 | | |

完成后在开发机：`npm run verify:c2-evidence`
EOF
echo "Created $DEST"
echo "Next (Windows sample + Intune): fill version txt, record mp4s, then npm run verify:c2-evidence"
ls -la "$DEST"
