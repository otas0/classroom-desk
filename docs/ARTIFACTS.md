# 安装包产物命名：Actions Artifact vs 本地 `artifacts/`

| 来源 | 名字 / 路径 | 说明 |
|---|---|---|
| **GitHub Actions Artifact** | 上传名：`classroom-desk-windows-setup` | `windows-pack` job 产出；内含 `ClassroomDesk-Setup-*.exe` + `.sha256`；保留约 30 天；用 `gh run download <runId> -n classroom-desk-windows-setup` 下载 |
| **本地目录 `artifacts/`** | `artifacts/ClassroomDesk-Setup-*.exe` | 开发机/手动从 Actions 或 Release 解压后的落盘目录；**已 gitignore**，勿提交 |
| **学生端打包输出** | `apps/student-desktop/release/ClassroomDesk-Setup-<version>.exe` | `npm run dist:win` / CI 构建目录；CI 从此路径断言并上传 Artifact |
| **Release 附件** | GitHub Release `vX.Y.Z` | tag 发版 workflow；对外分发以 Release 为准 |

## Artifact / Release 版本 ↔ git tag

| 产物文件名 | 对应 tag / package.json | 备注 |
|---|---|---|
| `ClassroomDesk-Setup-0.1.7.exe` | `v0.1.7` | 对外安装以 **Release 附件** 为准 |
| `ClassroomDesk-Setup-0.1.6.exe` | `v0.1.6` | |
| `ClassroomDesk-Setup-0.1.5.exe` | `v0.1.5` | 旧 CI Artifact 可能仍留此名；勿与 0.1.7 混用 |

规则：

1. **文件名里的版本号** = 构建时各 workspace `package.json` 的 `version`（electron-builder 写入）。
2. **git tag `vX.Y.Z`** 触发 Release workflow，附件应与该版本号一致。
3. **Actions Artifact `classroom-desk-windows-setup`** 来自 `main` 每次 push 的 `windows-pack`：版本随当时 HEAD 的 `package.json`，**不一定**等于最新 tag；样机发版请优先 `gh release download vX.Y.Z`。
4. CI `windows-pack-verify-artifact` 会下载刚上传的 Artifact 再校验 exe↔`.sha256`。

SHA256：每个 `.exe` 旁应有同名 `.sha256`（`sha256  文件名`）。校验：

```bash
# macOS / Linux
shasum -a 256 ClassroomDesk-Setup-*.exe
# 对照 .sha256 第一列

# Windows PowerShell
Get-FileHash -Algorithm SHA256 .\ClassroomDesk-Setup-*.exe
```

`npm run verify:exit-lock-packaged` 在找到 exe+sidecar 时会比对哈希；`REQUIRE_WIN_EXE=1` 时无 sidecar 亦失败。
