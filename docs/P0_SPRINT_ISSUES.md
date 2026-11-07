# P0 冲刺 Issue 拆分（Day 1–10）

对照 [STUDENT_LOCK_HARDENING_PLAN.md](./STUDENT_LOCK_HARDENING_PLAN.md)。每条可单独开 GitHub Issue；PR 描述须勾选文末 **P3 否决项自检**。

| Day | Issue 标题 | 验收 |
|-----|------------|------|
| 1 | exit-lock 深链 prep→settings + 轮换 E2E 稳绿 | `exit-lock-rotation-banner` 绿 |
| 2 | 学生端 Alt+F4 / 关窗拦截 toast「向教师申请解除」+ e2e | `exit-lock-blocked-close` 绿 |
| 3 | 断线锁态 localStorage 缓存 + reconcile API + 审计 `client_reconcile` | `exit-lock-reconcile` 绿 |
| 4 | 错码限流 UI：剩余次数 + 冷却倒计时 | 学生设置页 testid；错码 API 带 `remainingAttempts` |
| 5 | 批量解锁 ConfirmModal：班级名 + 预计在线机位 | `bulk-exit-unlock-confirm` |
| 6 | 非 Assigned Access 可关闭提示 | `hardening-tip`；Windows 真机手测 |
| 7 | 助教/投影只读：不可改解除码与轮换 | `exit-lock-readonly` + PATCH 仍 teacher-only |
| 8 | C2 证据表归档（narrator / taskmgr deny） | 填 [C2_EVIDENCE_ARCHIVE.md](./C2_EVIDENCE_ARCHIVE.md) 勾选 |
| 9 | smoke 含原 quarantine 五条；settings-save-msg 单挂载监视 | CI bulk gate + `settings-save-msg-single` |
| 10 | SETUP/USB「须学校 IT 知情」勾选；nightly quarantine count=0 文案 | checklist + summary |

## PR 自检（P3 否决项 — 必勾）

- [ ] 未注入其它进程 / 挂钩系统输入  
- [ ] 未做对学生隐瞒的屏幕/键鼠/麦克风采集  
- [ ] 未以绕过 SmartScreen/Defender 作为「功能」  
- [ ] 未预填演示教师口令进正式 UI  
- [ ] 未将海报/宣传 PDF 提交进 GitHub  
- [ ] 锁定相关 UI 对学生可见、可审计；无隐蔽后门码  

未全部勾选 → **不得合并**。
