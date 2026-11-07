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

## 2. C2 两段视频

归档到 `证据/C2-YYYYMMDD/`（见 [C2_EVIDENCE_ARCHIVE.md](./C2_EVIDENCE_ARCHIVE.md)）：

| 文件 | 内容 |
|---|---|
| `C2-narrator.mp4` | Win+Ctrl+Enter 讲述人 · 聚焦学生窗 · ≥10s · 听清「已锁定」 |
| `C2-taskmgr-deny.mp4` | Assigned Access 下任务管理器结束失败 |
| `C2-titlebar.png` | 标题栏「已锁定」 |

## 3. Intune 试验组

1. 上传 [intune-student-kiosk.example.xml](./intune-student-kiosk.example.xml) → **仅**试验组 → 设备同步。
2. 填满本地 `artifacts/C2-intune-version.txt`（模板 [C2_intune-version.example.txt](./C2_intune-version.example.txt)）：

```text
ClassroomDesk-Setup 版本: 0.1.7
Windows 版本/内部版本:   ← winver
HideTaskManager: 是 / 否
Intune 配置文件名:
试验组名:
同步时间 (本地):
样机主机名:
备注:
```

3. 截 `C2-intune-policy.png`。

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

## 6. 教师端手测（可与样机并行）

1. 设置 → 退出锁审计 →「导出全部 CSV」→「取消导出」→「下载已拉取部分」应产出 partial CSV。
2. 设置 → `/health` 轮询间隔：改毫秒并失焦 → 只读「当前生效间隔」与顶栏轮询节奏一致；「恢复默认」后只读回到默认源。