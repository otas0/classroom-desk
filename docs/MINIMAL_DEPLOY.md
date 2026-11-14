# 最小部署（默认路径）

**目标：** 一台教师机 + 本教室学生机，**不配网关、不配 TLS、不配 DeskDNS、不手写密钥**即可开课。

不需要：OPNsense / UniFi / Captive Portal、公网、HTTPS 证书、`:53` DeskDNS、最高保密档、联邦 Hub、SIS。

```text
教师机 npm run start:minimal  →  :8787
学生机 apiBase = http://教师机局域网IP:8787
```

## 三步

```bash
cd classroom-desk
npm install
npm run start:minimal
```

终端会打印：

- 教师后台：`http://127.0.0.1:8787/admin/`
- 学生 `apiBase`：`http://<局域网IP>:8787`
- 首次教师口令（若未设 `TEACHER_PASSWORD`）

浏览器登录教师账号 → 建班 / 发作业。学生端填同一 `apiBase`。

Windows 教师机若学生连不上：管理员跑一次 `scripts/windows-teacher-host.ps1`（放行 TCP 8787）。

再次启动（已构建过）：`npm run start:minimal -- --skip-build`

## 自动写好的配置

`npm run ensure:minimal-env`（`start:minimal` 会先跑）若无 `.env` 则生成：

| 项 | 值 |
|---|---|
| `JWT_SECRET` / `AUDIT_HMAC_KEY` | 各 64 位 hex（强随机） |
| `HOST` | `0.0.0.0`（学生机能连） |
| `PORT` | `8787` |
| Shield | 未配 → UI **「网关未断」**（诚实） |
| 最高保密档 | 库默认关 |

**禁止**对外写 GA / 绝密 / 安全局最高机密。此路径 = **Pilot 机房包（客户端深锁）**，不是校园网断网包。

## 可选加料（有需要再开）

| 需求 | 再做什么 |
|---|---|
| 校园网真断网 | `CLASSROOM_DESK_SHIELD=opnsense\|unifi\|http` + 凭据 · [`NETWORK.md`](./NETWORK.md) |
| 单网校 DNS 拦 | `CLASSROOM_DESK_DNS=1` · DHCP 指教师机 |
| 校内 HTTPS | [`TLS_REVERSE_PROXY.md`](./TLS_REVERSE_PROXY.md) |
| 最高保密档 | 双线齐备后设置里手开 · [`COMPLIANCE_MLPS.md`](./COMPLIANCE_MLPS.md) |
| 开机自启 / NAS 备份 | [`DEPLOY.md`](./DEPLOY.md) |

进阶验收四条：[`PILOT_GO_LIVE.md`](./PILOT_GO_LIVE.md)（`npm run check:pilot-go-live -- --minimal`）。
