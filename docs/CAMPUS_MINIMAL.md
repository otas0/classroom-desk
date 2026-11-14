# 校园网最小路径

在教室最小部署之上，学校网只多做 **软件一键 + 可选网关三项**。

不需要：公网、HTTPS、DeskDNS、强制 Captive 签名、联邦 Hub、SIS。

```bash
npm install
npm run start:campus
```

## 学校侧最少要求

| 必须 | 可选（真断网） |
|---|---|
| 师生同一 SSID / VLAN，**关 AP 隔离** | 填 `.env` 网关 **三选一**（见下） |
| 学生 `apiBase=http://教师机IP:8787` | Captive 跳转 `/portal`（严格模式再开签名） |
| 设置里改 Zones「学生网/教工网」SSID 关键字 | — |

启动时若 `CLASSROOM_DESK_CAMPUS=1`，自动套用**宽松预设**：

- 私人设备走门户  
- 两档 Zones 模板（学生网 / 教工网）  
- **不**强制 SSID 签名（少一项网关改造）  
- Shield 未填时 UI 诚实「网关未断」

## 真断网：只填三选一

编辑 `.env`（`ensure:campus-env` 已留注释），**只开一组**：

```bash
# A) OPNsense
CLASSROOM_DESK_SHIELD=opnsense
OPNSENSE_URL=https://防火墙IP
OPNSENSE_API_KEY=…
OPNSENSE_API_SECRET=…

# B) UniFi
CLASSROOM_DESK_SHIELD=unifi
UNIFI_URL=https://控制器IP
UNIFI_USER=…
UNIFI_PASS=…

# C) HTTP 网关 / 本校 lab
CLASSROOM_DESK_SHIELD=http
CLASSROOM_DESK_SHIELD_URL=http://…
CLASSROOM_DESK_SHIELD_TOKEN=…
```

重启服务。教师设置 → Shield 向导可点「测连通」。本地无网关时：`npm run lab:opnsense` / `lab:unifi` / `lab:shield`。

## 教师 UI

| 动作 | 位置 |
|---|---|
| 再套预设 | 设置 → 校园网包 →「一键校园网预设」 |
| 严格 Captive 签名 | 同一按钮需 API `mode:hard`，或环境 `CLASSROOM_DESK_PORTAL_SSID_REQUIRE_SIG=1` |
| 改 SSID 关键字 | 网络档 Zones |

## 与机房最小路径关系

| 命令 | 场景 |
|---|---|
| `npm run start:minimal` | 机房包：客户端深锁，不断校园网 |
| `npm run start:campus` | 校园网包：门户 + Zones；网关三项可选 |

禁止对外写 GA / 绝密 / 安全局最高机密。
