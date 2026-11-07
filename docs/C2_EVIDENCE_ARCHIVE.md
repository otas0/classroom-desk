# C2 证据归档（样机 · 不入库）

本文件是清单模板；**音视频与截图不要 commit**。复制到教师机：

```text
证据/C2-YYYYMMDD/
  C2-narrator.mp4
  C2-taskmgr-deny.mp4
  C2-titlebar.png
  C2-intune-version.txt
  C2-intune-policy.png
  ClassroomDesk-Setup-*.exe
  ClassroomDesk-Setup-*.exe.sha256
  CHECKLIST.md          ← 可复制下表勾选结果
```

核对步骤见 [EXIT_LOCK_MDM.md](./EXIT_LOCK_MDM.md)。Intune XML 示例：[intune-student-kiosk.example.xml](./intune-student-kiosk.example.xml)。版本表模板：[C2_intune-version.example.txt](./C2_intune-version.example.txt)。安装包命名：[ARTIFACTS.md](./ARTIFACTS.md)。

本地证据目录（**勿 git**，已 ignore `证据/`）：

```bash
bash scripts/init-c2-evidence-dir.sh          # → 证据/C2-YYYYMMDD/
# 样机填满 C2-intune-version.txt（22H2/24H2）；录制替换 C2-alttab-win.mp4.PLACEHOLDER
```

样机本批建议：`ClassroomDesk-Setup-0.1.7.exe`（Release `v0.1.7`）。本地可把填好的 `C2-intune-version.txt` 放在 `artifacts/`（gitignore）或 `证据/C2-YYYYMMDD/`；录完 `C2-narrator.mp4` / `C2-taskmgr-deny.mp4` 后按上表归档。

## 真机勾选表（打印 / 填入 CHECKLIST.md）

| # | 项 | 期望 | 证据文件 | 操作员 | 日期 | □ |
|---|-----|------|----------|--------|------|---|
| 1 | 讲述人 + 标题栏「已锁定」≥10s | 听清锁定文案 | `C2-narrator.mp4` + `C2-titlebar.png` | | | |
| 2 | 关窗 / Alt+F4 | 无法退出；toast「向教师申请解除」 | 录屏片段可并入 narrator | | | |
| 3 | Assigned Access 路径正确 | `C:\Program Files\Classroom Desk\Classroom Desk.exe` | 截图路径 | | | |
| 4 | 任务管理器结束进程 | 失败或被策略拉起 | `C2-taskmgr-deny.mp4` | | | |
| 5 | 教师批量解除 ConfirmModal | 显示班级名 + 预计机位；学生可退 | 师生同屏 | | | |
| 6 | 重新锁定 | 学生再次无法关 | 截图 | | | |
| 7 | 错码限流 | 剩余次数 + 冷却倒计时 | 学生设置截图 | | | |
| 8 | 非 Assigned Access 提示 | 可关闭「本机未加固」 | 截图（未加固样机） | | | |
| 9 | （可选）Intune HideTaskManager | 试验组生效 | `C2-intune-policy.png` + version.txt | | | |
| 10 | 实机 DevTools 关 `/exit-lock/ws` | toast「实时通道已切到备用」+ SSE | 截图 Network WS/SSE | | | |
| 11 | **物理输入锁须告知学生** | 启用键鼠/语音/相机锁或考试模式前已当面/投影说明用途与解除方式；学生端有横幅；鼠标锁仍可「向教师举手」 | 告知记录或投影截图 | | | |
| 12 | 多显示器 / 触控笔 · `setIgnoreMouseEvents` | 主屏锁定遮罩可点；副屏无点击穿透；触控笔/触控与鼠标锁一致，举手按钮可点 | 双屏录屏 + 触控手测勾选 | | | |
| 13 | **锁态 Alt+Tab / Win 键（真机负向）** | Assigned Access 展台下 Alt+Tab、Win 无法切桌面/其它应用 | `C2-alttab-win.mp4` → 归档到 `证据/C2-YYYYMMDD/`（**本仓库 CI/macOS 无法代录**；操作员真机录屏） | | | |
| 14 | Intune USB 限制（试验组 · 22H2/24H2） | 两版本各填 [`C2_intune-version.example.txt`](./C2_intune-version.example.txt) 对照表；U 盘不可写；回滚可恢复 | `C2-intune-version.txt` + 手测 | | | |

### 样机安装（本机无法代跑 — 操作员）

1. 拷 `artifacts/windows-pack-check/ClassroomDesk-Setup-0.1.7.exe`（或 Release 附件）到样机，核对 SHA256。
2. 安装 → 写入本班 `config.json` → 启动学生端。
3. 录 `C2-narrator.mp4` / `C2-taskmgr-deny.mp4`，截 `C2-titlebar.png`。
4. 试验组 Intune 同步后填满本地 `artifacts/C2-intune-version.txt`（或归档目录内同名文件）。
5. DevTools → Network → WS → Close `/api/v1/exit-lock/ws` → 对照 toast + EventSource。

**须学校 IT 知情**：完成本表前，确认机房管理员已知晓 Assigned Access / 退出锁定策略（见 SETUP / USB checklist）。