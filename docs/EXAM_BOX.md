# Exam Box 小盒 SKU

可选硬件/镜像产品线：考场插电即用的「气泡网」，**不改全校核心交换**。与 Classroom Desk 教师主机配对后，本场考试 SSID 仅放行试卷域 + 门户/API。

## 交付物

| 文件 | 用途 |
|---|---|
| [`deploy/exam-box/docker-compose.yml`](../deploy/exam-box/docker-compose.yml) | 开发/试点：openNDS 风格围墙 + 反代到教师主机 |
| [`deploy/exam-box/Dockerfile`](../deploy/exam-box/Dockerfile) | CI 产出镜像并推 GHCR（`.github/workflows/exam-box-image.yml`） |
| [`deploy/opennds/auth_allowlist.sh`](../deploy/opennds/auth_allowlist.sh) | 读 `/api/v1/gateway/allowlist` 授权客户端 |
| [`docs/OPENNDS_BINAUTH.md`](./OPENNDS_BINAUTH.md) | BinAuth 联调一页 |
| 本说明 | 学校采购/刷机步骤 |

GHCR 拉取示例（owner=`otas0`，与本仓库 GitHub 一致）：

```bash
# main 构建带 :latest；版本 tag 推送 :vX.Y.Z
docker pull ghcr.io/otas0/classroom-desk-exam-box:latest
```

### Cosign 验签（keyless）

CI 使用 Sigstore keyless cosign 签名镜像 digest。验证：

已发布 digest（`workflow_dispatch` run [43201798754](https://github.com/otas0/classroom-desk/actions/runs/43201798754)，tag `:latest` / `:sha-e5e8c31ea0d9`）：

`sha256:7264cd6014f8166b2486bfd2de0c35fa4b38c1681675ce5f3c2ab519ddf2e111`

```bash
IMAGE=ghcr.io/otas0/classroom-desk-exam-box
DIGEST=sha256:7264cd6014f8166b2486bfd2de0c35fa4b38c1681675ce5f3c2ab519ddf2e111
# 或：DIGEST=$(crane digest ${IMAGE}:latest)
cosign verify \
  --certificate-identity-regexp='https://github.com/otas0/classroom-desk/.*' \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com \
  ${IMAGE}@${DIGEST}
```

本地未装 `crane` 时也可用短 sha tag：

```bash
cosign verify \
  --certificate-identity-regexp='https://github.com/otas0/classroom-desk/.*' \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com \
  ghcr.io/otas0/classroom-desk-exam-box:sha-e5e8c31ea0d9
```

## 能力旗标

`productCapabilities().examBox = true`（文档与 compose 已交付）。  
`examBoxHardware = true` **仅当** 首台硬件验收登记完成（设置里序列号+镜像 tag+勾选，或 `CLASSROOM_DESK_EXAM_BOX_HARDWARE=1`）。  
量产包：[`deploy/exam-box/BOM.md`](../deploy/exam-box/BOM.md)、[`install-appliance.sh`](../deploy/exam-box/install-appliance.sh)；CI 推 `linux/amd64`+`linux/arm64`。

## 试点装盒（compose · 真机旁路）

**仓库能交付：** GHCR/本地镜像 + compose。  
**仓库不能交付：** 量产刷机镜像、AP/SSID 硬件、`examBoxHardware=true`（见 [`deploy/exam-box/HARDWARE.md`](../deploy/exam-box/HARDWARE.md)）。

在考场旁路小盒 / 迷你 PC / 树莓派（已装 Docker）上：

```bash
# 教师机 API 已监听 :8787，且小盒能访问该 IP
export CD_API_BASE=http://教师机LAN_IP:8787
cd deploy/exam-box
docker compose up -d --build
curl -fsS "$CD_API_BASE/health" >/dev/null
curl -fsS http://127.0.0.1:8080/health   # 经 Exam Box 反代
# 未认证路径应跳转门户
curl -sI http://127.0.0.1:8080/ | grep -i Location
```

| 步 | 操作 | 期望 | □ |
|---|---|---|---|
| 1 | 教师主机跑 Classroom Desk API | `/health` ok | |
| 2 | 小盒 `CD_API_BASE` 指向教师机 | `api-ready` 成功；失败则 compose 不起 | |
| 3 | 学生只连 Exam Box SSID / 有线旁路网 | 默认流量进围墙；`/portal` 可开 | |
| 4 | 教师开「仅试卷上网」 | Shield/DeskDNS/放行表按课生效 | |
| 5 | 下课「结束深锁」 | 门户 session epoch↑；网关放行表清空 | |
| 6 | `npm run verify:exam-box-api-ready` | 故意错误 `CD_API_BASE` 时 api-ready 失败（负向） | |
| 7 | `npm run verify:exam-box-proxy-live` | 教师 API + `:8080` 反代健康；未认证路径跳 `/portal` | |

首批量产硬件验收通过前，产品 UI 保持 **examBoxHardware = 未交付**；勿在应用内假装小盒在线。

## 与真网关的关系

全校已有 OPNsense/UniFi 时优先用 Shield 适配器，不必每间教室买小盒。  
Exam Box 面向「IT 不能改核心网、但要考场强锁」的学校。
