# UniFi · RADIUS / WPA-Enterprise

1. Settings → Profiles → RADIUS：指向校内 NPS/FreeRADIUS（或 UniFi Identity）。  
2. Wi‑Fi：教工 SSID → WPA2/3-Enterprise + RADIUS；关闭 PSK。  
3. 学生 SSID：Enterprise 或 PSK+门户；VLAN 与教工分离。  
4. 防火墙：学生 VLAN 默认不访问教工网段；`:8787` 仅教室 VLAN。  
5. 登记到 Classroom Desk 设置中的 IdP / SSID / VLAN 字段后，再跑 `docs/ENTERPRISE_8021X.md` 验收表。
