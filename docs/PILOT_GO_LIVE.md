# Pilot 上线四条（可部署验收）

> **口径：** Pilot 可试点交付。禁止对外写「GA」「绝密」「安全局最高机密」或等同国家密级。  
> 完整部署见 [`DEPLOY.md`](./DEPLOY.md) · TLS 见 [`TLS_REVERSE_PROXY.md`](./TLS_REVERSE_PROXY.md) · SKU 见 [`PILOT_SKU.md`](./PILOT_SKU.md)。

一键自检：

```bash
npm run check:pilot-go-live
# 或指向已部署环境文件：
npm run check:pilot-go-live -- /etc/classroom-desk.env
```

## 1. 强密钥：`JWT_SECRET` + `AUDIT_HMAC_KEY`

```bash
# 生成（各跑一次，分别写入 env，勿提交仓库）
openssl rand -hex 32   # → JWT_SECRET
openssl rand -hex 32   # → AUDIT_HMAC_KEY
```

| 变量 | 要求 |
|---|---|
| `JWT_SECRET` | **生产必填**；≥32 字符；禁止 `replace-me` / `dev-secret` / `change-me` |
| `AUDIT_HMAC_KEY` | **强烈建议**独立设置；未设时回退 `JWT_SECRET`（轮换 JWT 会伤审计链校验） |

写入 `/etc/classroom-desk.env`（`640`）后重启服务。参见 `.env.example`。

## 2. HTTPS 反代

生产最高保密档开启后，**非回环 HTTP 登录会被拒**（`tls_required`）。

1. 用 [`deploy/tls/Caddyfile.example`](../deploy/tls/Caddyfile.example) 或 nginx 终止 TLS → `127.0.0.1:8787`。  
2. 反代须传 `X-Forwarded-Proto: https`（Caddy 示例已含）。  
3. 学生 / 教师 `apiBase` = `https://教室域名`（无 `:8787`）。  
4. 验证：`curl -fsS https://教室域名/health`。

教室同 VLAN 仅 HTTP 的 Pilot：**不要**开 `max_secrecy_mode`；保留默认 S 档即可。

## 3. 按合同 SKU 配断网面（诚实）

| Pilot 包 | 须配置 | Shield=`off` 时 UI |
|---|---|---|
| **校园网包** | `CLASSROOM_DESK_SHIELD=opnsense\|unifi\|http` + 凭据 | 投影条 / 考试锁：**「网关未断」**，禁止假断网文案 |
| **单网校包** | `CLASSROOM_DESK_DNS=1`（DHCP→教师机） | 仅 DeskDNS 线；勿宣称网关已断 |
| **双线 + 最高保密档** | Shield **且** DeskDNS 运行后，再手开 `max_secrecy_mode` | 缺一不可 freeze |

实验室：`npm run lab:shield` / `lab:opnsense` / `lab:unifi`。学校真机证据仍须 live 凭据，**不能**顶替 GA。

## 4. 对外口径（硬禁止）

| 禁止写 | 可写 |
|---|---|
| GA / 1.0 全线发售 | **Pilot 可售 / 可试点** |
| 绝密 / 安全局最高机密 / 已定密 | 学校最高硬化 / 等保·密评**材料级**控制（非测评证书） |
| 无学校 live 的「网关验收通过」 | lab 证据 / SKIPPED；真机见验收文档 |

旗标：`salesPhase=pilot` · `gaReady=false`（[`SKU_CAPABILITIES.md`](./SKU_CAPABILITIES.md)）。
