# 安装包产物命名：Actions Artifact vs 本地 `artifacts/`

| 来源 | 名字 / 路径 | 说明 |
|---|---|---|
| **GitHub Actions Artifact** | 上传名：`classroom-desk-windows-setup` | `windows-pack` job 产出；内含 `ClassroomDesk-Setup-*.exe` + `.sha256`；保留约 30 天；用 `gh run download <runId> -n classroom-desk-windows-setup` 下载 |
| **本地目录 `artifacts/`** | `artifacts/ClassroomDesk-Setup-*.exe` | 开发机/手动从 Actions 解压后的落盘目录；**已 gitignore**，勿提交 |
| **学生端打包输出** | `apps/student-desktop/release/ClassroomDesk-Setup-<version>.exe` | `npm run dist:win` / CI 构建目录；CI 从此路径断言并上传 Artifact |
| **Release 附件** | GitHub Release `vX.Y.Z` | tag 发版 workflow；对外分发以 Release 为准 |

SHA256：每个 `.exe` 旁应有同名 `.sha256`（`sha256  文件名`）。校验：

```bash
# macOS / Linux
shasum -a 256 ClassroomDesk-Setup-*.exe
# 对照 .sha256 第一列

# Windows PowerShell
Get-FileHash -Algorithm SHA256 .\ClassroomDesk-Setup-*.exe
```

`npm run verify:exit-lock-packaged` 在找到 exe+sidecar 时会比对哈希；`REQUIRE_WIN_EXE=1` 时无 sidecar 亦失败。
