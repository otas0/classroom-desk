# Pilot SKU 合同边界（非 GA）

当前软件版本 **v0.1.x**。对外销售与验收以本页为准；**不是**全线开箱即用的 1.0 GA。

## 可售 Pilot 包（可签试点合同）

| 包名 | 能力旗标（须为 true / 可用） | 学校侧前置 | 不含 |
|---|---|---|---|
| **机房包** | `labAgent` + `deepLock` | Windows 机房；考试锁建议 AA + Intune | 全校交换改造、量产 Exam Box 硬件 |
| **校园网包** | `netPortal` + `networkZones` + `gatewayAllowlist` + Shield（`opnsense`/`unifi`） | 网关 API 凭据 + 跳转门户 | 隐蔽设备指纹 |
| **单网校包** | `netDns`（运行时 `netDnsRunning`） | DHCP DNS 指向教师机；可绑 :53 | 替代全校防火墙 |
| **考场 compose 包** | `examBox`（compose + GHCR） | 旁路小盒/树莓派 + `CD_API_BASE` | **量产刷机硬件**（见下） |
| **企业对接包** | `enterprise8021x` + `portalSignedSsid` | RADIUS / IdP；可选强制 SSID 签名 | 代运维 IdP |

报价与旗标必须一致：合同里写了「考场硬件」而 `examBoxHardware=false` 时 **不得履约发货硬件**，只能交付 compose/镜像试点。

## 明确未发售 / 灰显

| 项 | 旗标 | 状态 |
|---|---|---|
| Exam Box **量产硬件** | `examBoxHardware` | **永久 false 直到**量产镜像签名 + 硬件 BOM/报价单发布 |
| 隐蔽设备指纹 | `deviceFingerprinting` | **始终 false**（产品承诺不做） |
| 无学校凭据的「网关真机验收已完成」 | — | live-shield / openNDS 截图须学校侧补齐后才可写入验收 PDF |

## 切 1.0 GA 的门槛（全部满足才改版本叙事）

1. 合同边界本页升格为「GA SKU」并去掉 Pilot 字样。  
2. 约定的现场体验（在线矩阵、下课清单、同版处置、门户人话等）已合入 main。  
3. 至少一所学校的脱敏 live-shield / openNDS 证据归档通过 `check:live-evidence`。  
4. 若售硬件：`examBoxHardware=true` 且报价单 / 刷机镜像 digest 与文档一致。  
5. 版本号改为 **1.0.0**（或明确标注 GA 的日历版本），Release 说明引用本页。

在此之前对外口径：**Pilot 可售 / 可试点交付**，禁止宣传「全线发售」「硬件开箱即用」。

## 相关文档

- 销售一页：[`SKU_CAPABILITIES.md`](./SKU_CAPABILITIES.md)  
- Exam Box：[`EXAM_BOX.md`](./EXAM_BOX.md)  
- 网关验收：[`OPNSENSE_ACCEPTANCE.md`](./OPNSENSE_ACCEPTANCE.md) / [`UNIFI_ACCEPTANCE.md`](./UNIFI_ACCEPTANCE.md) / [`OPENNDS_BINAUTH.md`](./OPENNDS_BINAUTH.md)
