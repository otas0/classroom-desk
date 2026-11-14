# 校内 HTTPS（反代 · 产品不内置证书服务器）

教室默认 **HTTP `:8787`**（同 VLAN）。若学校要求加密：在教师机或机房前置 **Caddy / nginx** 终止 TLS，学生 `apiBase` 改为 `https://…`。

## 交付物

| 文件 | 用途 |
|---|---|
| [`deploy/tls/Caddyfile.example`](../deploy/tls/Caddyfile.example) | Caddy 反代 + WebSocket |
| 本页 | 校 CA / 信任链要点 |

## 步骤

1. 校内 CA 签发 `classroom.school.local`（或教师机名）证书；学生机信任校根。  
2. 复制 Caddyfile，改域名与证书路径；`reverse_proxy 127.0.0.1:8787`。  
3. 反代须转发 **`X-Forwarded-Proto: https`**（否则生产 + 最高保密档会把登录判为非 TLS → `tls_required`）。  
4. 教师设置 / 学生 `apiBase` = `https://classroom.school.local`（无尾斜杠、无 `:8787`）。  
5. 验证：`curl -fsS https://classroom.school.local/health`；学生连班走 HTTPS。  
6. **勿**把 `:8787` 映射公网；连班 PIN 仅教室 VLAN。见 [CLASSROOM_JOIN_SECURITY.md](./CLASSROOM_JOIN_SECURITY.md)。

教室同 VLAN 仅 HTTP 的 Pilot：**保持 `max_secrecy_mode=0`**（默认）；S 档仍可用。最高保密档生产环境必须本页 HTTPS。见 [PILOT_GO_LIVE.md](./PILOT_GO_LIVE.md)。

## 明确不做

- 产品不内置 ACME/公网证书申请当默认路径。  
- 不教关闭证书校验 / 关 Defender 来「解决」警告。
