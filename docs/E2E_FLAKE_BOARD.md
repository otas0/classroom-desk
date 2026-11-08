# E2E flake 看板

只记**慢性** flake；修绿后删行。Quarantine（`e2e/quarantine.txt`）仅 nightly 最后手段。

| 规格 | 症状 | 缓解（已合入） | 再观察至 | 备注 |
|---|---|---|---|---|
| `e2e/audit-jump-highlight.spec.ts` | 首跑偶发无 `cd-audit-jump-hl`；e2e-full 偶发 retry | 班级+action 过滤；mount-once `consumeAuditJumpIds`；`scheduleClear` **20s**；hl assert timeout **20s**；nightly `audit-jump-smoke` `CD_E2E_RETRIES=0` | 2026-11-14 | **未删行**。删行条件见下「分开计数」。 |
| `e2e/hardening-health.spec.ts`（助教 expiresAt） | cron `42411002869`：只读仍「未绑定」；SSE 未更新 | serial + 登录后再 bind + 断言 API `inputLockExpiresAt`；去掉 reload 竞态 | 2026-11-14 | Issue [#5](https://github.com/otas0/classroom-desk/issues/5)；**勿 dispatch 凑绿** |

## 分开计数：cron vs workflow_dispatch

满 7 绿**只认 `event=schedule`（cron）**；同日 `workflow_dispatch` 再跑绿**不凑数**。

**禁止**为了「凑满 7」反复 `gh workflow run e2e-nightly.yml`：`dispatchStreak` 再高也不能删行。看板**只等**夜间 `schedule` 自然连绿；手工 dispatch 仅用于修红复验，**少开**。

```bash
# 11-14 及以后核满再删本表 audit-jump 行
npm run check:nightly-flake -- --need 7 --after 2026-11-14
# 退出码 0 = 已过观察日且 cron≥7 → 可删行并 **单独** commit；2 = 保留
# 贴回看板 Markdown：
npm run check:nightly-flake -- --md
# PR 上由 .github/workflows/flake-pr-comment.yml 自动注释同一份 --md
```

| 计数器 | 含义 |
|---|---|
| `cronStreak` | 自最近往前，仅 `schedule` 连续 success（**唯一删行依据**） |
| `dispatchStreak` | 仅 `workflow_dispatch` 连续 success（参考，**勿用于删行**） |
| `anyStreak` | 混跑连续 success（参考） |

截至 2026-11-08（#4 已合 main）：`cronStreak=0`（未到 11-14）。最近一次 **`schedule` 红**：`42411002869`（Issue #5）。workflow 仍 **active**，cron `30 16 * * *`（UTC）。**禁止**再 `workflow_dispatch` 凑数。

## 操作

1. nightly / e2e-full 红了：先看是否 audit-jump；对照上表超时是否够。
2. 仍偶发：把失败 run 链到本表「备注」，**不要**先塞 quarantine。
3. **≥2026-11-14** 且 `check-nightly-flake.mjs` 退出 0：删掉对应行并 **单独** commit（勿与功能 PR 混提）。
4. 手工核对：`gh run list --workflow=e2e-nightly.yml --limit 20 --json conclusion,event,createdAt`（看 `event=schedule` 行）

相关：`apps/teacher-web/src/auditJumpStorage.ts`（`scheduleClear`）、`.github/workflows/e2e-nightly.yml`（`audit-jump-smoke`）。