# Pilot 上线

> **默认走最小部署。** 禁止对外写「GA」「绝密」「安全局最高机密」。

## 默认两条命令

```bash
npm install
npm run start:minimal   # 机房包：客户端深锁
# 或
npm run start:campus    # 校园网包：门户+Zones；网关三项可选
```

- 机房：[`MINIMAL_DEPLOY.md`](./MINIMAL_DEPLOY.md)  
- 校园网：[`CAMPUS_MINIMAL.md`](./CAMPUS_MINIMAL.md)

```bash
npm run check:pilot-go-live -- --minimal
```

## 再进阶（少用）

| 能力 | 文档 |
|---|---|
| DeskDNS 单网校 | [`DESKDNS_PORT53.md`](./DESKDNS_PORT53.md) |
| HTTPS 反代 | [`TLS_REVERSE_PROXY.md`](./TLS_REVERSE_PROXY.md) |
| 最高保密档 | [`COMPLIANCE_MLPS.md`](./COMPLIANCE_MLPS.md) |
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
