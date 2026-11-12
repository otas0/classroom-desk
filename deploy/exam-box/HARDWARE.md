# Exam Box 量产硬件

## 交付物（本仓）

| 项 | 路径 |
|---|---|
| BOM 采购表 | [`BOM.md`](./BOM.md) |
| 装盒脚本 | [`install-appliance.sh`](./install-appliance.sh) |
| 环境变量模板 | [`.env.example`](./.env.example) |
| Compose / 镜像 | `docker-compose.yml` + CI `exam-box-image.yml`（`linux/amd64` + `linux/arm64`） |
| 试点说明 | [`docs/EXAM_BOX.md`](../../docs/EXAM_BOX.md) |

## 旗标何时为 true

`examBoxHardware` **默认 false**。满足其一后为 true（真实验收，非演示预填）：

1. 教师设置填写 **序列号 + 镜像 tag**，并勾选「首台硬件验收已通过」；或  
2. 教师主机环境变量 `CLASSROOM_DESK_EXAM_BOX_HARDWARE=1`

禁止空序列号勾选验收（API 返回 `exam_box_accept_incomplete`）。

## 装盒步骤

```bash
cd deploy/exam-box
cp .env.example .env   # 改 CD_API_BASE=http://教师机LAN:8787
chmod +x install-appliance.sh
./install-appliance.sh
```

| 步 | 期望 | □ |
|---|---|---|
| 1 | `CD_API_BASE/health` 通 | |
| 2 | `:8080/health` 经小盒反代通 | |
| 3 | 未认证路径 302 → `/portal` | |
| 4 | 填写序列号 / GHCR tag 到教师设置并勾选验收 | |

## 刷机登记（操作员）

| 项 | 值 |
|----|-----|
| 硬件 SKU / 序列号 | |
| 镜像 tag（GHCR） | |
| 烧录 / 装盒日期 | |
| `CD_API_BASE` | |
| 回滚镜像 tag | |
