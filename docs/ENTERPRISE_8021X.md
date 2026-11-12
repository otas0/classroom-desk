# 802.1X / WPA-Enterprise 对接

Classroom Desk **不内置 RADIUS 服务器**。学校用现有 IdP（Windows NPS、FreeRADIUS、Cisco ISE、UniFi RADIUS 等）做每人一密 / 证书上网；本产品负责 **认人后的课堂策略**（门户、网络配置档、Shield、深锁）。

教师设置可勾选 **要求 802.1X**（`enterprise_8021x_required`）：写入设置并在校长看板运营视图提示 IT，**不会在应用内伪造 RADIUS 认证**。

## 为何需要

共用 Wi‑Fi 密码（PSK）会泄露。802.1X 让教工网使用教工账号，学生即使得知 SSID 也无法用学生身份通过认证。

## 推荐拓扑

```text
学生 SSID  → 802.1X(学生账号) 或 PSK+强制门户 /portal
教工 SSID  → 802.1X(教工账号) 必选；禁止学生 VLAN
访客 SSID  → 门户 + 隔离 VLAN
```

教工 SSID 在 Classroom Desk「网络配置档」中：`allowedRoles` 不含 `student`，`requirePortal` 由系统强制。

## 与本产品的接点

| 接点 | 说明 |
|---|---|
| 网络配置档 | 按 VLAN/SSID/CIDR 匹配，不写死 guest/teacher 名称 |
| `/portal` | PSK 场景零安装认人；802.1X 场景可作二次课堂授权 |
| Shield | OPNsense / UniFi 适配器按客户端 IP/MAC 放行 |
| `never_student_net` | 学生账号从未在学生允许档认证却出现在教工档 → block |

## 部署检查清单

1. 教工 SSID 仅 WPA2/WPA3-Enterprise，关闭 PSK。  
2. RADIUS 组：教工 / 学生分发不同 VLAN。  
3. Captive Portal 仅挂在需要 BYOD 的学生/访客 SSID；回调注入签名 SSID：`POST /api/v1/gateway/sign-ssid`。  
4. DHCP DNS 可指 DeskDNS（`CLASSROOM_DESK_DNS=1`）。  
5. 验收：学生账号无法关联教工 VLAN；学生连教工失败或门户 block。
6. 连班 PIN / HTTP 仅在教室 VLAN 内信任；勿将 `:8787` 暴露到公网。见 [CLASSROOM_JOIN_SECURITY.md](./CLASSROOM_JOIN_SECURITY.md)。

## 明确不做

- 本仓库不实现完整 RADIUS。  
- 不做隐蔽设备指纹替代 802.1X。  
