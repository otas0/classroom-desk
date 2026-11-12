# Exam Box 量产硬件镜像（脚手架）

`examBoxHardware` 产品旗标在软件侧仍为 **未交付**。本文件是刷机/验收清单脚手架，供采购与 IT 联调，不伪造「已量产」状态。

## 目标形态

- 旁路小盒：Caddy + 本仓库 Exam Box compose（见同目录 `docker-compose.yml`）
- 上电后健康检查：`npm run verify:exam-box-api-ready`（或镜像内等价脚本）
- 指向教师机：`CD_API_BASE=http://教师IP:8787`

## 刷机草案（操作员填写）

| 项 | 值 |
|----|-----|
| 硬件 SKU / 序列号 | |
| 镜像 tag（GHCR） | |
| 烧录工具 / 日期 | |
| `CD_API_BASE` | |
| `/health` 通过 | □ |
| openNDS / 门户跳转 | □ |
| 回滚镜像 tag | |

## 与软件关系

- 文档 compose：已交付（`examBox: true`）
- 量产刷机包：本脚手架 + CI `exam-box-image.yml`；旗标 `examBoxHardware` 待首批硬件验收后改 true
