# DeskDNS 绑定 UDP/53（systemd + setcap）

默认开发端口为 **5353**。生产若要让 DHCP 直接指向教师机 DNS，需绑定 **53**。

## 环境变量

```bash
CLASSROOM_DESK_DNS=1
CLASSROOM_DESK_DNS_PORT=53
```

## 教师设置（可不改环境变量）

设置 → 勾选启用 DeskDNS，端口填 `5353`（开发）或 `53`（生产 DHCP）。  
保存后服务会重新绑定。绑定 53 失败时 `/health.deskDns.error` 为真实 bind 错误（常见：无 `CAP_NET_BIND_SERVICE`）。

环境变量 `CLASSROOM_DESK_DNS=1` 仍优先生效（systemd）。

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

## Windows 教师机绑定 53

Windows 上 53 常被系统 DNS Client 占用。优先：

1. DeskDNS 用 **5353**，若路由器支持非标 DNS 端口则 DHCP 指向 `教师IP`+5353；或  
2. 机房 Linux 旁路（Exam Box / 迷你 PC）绑 53；或  
3. IT 变更单评估停用冲突服务后再以管理员跑 API（少见）。

## 验证

```bash
curl -s http://127.0.0.1:8787/health | jq .deskDns
# { "enabled": true, "running": true, "port": 53, "error": null }

sudo ss -ulnp | grep ':53'
```

教师端「检测 DeskDNS / :53」；DHCP DNS 设为教师机 LAN IP；深锁 deny/allowlist 时 DeskDNS 跟策略解析。

参考单元：`deploy/desk-dns/classroom-desk.service.example`  
校内 HTTPS：`docs/TLS_REVERSE_PROXY.md`
