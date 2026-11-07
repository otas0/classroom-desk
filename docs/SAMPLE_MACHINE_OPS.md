# 样机操作清单（Windows · 无法在 Mac 代跑）

本文件给教室样机操作员。安装包与证据**勿 commit**。

> **网络**：须在**教室/机房部署网**（能访问教师机局域网 IP、Intune 试验组设备）上执行。开发机公网/家里网不能代替样机同步、DevTools 对照与 U 盘实装。

## 1. 安装 0.1.7

路径优先：

1. 本机已下载：`artifacts/windows-pack-check/ClassroomDesk-Setup-0.1.7.exe`
2. 或 `gh release download v0.1.7 -p 'ClassroomDesk-Setup-0.1.7.exe*'`

```powershell
Get-FileHash -Algorithm SHA256 .\ClassroomDesk-Setup-0.1.7.exe
# 期望：992ee805ff2a8e92f66dfaee6d26068b29ac598d08082af0ebc399408f898b57
```

安装后写入本班 `config.json`（`apiBase` 禁止 127.0.0.1）。

## 2. 证据目录 + 两段视频

教师机/样机旁先建目录（gitignore，勿 commit）：

```bash
npm run init:c2-evidence
# → 证据/C2-YYYYMMDD/：C2-intune-version.txt + C2-alttab-win.mp4.PLACEHOLDER + README.txt
```

归档到 `证据/C2-YYYYMMDD/`（见 [C2_EVIDENCE_ARCHIVE.md](./C2_EVIDENCE_ARCHIVE.md)）：

| 文件 | 内容 |
|---|---|
| `C2-intune-version.txt` | 22H2 / 24H2 勾选表（init 已从模板拷入，须手填） |
| `C2-alttab-win.mp4` | **真录屏**：删 PLACEHOLDER 后放入；Assigned Access 下 Alt+Tab / Win 负向 |
| `C2-narrator.mp4` | Win+Ctrl+Enter 讲述人 · 聚焦学生窗 · ≥10s · 听清「已锁定」 |
| `C2-taskmgr-deny.mp4` | Assigned Access 下任务管理器结束失败 |
| `C2-titlebar.png` | 标题栏「已锁定」 |

## 3. Intune 试验组

1. **试验组**上传 [intune-student-kiosk.example.xml](./intune-student-kiosk.example.xml) → 设备同步（勿推全校）。  
   **试验结束**必须下发 [intune-student-kiosk.rollback.xml](./intune-student-kiosk.rollback.xml) 撤回。  
   Assigned Access：对照 [assigned-access-checklist.example.json](./assigned-access-checklist.example.json) 与教师「加固体检 → 导出 AA 清单」（字段已对齐）。USB 包已拷上述 XML/JSON + `LOCAL_USB_CHECKLIST.md`。
2. 填满 `证据/C2-YYYYMMDD/C2-intune-version.txt`（模板 [C2_intune-version.example.txt](./C2_intune-version.example.txt)，含 **22H2 / 24H2** HideTaskManager + USB CSP 对照）。
3. 截 `C2-intune-policy.png` 放入同一证据目录。
4. 真机录屏 `C2-alttab-win.mp4`（替换 PLACEHOLDER）。本仓库 CI/macOS **无法代录**。

## 4. DevTools 关 WS → toast + SSE

1. 学生端已连 API，标题栏锁定。
2. `Ctrl+Shift+I` → Network → WS → `/api/v1/exit-lock/ws` → Close。
3. 期望 toast：`实时通道已切到备用（WebSocket 关闭）`（或「断开」）。
4. Network 出现 EventSource `/api/v1/exit-lock/stream`。
5. （可选）教师批量解除 → 标题栏秒级可退。

自动化对照（不能替代本条）：`e2e/exit-lock-toast.spec.ts`。

## 5. U 盘包（仅 0.1.7）

Mac/教师机组装后拷到 U 盘（勿提交 exe）：

```bash
# 清掉同目录旧 0.1.0 / 0.1.1，只留 0.1.7 + sha + C2 清单
rm -f releases/<IP>/ClassroomDesk-Setup-0.1.0.exe* releases/<IP>/ClassroomDesk-Setup-0.1.1.exe*
npm run prepare:usb -- <IP>
npm run copy:usb -- /Volumes/YOUR_USB <IP>
```

样机安装后再次 `Get-FileHash` 对照 `992ee805ff2a8e92f66dfaee6d26068b29ac598d08082af0ebc399408f898b57`。

## 6. 教师端手测（可与样机并行；亦须能打开该班教师 Web）

1. 设置 → 退出锁审计 →「导出全部 CSV」→「取消导出」→「下载已拉取部分」应产出 partial CSV。
2. 设置 → `/health` 轮询间隔：改毫秒并失焦 → 只读「当前生效间隔」与顶栏轮询节奏一致；「恢复默认」后只读回到默认源。

## 7. 操作员勾选（教室网）

开发机公网**不能**代勾。到教室/机房后按序：

1. [ ] `npm run prepare:usb -- <教师IP>`（或拷已备好的 `releases/<IP>/`）→ U 盘 → 样机安装  
2. [ ] 样机 `Get-FileHash -Algorithm SHA256` = `992ee805ff2a8e92f66dfaee6d26068b29ac598d08082af0ebc399408f898b57`  
3. [ ] `npm run init:c2-evidence` → 填满 `证据/C2-*/C2-intune-version.txt` + 截 `C2-intune-policy.png`  
4. [ ] 真 `C2-alttab-win.mp4` 替换 PLACEHOLDER；试验组用 example.xml，结束用 rollback.xml  
5. [ ] DevTools 关 `/exit-lock/ws` → toast + SSE（§4）  
6. [ ] 录 `C2-narrator.mp4` / `C2-taskmgr-deny.mp4` + `C2-titlebar.png`  
7. [ ] 教师 Web：CSV「下载已拉取部分」  
8. [ ] 教师 Web：健康轮询「当前生效间隔」  

下个 Release tag 发版后：目视 Release 安装说明含 [ARTIFACTS.md](./ARTIFACTS.md) 链接（`extract-release-notes.mjs` 已自动附）。  
purge CI 再红：先查 `selectTeacherClass` / `preferClassroomId`（见 ARTIFACTS 基线节）。  
Issue ACL 复验（可选）：`gh workflow run e2e-nightly.yml -f verify_issues_write=true`（dry-run job `continue-on-error`，不染红整 suite）。