# 等保 / 密评材料级控制矩阵（网络与防火墙）

> **范围：** 校园网包（Shield + 门户 + Zones + 放行表）与单网校包（DeskDNS）**双线并行**。  
> **定位：** 在「校安运维级」（失败闭合、无假成功、可审计）之上，补控制矩阵、日志留存、账号分权与证据包，供学校信息中心 / 密评材料引用。  
> **非承诺：** 本文不替代正式等保测评报告；不宣称产品已通过某级等保认证。材料由学校 IT 结合本校拓扑填证。  
> **S 档声明：** `security_tier_s=1`（默认）是**学校部署最高硬化档**（审计哈希链、双线武装门闩、禁未映射软放行、admin 敏感闸）。**不是**国家秘密 / 绝密信息系统，禁止对外宣传「安全局最高机密」或等同密级。

相关：[`SECURITY.md`](./SECURITY.md) · [`PERMISSIONS.md`](./PERMISSIONS.md) · [`NETWORK.md`](./NETWORK.md) · [`PILOT_SKU.md`](./PILOT_SKU.md) · [`CLASSROOM_JOIN_SECURITY.md`](./CLASSROOM_JOIN_SECURITY.md)

## 1. 双线架构（执行面）

```mermaid
flowchart TB
  teacher[Teacher_API]
  subgraph campus [CampusNet_path]
    portal[Portal_admit]
    zones[NetworkZones]
    allow[Gateway_allowlist]
    shield[Shield_OPNsense_UniFi_HTTP]
  end
  subgraph dnsPath [DeskDNS_path]
    deskdns[DeskDNS_UDP]
    profile[exam_normal_open]
  end
  agent[Lab_agent_deepLock]
  teacher --> portal
  teacher --> zones
  teacher --> allow
  teacher --> shield
  teacher --> deskdns
  teacher --> agent
  portal --> allow
  allow --> shield
  profile --> deskdns
```

| 线 | 断网机制 | 学校前置 | Pilot 旗标 |
|---|---|---|---|
| **校园网包** | 网关 alias / 防火墙按客户端授权 | OPNsense 或 UniFi API 凭据 + Captive→门户 | `netPortal` + `networkZones` + `gatewayAllowlist` + Shield≠off |
| **单网校包** | 教师机 DNS 污染/拦截（DeskDNS） | DHCP DNS→教师机；可选 :53 | `netDns` / 运行时 `netDnsRunning` |

两条可同时启用；深锁 UI 必须诚实显示「网关未断」当 Shield=`off`。

## 2. 控制矩阵（密评常用类）

| 控制类 | 要求摘要 | 产品实现 | 证据 |
|---|---|---|---|
| **身份鉴别** | 教师/助教/学生分角色；敏感操作需鉴权 | JWT + `requireRoles`；深锁/Zones/DeskDNS 写 = teacher/admin | [`PERMISSIONS.md`](./PERMISSIONS.md)；`e2e/assistant-rbac` |
| **访问控制** | 默认拒绝未映射网；教工网可强制门户 | Zones + `unmapped_zone` block；`private_device_portal_only`；SSID 签名可选强制 | 门户拦截大字条；`portalAuth` 单测 |
| **安全审计** | 操作可追溯；留存可配置 | `teacher_audit_log`；网络动作前缀 `deep_lock.*` / `shield.*` / `deskdns.*` / `portal.*` | 审计导出；`audit_retention_days`（默认 **180**） |
| **通信完整/保密** | 生产宜 TLS | 教室默认可 HTTP；生产见 TLS 反代文档 | [`TLS_REVERSE_PROXY.md`](./TLS_REVERSE_PROXY.md) |
| **入侵防范 / 边界** | 考试网默认拒绝；失败不装成功 | Shield `off`→`ok:false`；authorize 失败记 `shield_*_fail` + 顶栏错误 | `shieldOffDefault` / `shieldReleaseFail`；对账 API |
| **恶意代码防范** | 不做隐蔽间谍功能 | 禁止键鼠/剪贴板暗采；锁可见 | [`SECURITY.md`](./SECURITY.md) 否决项 |
| **资源控制** | 课节结束收回放行 | 下课收工 / `deep_lock.end`：epoch 作废 + 放行表清 + Shield release | 下课确认抽屉；审计 `deep_lock.end` |
| **剩余信息保护** | 导出脱敏 | live-shield / compliance 证据包脚本去凭据 | `check:live-evidence`；`export:compliance-evidence` |

## 3. 账号分权（网络面）

