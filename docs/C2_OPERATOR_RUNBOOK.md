# C2 / Assigned Access 证据收口（样机操作员）

CI / macOS **不能**代录 Alt+Tab / 任务管理器负向。本页把验收收成最短路径。

## 一次做完（约 30–45 分钟）

1. **装包**  
   - x64 机房：`ClassroomDesk-Setup-<ver>.exe` 或 `*-x64.exe`  
   - ARM / UTM：`ClassroomDesk-Setup-<ver>-arm64.exe`  
   - 核对旁路 `.sha256`

2. **展台账户**  
   - 设 Assigned Access → 单应用 `C:\Program Files\Classroom Desk\Classroom Desk.exe`  
   - 试验组 Intune：`docs/intune-student-kiosk.example.xml`（试验结束 rollback）

3. **初始化证据目录（开发机或样机旁）**

   ```bash
   npm run init:c2-evidence
   # → 证据/C2-YYYYMMDD/
   ```

4. **真机录屏（必须替换 PLACEHOLDER）**

   | 文件 | 内容 |
   |------|------|
   | `C2-alttab-win.mp4` | AA 下 Alt+Tab / Win 无法切桌面 |
   | `C2-taskmgr-deny.mp4` | 任务管理器结束 Classroom Desk 失败/被拒 |
   | `C2-titlebar.png` | 标题栏「已锁定」 |
   | `C2-intune-version.txt` | 填 22H2/24H2 + HideTaskManager 是/否 |
   | `C2-intune-policy.png` | （可选）策略截图 |

5. **校验**

   ```bash
   npm run verify:c2-evidence
   # ok: true 才算收口
   ```

完整勾选表见 [C2_EVIDENCE_ARCHIVE.md](./C2_EVIDENCE_ARCHIVE.md)；路径与 Intune 细节见 [EXIT_LOCK_MDM.md](./EXIT_LOCK_MDM.md)。

## 未收口 = 学校机未验收

无 AA / 无上述录屏时：应用内退出锁仍有效，但 **Alt+Tab / 任务管理器仍可能切走**。教师端「加固体检」会显示未加固占比告警。
