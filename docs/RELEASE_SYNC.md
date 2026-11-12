# GitHub Release 一键同步（教师端 + 学生机包）

教师不必自己找 Release：同一按钮完成 **教师机热更新** 与 **学生 Setup 入库**。

## 一点击做什么

1. **学生包**：从 GitHub Release 拉 `ClassroomDesk-Setup-*.exe`（及 `.sha256` / `.blockmap`）到本机 `upgrades/`；已存在且哈希一致则跳过（增量）。并打开学生强制同版本。  
2. **教师机**：把仓库切到同 tag（`git checkout`；无 `.git` 则下 zipball 覆盖，**不碰** `apps/server/data` / `.env`）→ `npm ci` → `build:teacher` → **自动重启 API**。  
3. 浏览器约 5 秒后刷新 `/admin/` 即可。

## 关闭教师机自更新

```env
CLASSROOM_DESK_TEACHER_SELF_UPDATE=0
```

仅拉学生包、不改教师机代码。

## 后台自检

服务启动约 15s 后检查，默认每 6h（`CLASSROOM_DESK_RELEASE_CHECK_MS`）。顶栏在发现新 Release 时提示。

## API

- `GET /api/v1/upgrades/release-check?refresh=1`
- `POST /api/v1/upgrades/pull-release`  
  body：`{ "arches": ["x64","arm64"], "updateTeacherHost": true }`

## 前置

- 教师机需访问 GitHub（可设 `GITHUB_TOKEN`）  
- 部署方式：`git clone` + `npm run start:server` / `start:classroom`（推荐）  
- 重启助手：`scripts/teacher-host-restart.mjs`（由 API 拉起）  
- 日志：`apps/server/data/teacher-host-restart.log`

## 边界

- 学生机仍从 **教室 LAN** 装包，不直连 GitHub。  
- 学生安装仍是 NSIS 全量 `/S`；「增量」指跳过未变资产。  
- 教师机热更新 **不是** 无重启热补丁；会短暂停 API 再拉起（课间操作）。
