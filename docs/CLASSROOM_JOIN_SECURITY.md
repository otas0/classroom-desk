# 连班鉴权与教室网信任边界

Classroom Desk 默认假设：**教师机 `:8787` 只在教室 / 机房局域网可达**，不是公网服务。

## 明文传输（现状）

- 学生发现、房间码、一键连班、`POST /api/v1/classroom/join/attach` 的 **PIN** 默认走 **HTTP**。
- PIN 在服务端以哈希存储；传输仍可能被同网段嗅探。
- 已有防护：按 IP **连班失败限速**（约 10 次 / 5 分钟 → 429）、可选 **陌生设备须教师批准**。

## 部署要求

1. **不要**把 `:8787` 端口映射到公网或访客 Wi‑Fi 无隔离区。
2. 访客 AP isolation 场景用手输 **房间码**（不依赖广播）；仍视为教室信任域。
3. 学校若要求加密：在教师机前加 **本机/机房反向代理**（Caddy/nginx）终止 **自签或校内 CA TLS**，学生 `apiBase` 改为 `https://…`（证书需可被学生机信任，或由 IT 预置根证书）。
4. 产品路径 **不**教用户关闭 Defender / SmartScreen 来「解决」安全提示；签名包见 [SMARTSCREEN.md](./SMARTSCREEN.md)、[LOCAL_USB_CHECKLIST.md](./LOCAL_USB_CHECKLIST.md)。

## 可选加固（运维）

| 措施 | 说明 |
|------|------|
| 教室 VLAN | 师生同网段；禁止跨楼随意访问教师机管理口 |
| TLS 反代 | 仅教室 DNS/`hosts` 指向讲台；自签需预置信任 |
| 连班 PIN + 设备批准 | 防同网蹭班；PIN 勿投屏过久 |
| 联邦 Hub token | 跨 VLAN 登记用 `FEDERATION_HUB_TOKEN`，勿写进公开文档截图 |

## 相关

- 手测：[HANDTEST_MULTI_CLASSROOM.md](./HANDTEST_MULTI_CLASSROOM.md)
- 联邦 Hub：`deploy/federation-hub/README.md`
