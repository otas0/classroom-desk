# GitHub Release 一键同步（教师端）

教师不必自己找 Release 或 U 盘拷包：程序后台自检最新版，设置页一点击拉到本机 `/upgrades`，学生机走既有强制同版本。

## 能力

| 项 | 说明 |
|---|---|
| 后台自检 | 服务启动约 15s 后检查，默认每 6h（`CLASSROOM_DESK_RELEASE_CHECK_MS`） |
| 教师 UI | 设置 →「GitHub Release 一键同步」：检查 / 一键拉取 |
| 增量 | 已存在且 size（及 .sha256）一致的包 **跳过下载**；`.blockmap` 若有则一并拉取（供后续差分工具） |
| 学生 | 拉取成功后自动 `student_auto_update=1`，有版本漂移则强制装 LAN Setup |

## API

- `GET /api/v1/upgrades/release-check?refresh=1`
- `POST /api/v1/upgrades/pull-release` body 可选 `{ "arches": ["x64","arm64"] }`

## 网络

教师机需能访问 `api.github.com` 与 `github.com` 下载。私有速率限制可设 `GITHUB_TOKEN` / `GH_TOKEN`。

## 明确边界

- **不是** App Store 静默热更新整棵源码；同步的是 Windows Setup 安装包。  
- **不是** 字节级差分补丁安装（NSIS 仍全量 `/S`）；增量仅指 **跳过未变资产**。  
- 学生仍从 **教室 LAN** 拉包，不直接打公网 Release。
