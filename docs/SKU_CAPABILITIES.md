# 销售一页纸：能力旗标 ↔ SKU

可打印 HTML（浏览器「另存为 PDF」）：[`SKU_CAPABILITIES.html`](./SKU_CAPABILITIES.html)  
生成：`npm run generate:sku-html`（勿手改 HTML，改本 MD 后重跑）。

| 能力旗标 (`productCapabilities`) | SKU / 交付物 | 学校侧前置 |
|---|---|---|
| `labAgent` | 机房桌面端（Electron） | Windows 机房；可选 Assigned Access |
| `deepLock` | 深锁控制台（冻结 / 仅试卷 / 下课） | 教师 Web |
| `networkZones` | 自定义网络配置档（SSID/CIDR） | 多 SSID 或分网段 |
| `netPortal` | 零安装 Captive Portal `/portal` | 网关跳转 + 花名册 |
| `portalSignedSsid` / `portalSsidRequireSig` | 网关 HMAC 注入 SSID | `sign-ssid` 或 openNDS FAS |
| `gatewayAllowlist` | admit 后 IP 放行表 | OPNsense / openNDS / UniFi |
| `netShield` + `opnsense` / `unifi` | Shield 适配器 | 防火墙/控制器 API |
| `netDns` / `netDnsRunning` | DeskDNS（单网只改 DNS） | DHCP 指向教师机；可绑 53 |
| `neverStudentNetBlock` | 从未学生网 → 教工网拦截 | 区配置 `studentUnauthorized` |
| `privateDevicePortalOnly` | 私人设备默认走门户 | 开通默认开；lab-agent 例外 |
| `examBox` | Exam Box 文档 + compose 镜像 | 考场旁路小盒 |
| `examBoxHardware` | 量产装盒（BOM + 镜像 + 验收登记后亮起） | 采购硬件 + HARDWARE.md 验收 |
| `enterprise8021x` | 802.1X 白皮书 + `deploy/radius/` 模板 + IT 登记字段 | 学校 RADIUS / IdP |
| `principalDashboard` | 校长只读能力/在线看板 | 教师或管理员账号 |
| `deviceFingerprinting` | **始终 false**（不做隐蔽指纹） | — |

## 打包建议

1. **机房包**：labAgent + deepLock  
2. **校园网包**：netPortal + networkZones + gatewayAllowlist + Shield  
3. **单网校包**：DeskDNS（+ 可选门户）  
4. **考场包**：Exam Box compose / 后续硬件  
5. **企业包**：802.1X 白皮书 + 强制签名 SSID  

旗标驱动教师 UI 灰显未交付项（如 `examBoxHardware`、未启 `netDnsRunning`）。
