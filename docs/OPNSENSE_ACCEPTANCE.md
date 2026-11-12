# OPNsense alias API 放行/封锁验收

## 前置

1. OPNsense 创建两个 Firewall Alias（Type: Host(s)）：
   - `classroom_desk_block`
   - `classroom_desk_allow`
2. 防火墙规则：未认证默认拒绝；`allow` 别名放行；`block` 别名拒绝（或仅用 allow 白名单）。
3. 用户 API Key + Secret（System → Access → Users → API keys）。

## 环境

```bash
export CLASSROOM_DESK_SHIELD=opnsense
export OPNSENSE_URL=https://192.168.1.1
export OPNSENSE_API_KEY=...
export OPNSENSE_API_SECRET=...
export OPNSENSE_ALIAS=classroom_desk_block
export OPNSENSE_ALLOW_ALIAS=classroom_desk_allow
```

## 自动化验收（本地 mock 或真机）

```bash
# 无真机：内置 mock HTTP 验收路径与别名写入顺序
node scripts/opnsense-alias-acceptance.mjs

# 真机：设置 OPNSENSE_* 后再跑
OPNSENSE_LIVE=1 node scripts/opnsense-alias-acceptance.mjs
```

期望：

| 动作 | API |
|---|---|
| deny | `alias_util/add/{block}` → `alias_util/delete/{allow}` → `alias/reconfigure` |
| allow / allowlist | `alias_util/add/{allow}` → `alias_util/delete/{block}` → `alias/reconfigure` |

真机时用客户端 IP 测：deny 后应无法出网；allow 后应可访问。

健康页：`GET /health` → `shield.active === "opnsense"`。

## 防火墙规则截图清单

在 OPNsense **Firewall → Aliases** 与 **Firewall → Rules** 各截一张：

1. Alias `classroom_desk_allow` / `classroom_desk_block` 可见。  
2. Rules 顺序符合 [`deploy/opnsense/walled-garden.pf.example`](../deploy/opnsense/walled-garden.pf.example)。  
3. 将截图放入 ops 证据目录（勿提交含公网 IP/密钥的原图到公开仓库）。

```bash
OPNSENSE_LIVE=1 OPNSENSE_TEST_IP=10.x.x.x npm run test:opnsense-acceptance
# 截图后记录：日期、操作者、别名成员变化前后
```
