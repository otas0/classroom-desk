# 脏树拆 PR 计划

当前工作区在 `main` 上有大量未提交改动（连班发现 + 双架构 + 联邦/SIS/校长等）。**合入时不要一把梭**；按下列三条线拆分支 / PR，便于回滚。

> 操作约定：用独立 branch + `gh pr create`；**不要**为合入而 `checkout main` 冲掉未提交工作（可用 `git worktree`）。本文件只定切分，真正 `commit`/`push`/`pr` 在确认后执行。

## PR A — 连班 / 发现

建议路径主题：

- `packages/shared/src/roomCode.ts`
- `apps/server/src/services/classroomBeacon.ts` / `classroomMdns.ts` / `easyJoin*.ts` / `joinAuth*` / `lanNetwork*`
- `apps/server` settings join、federation rooms（若强耦合可并入 C）
- 学生端发现 / 房间码 / 重连 / 换教室
- `ClassroomConnect` / `ProjectionRoomBanner` / SetupChecklist 连班相关
- `docs/HANDTEST_MULTI_CLASSROOM.md`

## PR B — 安装 / 双架构升级

- `apps/student-desktop` `dist-win` / installer / arm64 CI
- `.github/workflows/*` dual artifacts
- `apps/server/src/routes/upgrades.ts` + 教师双包上传 UI
- `scripts/prepare-usb-pack.sh` `CD_WIN_ARCH`
- `docs/UTM_ARM64_CHECKLIST.md` / ARTIFACTS

## PR C — 联邦 · SIS · 校长 · 校园网深化

- `federationHub` / `deploy/federation-hub` / SIS dry-run
- 校长看板 + ops CSV
- DeskDNS 向导/探测、校园网包面板、Exam Box 文档、802.1X 提示
- C2 evidence status / runbook（与锁控强相关时可拆 D）

## PR D（可选）— C2 / Intune 文档与校验

- `docs/C2_*` / `INTUNE_TRIAL_FILL` / `verify-c2-evidence` / `init-c2-evidence`
- **不含** `证据/` 媒体（gitignore）

## 建议顺序

1. A（课堂可用性）→ 2. B（装机）→ 3. C（校园运营）→ 4. D（合规文档）

每条线合并前：`npx tsc` 相关 package + 最小手测项见各 PR body。
