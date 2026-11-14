# Pilot 上线

> **默认走最小部署。** 禁止对外写「GA」「绝密」「安全局最高机密」。

## 默认：最小教室（推荐）

不配网关 / TLS / DeskDNS，本机 HTTP 即可：

```bash
npm install
npm run start:minimal
```

说明：[`MINIMAL_DEPLOY.md`](./MINIMAL_DEPLOY.md)

自检（Shield=off 不算失败）：

```bash
npm run check:pilot-go-live -- --minimal
```

## 可选：校园网 / HTTPS / 最高保密档

仅合同需要时再配：

| 能力 | 文档 |
|---|---|
| OPNsense / UniFi / HTTP Shield | [`NETWORK.md`](./NETWORK.md) |
| DeskDNS | [`DESKDNS_PORT53.md`](./DESKDNS_PORT53.md) |
| HTTPS 反代 | [`TLS_REVERSE_PROXY.md`](./TLS_REVERSE_PROXY.md) |
| 最高保密档（双线齐备后手开） | [`COMPLIANCE_MLPS.md`](./COMPLIANCE_MLPS.md) |
| systemd / NAS | [`DEPLOY.md`](./DEPLOY.md) |

进阶自检（会要求强密钥；Shield/DeskDNS 按 SKU 警告）：

```bash
npm run check:pilot-go-live -- /etc/classroom-desk.env
```

### 进阶密钥（仅非最小路径）

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # AUDIT_HMAC_KEY
```

最小路径已由 `ensure:minimal-env` 自动写入 `.env`，**不必手填**。
