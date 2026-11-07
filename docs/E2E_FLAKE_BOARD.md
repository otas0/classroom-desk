# E2E flake 看板

只记**慢性** flake；修绿后删行。Quarantine（`e2e/quarantine.txt`）仅 nightly 最后手段。

| 规格 | 症状 | 缓解（已合入） | 再观察至 | 备注 |
|---|---|---|---|---|
| `e2e/audit-jump-highlight.spec.ts` | 首跑偶发无 `cd-audit-jump-hl`；e2e-full 偶发 retry | 班级+action 过滤；mount-once `consumeAuditJumpIds`；`scheduleClear` **20s**；hl assert timeout **20s**；nightly `audit-jump-smoke` `CD_E2E_RETRIES=0` | 2026-11-14 | 若一周后仍偶发：加 DOM 落盘截图 + 查 StrictMode 双挂载是否仍清 stash |

## 操作

1. nightly / e2e-full 红了：先看是否 audit-jump；对照上表超时是否够。
2. 仍偶发：把失败 run 链到本表「备注」，**不要**先塞 quarantine。
3. 连续 7 个 nightly 绿：删掉对应行。

相关：`apps/teacher-web/src/auditJumpStorage.ts`（`scheduleClear`）、`.github/workflows/e2e-nightly.yml`（`audit-jump-smoke`）。
