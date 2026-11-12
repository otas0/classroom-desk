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
3. 教师设置 / 学生 `apiBase` = `https://classroom.school.local`（无尾斜杠、无 `:8787`）。  
4. 验证：`curl -fsS https://classroom.school.local/health`；学生连班走 HTTPS。  
5. **勿**把 `:8787` 映射公网；连班 PIN 仅教室 VLAN。见 [CLASSROOM_JOIN_SECURITY.md](./CLASSROOM_JOIN_SECURITY.md)。

## 明确不做

- 产品不内置 ACME/公网证书申请当默认路径。  
- 不教关闭证书校验 / 关 Defender 来「解决」警告。
