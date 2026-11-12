# Exam Box 量产 BOM（采购）

旁路小盒：**不改核心交换**。下列为可采购参考；学校可替换同规格件。

## 推荐 SKU A · 树莓派 5（考场桌面旁路）

| 件 | 规格 | 数量 |
|---|---|---|
| 计算板 | Raspberry Pi 5 8GB | 1 |
| 存储 | microSD 64GB A2 或 NVMe 2242 ≥64GB | 1 |
| 电源 | 27W USB-C PD 官方/兼容 | 1 |
| 外壳 | 被动散热金属壳 | 1 |
| 有线网 | 板载 GbE → 考场交换机旁路口 | 1 |
| 可选 Wi‑Fi AP | 外接 USB/独立 AP，SSID 仅本考场 | 0–1 |

镜像：`ghcr.io/<owner>/classroom-desk-exam-box`（`linux/arm64`）。

## 推荐 SKU B · x86 迷你 PC（机房批量）

| 件 | 规格 | 数量 |
|---|---|---|
| 主机 | N100/N305 等 fanless，≥8GB RAM，≥64GB eMMC/SSD | 1 |
| 网口 | ≥1× GbE（双口更佳：上联教师 VLAN + 下联考场） | 1 |
| 电源 | 随机 12V/19V 适配器 | 1 |

镜像：同仓库，平台 `linux/amd64`。

## 装机后必填

见 [HARDWARE.md](./HARDWARE.md)：序列号、GHCR tag、`CD_API_BASE`、验收勾选。  
验收通过后在教师设置登记，或设 `CLASSROOM_DESK_EXAM_BOX_HARDWARE=1`（见 HARDWARE.md）。
