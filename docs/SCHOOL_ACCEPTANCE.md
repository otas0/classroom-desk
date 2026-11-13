# 学校验收证据清单（Pilot）

签约/试点结项前勾选。脱敏后归档：`npm run archive:live-shield` → `npm run check:live-evidence`。

**一键导出 PDF：** 教师端「加固体检」→「导出 C2 验收 PDF」（`GET /api/v1/c2-evidence/acceptance.pdf`）。文档槽已在 #16 合入；本接口按现场 C2 目录与 SKU 旗标填状态（无学校凭据的网关项标 SKIPPED，不写成通过）。

**状态约定：** `lab ✓` = 本机/CI 可复现，**不能**当作学校结项通过；`学校 □` = 须现场手测或真机凭据。

## 必选（有对应 SKU 时）

| 证据 | 适用包 | 本地/CI（2026-11-13） | 学校现场 |
|---|---|---|---|
| 教师 Web + labAgent 深锁演示（冻结/仅试卷/下课） | 机房包 | lab ✓ `deepLock.test` + CI e2e | □ |
| 门户 admit + 花名册 | 校园网包 | lab ✓ `portalAuth.test` | □ |
| DeskDNS 绑定与课策略回落 | 单网校包 | lab ✓ `deskDnsProbe` / `deskDnsResolveProbe` | □ |
| OPNsense 或 UniFi live-shield 脱敏包 | 校园网包 | lab ✓ `test:opnsense-acceptance` / `test:unifi-acceptance`（**非**学校 LIVE） | □ 需学校凭据 |
| openNDS allow / deny / FAS 三张图 | 考场 compose / 开放网关 | lab ✓ `archive:opennds-lab` → `tmp/live-evidence/2026-11-13/screenshots/opennds-lab-*.html`；`check:live-evidence` ok | □ 学校真机另补 |
| Exam Box compose `api-ready` 宕机退出 | 考场 compose | □ 未跑 compose 现场 | □ |
| Cosign 验签（digest 见 EXAM_BOX.md） | 考场 compose | □ 未跑 cosign | □ |
| C2 / Intune 证据槽（若学校机考试锁） | 机房包 | □ 槽位文档有；无学校机填充 | □ |

## 本轮本地手测记录（非学校结项）

| 包 | 命令 / 结果 |
|---|---|
| 机房 | `npx tsx apps/server/src/test/deepLock.test.ts` → ok |
| 校园网 Portal | `portalAuth.test.ts` → ok |
| 单网校 DeskDNS | `deskDnsProbe` + `deskDnsResolveProbe` → ok |
| Shield lab | `npm run test:opnsense-acceptance` / `test:unifi-acceptance` → lab OK |
| openNDS lab | `npm run archive:opennds-lab` → HTML 四页；`check:live-evidence` → ok（无密钥泄漏） |
| 企业 SSID 签名 | `portalSsidSign.test.ts` → ok（含未配置 Shield 诚实失败） |

## 明确不验收为「已发售硬件」

- `examBoxHardware=false` 时不得签署「量产小盒到货」条款。  
- 无学校网关凭据时，live-shield 仅能保留 SKIPPED 骨架，**不能**写进「网关验收通过」。  
- 上表「本地/CI lab ✓」**不**满足 [`PILOT_SKU.md`](./PILOT_SKU.md) GA 第 3 条。
