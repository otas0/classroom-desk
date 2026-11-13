# UniFi (UDM/UCG) `/api/auth/login` + block-sta 验收

## 自动化

```bash
# 本地可部署 lab（deploy/lab-unifi-api；CI 默认自动拉起）
npm run lab:unifi          # 可选：常驻 :8793
npm run test:unifi-acceptance

# 真机
export CLASSROOM_DESK_SHIELD=unifi
export UNIFI_URL=https://192.168.1.1
export UNIFI_USER=...
export UNIFI_PASS=...
export UNIFI_SITE=default
export UNIFI_LIVE=1
export UNIFI_TEST_MAC=aa:bb:cc:dd:ee:ff   # 可选：真 block/unblock
npm run test:unifi-acceptance
```

期望 health detail 含 `unifi_login_ok:/api/auth/login`（UniFi OS）或 `/api/login`（legacy）。

## 手工核对

1. Settings → System → Advanced → 允许本地 API（若有）。  
2. 客户端 MAC 在 Clients 列表可见。  
3. 跑 deny 后客户端状态为 Blocked；allow 后恢复。  
4. `/health` → `shield.active === "unifi"`。
