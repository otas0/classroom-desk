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

## CI 墙钟基线（e2e-bulk）

| 日期 | 提交线 | job | Playwright bulk | teacher dist |
|---|---|---|---|---|
| 2026-11-07 | `8d60e7d` 隔离 bulk 共享班后 | ≈52s | ≈15s | **Download ≈1s**（复用 server artifact；旧路径 Build ≈5s） |
| 2026-11-07 | `b10f44c` homework/point 隔离后（[CI 42369458852](https://github.com/otas0/classroom-desk/actions/runs/42369458852)） | ≈52s | ≈11s | **Download ≈1s** |

若 `q-recycle-purge` 再红：先查 `selectTeacherClass` / `loadClasses` 竞态（专用班 option 未就绪或 preferClassroomId 抢回「本教室」）。

## Commit SHA vs tree SHA（API push / 本地 tip）

HTTPS `git push` 偶发不通时，可能用 Git Data API 推送，**远程 commit SHA ≠ 本地 commit SHA**，但 **tree 相同**。

| 用途 | 用什么 |
|---|---|
| 代码内容是否对齐 | `git rev-parse HEAD^{tree}` ↔ `gh api repos/.../git/commits/<sha> --jq .tree.sha` |
| CI badge / Actions run | **Actions 的 `github.sha`（远程 tip）** 或 **git tag `vX.Y.Z`** |
| 文档/样机核对 | 优先写 **tag** 或 **tree SHA**；勿假设本地 `git log -1` 与 GitHub commit 字面相同 |

例：

```bash
git rev-parse HEAD^{tree}
gh api repos/otas0/classroom-desk/git/ref/heads/main --jq .object.sha
gh api repos/otas0/classroom-desk/git/commits/$(gh api repos/otas0/classroom-desk/git/ref/heads/main --jq .object.sha) --jq .tree.sha
```

两 tree 一致即可认为内容已上 main。

**推荐顺序（API push 后）：**

1. 先对 **tree SHA**（上表命令），确认内容已上远程；  
2. 再 `git fetch origin main && git reset --hard origin/main` 对齐**指针**（需 HTTPS:443 通）。  
勿先 reset 到过期的本地 `origin/main`（会把未 fetch 到的工作冲掉）。

README CI badge 优先挂 **Release tag**（`vX.Y.Z`）；commit 字面不一致时以 tree / tag 为准。

## Nightly `verify_issues_write` dry-run

`.github/workflows/e2e-nightly.yml` 的 `workflow_dispatch` 输入 **`verify_issues_write` 默认 `false`**。

仅在以下情况手动打开一次：

1. 改过 `permissions.issues` / Issue 通知脚本；或
2. Org/repo ACL 变更后怀疑 `issues:write` 又 403。

```bash
gh workflow run e2e-nightly.yml -f verify_issues_write=true
```

会跑临时失败 job → 开 Issue（标题含 dry-run）→ 验证后关掉该 Issue。日常 cron **不要**开。

Flake 跟踪见 [E2E_FLAKE_BOARD.md](./E2E_FLAKE_BOARD.md)。

下个 Release tag：`scripts/extract-release-notes.mjs` 已在安装说明末自动附 [ARTIFACTS.md](./ARTIFACTS.md) 链接；发版后核对 Release body。

发版 checklist：badge 对 **tag** + **tree SHA** 双写（`append-artifacts-release.mjs` / Release job `record-artifacts`）。失败时开 Issue（label `release`/`artifacts`）；可选 secret `CLASSROOM_DESK_OPS_WEBHOOK` POST 机房频道。

### 仓库 Settings：`CLASSROOM_DESK_OPS_WEBHOOK`

GitHub → **Settings → Secrets and variables → Actions** → New repository secret：

| Name | Value |
|---|---|
| `CLASSROOM_DESK_OPS_WEBHOOK` | Slack Incoming Webhook 或飞书自定义机器人 URL |

Release job `record-artifacts` 失败时 `POST` JSON（`text` / `tag` / `runId`）。未配置则跳过，不影响发版。PR 上 `flake-pr-comment.yml` 会自动贴 `check:nightly-flake --md` 看板。

#### 失败路径验证（Issue + 频道双触达）

1. GitHub → Settings → Secrets → Actions 写入 `CLASSROOM_DESK_OPS_WEBHOOK`（Slack Incoming / 飞书自定义机器人）。
2. 本机干跑（不写进 git）：

```bash
export CLASSROOM_DESK_OPS_WEBHOOK='https://hooks.slack.com/services/…'  # 或飞书
npm run ops:webhook-dry-run
# 期望频道出现 [classroom-desk] ops webhook dry-run …
```

3. **双触达**：在验证分支临时让 `release.yml` → `record-artifacts` 失败（或手工触发会走到失败分支的路径）→ 应同时看到  
   - GitHub Issue（labels `release`/`artifacts`）  
   - 频道 POST（`Release record-artifacts failed for <tag>`）  
   验完即还原；正式发版失败时同样双触达。  
4. 未配置 secret 时 webhook 跳过，Issue 仍应创建。
