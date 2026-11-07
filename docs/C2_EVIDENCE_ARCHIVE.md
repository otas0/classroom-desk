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

### 样机安装（本机无法代跑 — 操作员）

1. 拷 `artifacts/windows-pack-check/ClassroomDesk-Setup-0.1.7.exe`（或 Release 附件）到样机，核对 SHA256。
2. 安装 → 写入本班 `config.json` → 启动学生端。
3. 录 `C2-narrator.mp4` / `C2-taskmgr-deny.mp4`，截 `C2-titlebar.png`。
4. 试验组 Intune 同步后填满本地 `artifacts/C2-intune-version.txt`（或归档目录内同名文件）。
5. DevTools → Network → WS → Close `/api/v1/exit-lock/ws` → 对照 toast + EventSource。

**须学校 IT 知情**：完成本表前，确认机房管理员已知晓 Assigned Access / 退出锁定策略（见 SETUP / USB checklist）。
