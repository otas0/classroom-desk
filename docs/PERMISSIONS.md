# 角色权限矩阵

> 单一来源。构建/开发时由 `scripts/sync-permissions-md.mjs` 同步到
> `apps/teacher-web/public/PERMISSIONS.md`（设置页「权限说明」链接）。

本教室工具账号角色：`admin` · `teacher` · `assistant` · `student`。

| 能力 | admin | teacher | assistant | student |
| --- | :---: | :---: | :---: | :---: |
| 登录教师后台 | ✓ | ✓ | ✓ | — |
| 查看名单 / 发题列表 / 态势 | ✓ | ✓ | ✓ | 仅本班可见题 |
| 导入/增改学生、改学号 | ✓ | ✓ | — | — |
| 批量删除学生（软删/回收站） | ✓ | ✓ | — | — |
| 发布 / 编辑题目 | ✓ | ✓ | — | — |
| 批量收卷 / 重开 / 下线 | ✓ | ✓ | ✓ | — |
| 批量删除题目 / 设·清空截止 | ✓ | ✓ | — | — |
| 手动加分 / 审批加分请求 | ✓ | ✓ | — | 发起请求 |
| 出勤报表只读 | ✓ | ✓ | ✓ | 本人状态 |
| 出勤排班写 / 开场 | ✓ | ✓ | — | 签到 |
| 导出签到 / 积分 / 题目 | ✓ | ✓ | ✓ | — |
| 创建助教账号 | ✓ | ✓ | — | — |
| 停用 / 启用 / 重置助教口令 | ✓ | ✓ | — | — |
| 改本人登录密码 | ✓ | ✓ | ✓ | — |
| 系统设置 / 留言开关 / 退出锁 | ✓ | ✓ | 退出锁审计只读（无批量解除/轮换码） | — |
| 操作审计查看与导出 | ✓ | ✓ | ✓ | — |
| 默认落地页 | 上课 | 上课 | 出勤报表（只读） | 学生端 |

## 软删除与 JWT

- 学生被软删除后，名单与 `/roster` 不再出现。
- 未过期学生 JWT 在下次鉴权时返回 `401 account_deleted`，须重新选人。
- 软删同时写入 `session_kicks` 并清 presence，客户端心跳会强制下线。
- 回收站默认保留 **7 天**（`RECYCLE_RETENTION_DAYS` / `recycle_retention_days`，与 `@classroom-desk/shared` 一致；教师设置页不得默认写成 30）。升级一次性把历史默认 `30` 迁到 `7`（`recycle_retention_align_shared_v1`）；自定义天数（如 14）不动。设置页在与 shared 不一致时提示。列表展示剩余天数；剩余 ≤ `recycle_urgent_days`（默认 1）时醒目高亮。到期由调度器硬删（级联清除关联记录）。
- 旧助教在迁移 `assistant_password_ok_backfill_v1` 时批量 `password_ok=1`，避免升级后全员被首次改密闸拦截；新创建助教仍为 `password_ok=0`。
- PR CI 跑 bulk + rbac 并行门禁；完整 Playwright 在 `e2e-nightly`（cron / 手动）。

## 创建助教

教师后台 → 设置 →「创建助教账号」：用户名 + 初始口令（≥8 位且含字母数字）。
API：`POST /api/v1/auth/assistants`（teacher/admin）。
停用 / 启用 / 重置口令：`POST .../assistants/:id/disable|enable|reset-password`。
