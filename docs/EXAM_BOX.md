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

```bash
IMAGE=ghcr.io/otas0/classroom-desk-exam-box
# 首次 main/exam-box-image 发布后：
#   crane digest ghcr.io/otas0/classroom-desk-exam-box:latest
# 把输出贴回本段（当前仓库尚未拉到公开 digest 时保留命令即可）
DIGEST=$(crane digest ${IMAGE}:latest)
echo "crane digest → $DIGEST"
cosign verify \
  --certificate-identity-regexp='https://github.com/otas0/classroom-desk/.*' \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com \
  ${IMAGE}@${DIGEST}
```

本地未装 `crane` 时可用：

```bash
cosign verify \
  --certificate-identity-regexp='https://github.com/otas0/classroom-desk/.*' \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com \
  ghcr.io/otas0/classroom-desk-exam-box:sha-<12字短 sha>
```

## 能力旗标

`productCapabilities().examBox = true`（文档与 compose 已交付）。  
`examBoxHardware = false` 直到量产镜像签名发布。

## 试点步骤

1. 教师主机正常跑 Classroom Desk API。  
2. 小盒/树莓派安装 compose，环境变量 `CD_API_BASE=http://教师机:8787`。  
3. 考场学生只连 Exam Box SSID。  
4. 教师开「仅试卷上网」；Shield/DeskDNS 按课策略生效。  
5. 下课「结束深锁」→ 门户会话 epoch 递增 + 网关放行表清空。

## 与真网关的关系

全校已有 OPNsense/UniFi 时优先用 Shield 适配器，不必每间教室买小盒。  
Exam Box 面向「IT 不能改核心网、但要考场强锁」的学校。
