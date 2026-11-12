# openNDS BinAuth ↔ Classroom Desk allowlist 联调

目标：未认证只通 `/portal`；门户 `admit allow` 后 IP 进入网关放行表；openNDS BinAuth / 定时脚本据此授权。

## 组件

| 组件 | 路径 |
|---|---|
| 放行表 API | `GET /api/v1/gateway/allowlist`（需教师 JWT） |
| 单 IP 检查 | `GET /api/v1/gateway/check?ip=` |
| 同步脚本 | [`deploy/opennds/auth_allowlist.sh`](../deploy/opennds/auth_allowlist.sh) |
| BinAuth 钩子 | [`deploy/opennds/binauth.sh`](../deploy/opennds/binauth.sh)（已打进 Exam Box 镜像） |
| Exam Box | [`deploy/exam-box/`](../deploy/exam-box/) |

## 联调步骤

1. 教师机起 API；设置门户共用码或 OTP。  
2. Captive Portal / openNDS FAS 跳转：  
   `http://教师机:8787/portal?` + `POST /api/v1/gateway/sign-ssid` 返回的 query。  
3. 学生认证成功后 `admit` → allowlist 出现客户端 IP。  
4. 在 openNDS 主机：

```bash
export CD_API_BASE=http://教师机:8787
export CD_STAFF_TOKEN='教师 JWT'
sudo install -m 0755 deploy/opennds/auth_allowlist.sh /usr/local/bin/cd-opennds-allowlist.sh
# 每 15s
watch -n 15 /usr/local/bin/cd-opennds-allowlist.sh
```

5. 确认 `ndsctl auth <ip>` 成功；浏览器出网。  
6. 教师「结束深锁」→ epoch 递增 + allowlist 清空 → 脚本 `deauth`。

## BinAuth 钩子

Exam Box 镜像内：`/usr/local/bin/cd-opennds-binauth.sh`（源：`deploy/opennds/binauth.sh`）。

```bash
# openNDS 配置 BinAuth=/usr/local/bin/cd-opennds-binauth.sh
export CD_API_BASE=http://教师机:8787
# 钩子内部调用 GET /api/v1/gateway/check?ip=… ；exit 0=放行
```

定时 `auth_allowlist.sh` 仍建议保留作兜底同步。

## 验收清单

- [ ] 未认证访问非 portal 域名被劫持/拒绝  
- [ ] `/portal` 可打开  
- [ ] admit 后 `gateway/check` 为 true  
- [ ] `auth_allowlist.sh` 打印 `opennds sync ok`  
- [ ] BinAuth `cd-opennds-binauth.sh` exit 0/1 与 allowlist 一致  
- [ ] 下课后天网再次封锁  

## 真机联调截图归档

将截图放入（勿提交密钥/公网 IP）：

```text
tmp/live-evidence/<YYYY-MM-DD>/screenshots/
  opennds-binauth-allow.png    # admit 后出网
  opennds-binauth-deny.png     # 未认证 / 下课后封锁
  opennds-fas-redirect.png     # Captive → /portal?ssid_ts&ssid_sig
```

文档内链（相对证据目录；无图时保持文件名约定，勿提交含密钥的 PNG）：

| 场景 | 预期文件 |
|---|---|
| BinAuth 放行 | [`../tmp/live-evidence/`](../tmp/live-evidence/)…`/screenshots/opennds-binauth-allow.png` |
| BinAuth 拒绝 | …`/screenshots/opennds-binauth-deny.png` |
| FAS → 门户 | …`/screenshots/opennds-fas-redirect.png` |

归档后跑脱敏：

```bash
npm run check:live-evidence
# 可选：证据里误写内网管理 URL 时失败
npm run check:live-evidence -- --fail-on-rfc1918-leak
```

占位说明：当前环境无 OPNsense/openNDS 真机凭据时目录可为空；`npm run archive:live-shield` 会创建当日 `screenshots/`。填入学校凭据后重跑并粘贴上述三张图。
