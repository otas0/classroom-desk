# 学校 RADIUS / 802.1X 交接包

Classroom Desk **不运行 RADIUS**。本目录是给学校 IT 的 **可改模板**，对接现有 IdP 后，再在教师设置登记 VLAN/SSID。

| 文件 | 用途 |
|---|---|
| [`freeradius/clients.conf.example`](./freeradius/clients.conf.example) | AP/交换机 NAS 客户端 |
| [`freeradius/users.example`](./freeradius/users.example) | 教工/学生组 → VLAN 属性示意 |
| [`nps-checklist.md`](./nps-checklist.md) | Windows NPS 勾选表 |
| [`unifi-radius.md`](./unifi-radius.md) | UniFi 企业 Wi‑Fi 要点 |
| 产品文档 | [`docs/ENTERPRISE_8021X.md`](../../docs/ENTERPRISE_8021X.md) |

验收仍以学校真网为准；应用内不会出现「RADIUS 已认证」假状态。
