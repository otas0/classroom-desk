# 教室路由器 / 防火墙端口放行说明

Classroom Desk 为校内中心服务部署：教师机或教室服务器跑 API，学生端小窗通过局域网访问。

**无证书、教师机当服务器、多学生机互联：** 见 [CLASSROOM_TEACHER_HOST.md](./CLASSROOM_TEACHER_HOST.md)（含 `scripts/windows-teacher-host.ps1`）。

## 需要放行的端口

| 端口 | 协议 | 方向 | 用途 |
|---|---|---|---|
| **8787** | TCP | 学生机 → 服务器 | Express API、`/uploads` 附件、生产态教师后台 `/admin` |
| 5174 | TCP | 本机 | **仅开发**教师 Vite；生产请用 `npm run build:teacher` 后由 8787 托管 |

Windows 服务器示例（管理员 PowerShell）：

```powershell
New-NetFirewallRule -DisplayName "Classroom Desk API" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow
```

## 学生端服务器地址（apiBase）

安装包内嵌 `resources/config.json`：

```json
{ "apiBase": "http://192.168.1.50:8787" }
```

首次运行会复制到用户目录。管理员可在学生端「设置」输入管理密码后修改并保存。

## 健康检查

```bash
curl http://192.168.1.50:8787/health
# 关注 backup.latestAt / backup.ageHours、db.ok
```

教师后台（生产）：`http://192.168.1.50:8787/admin/`

## AP 隔离（Client Isolation）排查

症状：学生机能上网，但打不开 `http://教室服务器IP:8787/health`，教师机正常。

| 步骤 | 操作 |
|---|---|
| 1 | 在学生机 `ping 教室服务器IP`；若不通，优先怀疑二层隔离 |
| 2 | 登录 AP / 路由器管理页，关闭 **AP Isolation / Client Isolation / 无线隔离 / 访客网络隔离** |
| 3 | 确认学生与服务器在同一 VLAN / 同一 SSID（避免「访客 Wi‑Fi」只能出网） |
| 4 | 若使用多个 AP，检查是否开启了漫游隔离或 ACL 禁止无线→有线 |
| 5 | Windows 服务器确认防火墙已放行 8787 入站 |
| 6 | 临时用网线接入学生机再测；有线通、无线不通 → 几乎可断定无线隔离 |
| 7 | 仍失败时抓学生机 `tracert` / 路由器客户端列表，确认 IP/网关是否被隔离网段改写 |
| 8 | 用教师后台 **设置 → 一键检测 /health**（见下）在教师机与学生机浏览器各测一次延迟 |

### 与教师后台「网络诊断」交叉使用

生产教师 UI：`http://教室服务器IP:8787/admin/` → **设置** → **一键检测 /health**。

- 教师机正常、学生机失败：优先按上表查 **AP 隔离**（本机浏览器直连 `/health` 与诊断结果应一致）。
- 两台都失败：查服务器进程、防火墙、`apiBase`/反代，而不是无线隔离。
- 诊断文案会带延迟毫秒与 `backup.latestAt`；若出现 `backup.lastError`，先修备份/NAS 挂载再谈网络。

家用路由器常见菜单位置（名称因品牌而异）：无线设置 → 高级 → **AP 隔离**；或访客网络 → **允许访问局域网**（需开启）。

## Shield（网关断网）

默认 **未配置**（`off`）：深锁/踢网不会假装成功。要真断网：

- **教师设置 → Shield**：选 `opnsense` / `unifi` / `http`（写入 DB，保存即 reload）；或  
- 环境变量（优先于设置）：

```bash
export CLASSROOM_DESK_SHIELD=opnsense   # 或 unifi / http
# http 时另设 CLASSROOM_DESK_SHIELD_URL + CLASSROOM_DESK_SHIELD_TOKEN
```

本地联调（可部署 lab 程序，无进程内假成功）：

```bash
npm run lab:shield      # HTTP 网关 :8791 + openNDS 证据页
npm run lab:opnsense    # OPNsense API :8792
npm run lab:unifi       # UniFi API :8793
```

| 适配器 | 本地 | 学校真机 |
|---|---|---|
| `http` | `lab:shield` + `CLASSROOM_DESK_SHIELD_URL` | 自建 HTTP 网关 |
| `opnsense` | `lab:opnsense` + `OPNSENSE_*` | 控制器 API |
| `unifi` | `lab:unifi` + `UNIFI_*` | UDM/UCG API |
| `off` | 默认；未配置不假装成功 | — |

`CLASSROOM_DESK_SHIELD=mock` **不支持**（设了会落回 `off` 并打错误日志）。

## 不建议

- 把 8787 映射到公网
- 依赖开发端口 5174 做教室部署
- 未配置 Shield 却对外宣称「已断网」
