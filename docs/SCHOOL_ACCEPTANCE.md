# 学校验收证据清单（Pilot）

签约/试点结项前勾选。脱敏后归档：`npm run archive:live-shield` → `npm run check:live-evidence`。

**一键导出 PDF：** 教师端「加固体检」→「导出 C2 验收 PDF」（`GET /api/v1/c2-evidence/acceptance.pdf`）。文档槽已在 #16 合入；本接口按现场 C2 目录与 SKU 旗标填状态（无学校凭据的网关项标 SKIPPED，不写成通过）。

## 必选（有对应 SKU 时）

| 证据 | 适用包 | 状态 |
|---|---|---|
| 教师 Web + labAgent 深锁演示（冻结/仅试卷/下课） | 机房包 | □ |
| 门户 admit + 花名册 | 校园网包 | □ |
| DeskDNS 绑定与课策略回落 | 单网校包 | □ |
| OPNsense 或 UniFi live-shield 脱敏包 | 校园网包 | □ 需学校凭据 |
| openNDS allow / deny / FAS 三张图 | 考场 compose / 开放网关 | □ 需真机 |
| Exam Box compose `api-ready` 宕机退出 | 考场 compose | □ |
| Cosign 验签（digest 见 EXAM_BOX.md） | 考场 compose | □ |
| C2 / Intune 证据槽（若学校机考试锁） | 机房包 | □ |

## 明确不验收为「已发售硬件」

- `examBoxHardware=false` 时不得签署「量产小盒到货」条款。  
- 无学校网关凭据时，live-shield 仅能保留 SKIPPED 骨架，**不能**写进「网关验收通过」。