| 能力 | admin | teacher | assistant |
|---|:---:|:---:|:---:|
| 查看 Shield / 放行表 / DeskDNS 状态 | ✓ | ✓ | ✓ |
| 深锁 freeze / exam_net / kick / end | ✓ | ✓ | — |
| 改 Network Zones / 门户强制签名 | ✓ | ✓ | — |
| 改 DeskDNS profile（exam/normal/open） | ✓ | ✓ | — |
| Shield 向导 ping / 写适配器 | ✓ | ✓ | — |
| 导出审计 / 合规证据包 | ✓ | ✓ | 审计只读导出 ✓；合规包 teacher/admin |
| 批准陌生设备连班 | ✓ | ✓ | —（UI 只读提示） |

助教：**只读**网络态势与审计，**不可**改断网面。与 [`PERMISSIONS.md`](./PERMISSIONS.md) 同步。

## 4. 日志留存与防篡改（S 档）

| 项 | 默认 | 说明 |
|---|---|---|
| `audit_retention_days` | **180** | 教师审计表按日滚动删除（调度器）；可 30–730；**改留存 / 清理 = admin** |
| 哈希链 | `prev_hash` / `row_hash` | SHA-256 追加链；`GET /api/v1/compliance/audit-chain` |
| 回收站软删 | 7 天 | 与审计留存分离，勿混用 |
| 合规证据包 | JSON + `.sha256` | `contentSha256`；一键导出可教师/admin |
| live 归档 | admin | 无学校 LIVE 仍写 SKIPPED；**不升 GA** |

**不可篡改声明：** 哈希链可检出应用层改写；**不**防物理拷贝改库或替换整文件。密评应另做 NAS 只读快照 / WORM / SIEM。

## 5. 失败闭合（双线 · S 档加严）

| 场景 | 期望行为 |
|---|---|
| Shield 未配置且 DeskDNS 未运行 | **拒绝** freeze/exam_net/kick（`strict_net_fail_closed`）；审计 `deep_lock.strict_refuse` |
| 仅客户端冻、无断网面 | 须先武装 Shield **或** DeskDNS |
| Shield API 失败 | `ok:false` + 审计 + 顶栏错误；客户端仍按深锁收紧 |
| 未映射 SSID | 默认 **block**；S 档/生产/`CLASSROOM_DESK_STRICT=1` **禁止** `PORTAL_UNMAPPED` 软放行 |
| DeskDNS 未运行而 profile=exam | 对账 critical；UI 警告 |
| 下课收工 | 确认后清 epoch / 放行表 / 连班 / 深锁；Shield release 失败仍记审计 |

## 6. 证据包清单

```bash
# 脱敏合规包（本地/试点）
npm run export:compliance-evidence
# 或教师设置 → 校园网包 →「一键导出合规包」

# 网关 alias 对账（读 OPNsense allow/block alias vs 本地放行表）
curl -sS -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8787/api/v1/compliance/alias-reconcile | jq .

# 网关 lab 三图（不可顶替学校真机）
npm run archive:opennds-lab
npm run archive:live-shield   # 无 LIVE 凭据 → SKIPPED；仍写 net-reconcile + GA_HARD_GATE.md
npm run check:live-evidence

# 对账（需教师 token）
curl -sS -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8787/api/v1/compliance/net-reconcile | jq .
```

### GA 硬门槛（不变）

| 可做 | 不可宣称 GA |
|---|---|
| lab `archive:opennds-lab` / `lab:opnsense` alias 对账 | 仅有 SKIPPED manifest |
| 教师端导出合规包 + 审计留存 | 无学校 `OPNSENSE_LIVE=1` / `UNIFI_LIVE=1` 真机通过 |
| DeskDNS follow 深锁 | 把 lab 证据写成「验收通过」 |

学校真机截图与凭据归档见 [`OPNSENSE_ACCEPTANCE.md`](./OPNSENSE_ACCEPTANCE.md) / [`UNIFI_ACCEPTANCE.md`](./UNIFI_ACCEPTANCE.md)。**无学校 live 证据不得宣称 GA**（[`PILOT_SKU.md`](./PILOT_SKU.md)）。

## 6b. DeskDNS ↔ 深锁联动

默认 `deskdns_follow_deeplock=1`：`freeze` / `exam_net` / `kick_class` → DeskDNS `exam`（DNS NXDOMAIN，门户域除外）；`end` / `allow_net` → 恢复 stash。可在设置页关闭。

## 7. 密评材料引用建议（学校填写）

1. 拓扑图：教室 VLAN、门户跳转、Shield 网关、DeskDNS DHCP 指向。  
2. 附本页控制矩阵 + 角色表截图。  
3. 附连续 ≥30 天审计导出（或按本校策略）。  
4. 附一次深锁 freeze + 下课收工全链路审计。  
5. 双线各一份：Shield health 通过记录 **或** DeskDNS `:53` 检测通过记录。
