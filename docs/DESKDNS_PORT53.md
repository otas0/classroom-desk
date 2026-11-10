# DeskDNS 绑定 UDP/53（systemd + setcap）

默认开发端口为 **5353**。生产若要让 DHCP 直接指向教师机 DNS，需绑定 **53**。

## 环境变量

```bash
CLASSROOM_DESK_DNS=1
CLASSROOM_DESK_DNS_PORT=53
```

## 推荐：systemd + AmbientCapabilities

将服务以非 root 启动，仅授予 `CAP_NET_BIND_SERVICE`：

```ini
# /etc/systemd/system/classroom-desk.service
[Unit]
Description=Classroom Desk API + DeskDNS
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=classroom
Group=classroom
WorkingDirectory=/opt/classroom-desk
Environment=CLASSROOM_DESK_DNS=1
Environment=CLASSROOM_DESK_DNS_PORT=53
EnvironmentFile=-/etc/classroom-desk.env
ExecStart=/usr/bin/node apps/server/dist/index.js
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now classroom-desk
```

## 备选：setcap 永久能力

若不用 AmbientCapabilities：

```bash
# 对 node 二进制（注意 nvm/版本升级会失效）
sudo setcap 'cap_net_bind_service=+ep' "$(readlink -f "$(which node)")"
getcap "$(readlink -f "$(which node)")"
```

## 验证

```bash
curl -s http://127.0.0.1:8787/health | jq .deskDns
# { "enabled": true, "running": true, "port": 53, "error": null }

sudo ss -ulnp | grep ':53'
```

DHCP 将 DNS 设为教师机 LAN IP；深锁 deny/allowlist 时 DeskDNS 跟策略解析。

参考单元：`deploy/desk-dns/classroom-desk.service.example`
