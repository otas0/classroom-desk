# Classroom Desk

学校课堂答题（正确率/错误率）、名单积分请求、留言工具。学生端 Electron 小窗；教师端 Web；教师机跑 Express + SQLite。无班级码进入：上课前教师把班级 `classId` 指派到每台学生机，学生在名单点自己的名字。

[![Release](https://img.shields.io/github/v/release/otas0/classroom-desk?display_name=tag&label=release)](https://github.com/otas0/classroom-desk/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/otas0/classroom-desk/ci.yml?branch=main&label=CI)](https://github.com/otas0/classroom-desk/actions/workflows/ci.yml)
[![Nightly](https://img.shields.io/github/actions/workflow/status/otas0/classroom-desk/e2e-nightly.yml?branch=main&label=nightly)](https://github.com/otas0/classroom-desk/actions/workflows/e2e-nightly.yml)

> Badge 以 **Release tag / Actions** 为准。若曾用 Git Data API 推送，本地 commit SHA 可能与 GitHub tip 字面不同——对 **tree SHA** 或 tag（见 [docs/ARTIFACTS.md](docs/ARTIFACTS.md)）。

## 从 GitHub 安装（推荐 · 任意机房 · 无优盘 · 可未签名）

开源自托管：任意教室一台教师机跑 API，学生机装客户端并写入**本教室**的 `apiBase` + `classId`。不绑定固定示范 IP。

**Teacher PC (easiest):** [docs/TEACHER_EASY_SETUP.md](docs/TEACHER_EASY_SETUP.md) · double-click **`Install-Teacher.bat`** · [one-pager](docs/CLASSROOM_DEPLOY_ONEPAGE.md)  
**Full manual (fixed IP / firewall / SmartScreen / acceptance):**  
→ **[docs/SETUP_FROM_GITHUB.md](docs/SETUP_FROM_GITHUB.md)**

| Role | Install |
|---|---|
| Teacher | **Recommended:** `Install-Teacher.bat` / `install-teacher.ps1` (portable Node, no git). Or `git clone` → `npm run start:classroom` |
| Student | [Releases](https://github.com/otas0/classroom-desk/releases) `ClassroomDesk-Setup-*.exe` → Find classroom |
| Release | `git tag vX.Y.Z && git push origin vX.Y.Z` → Actions builds dual-arch Setup |

- 需求：[docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)
- API：[docs/API.md](docs/API.md)
- 合规：[docs/SECURITY.md](docs/SECURITY.md)
- 讲台卡：[docs/PRINT_DESK_CARD.md](docs/PRINT_DESK_CARD.md)
- U 盘打包 / 座位对照表打印筛选（全部·仅空座·仅已排）：[docs/LOCAL_USB_CHECKLIST.md](docs/LOCAL_USB_CHECKLIST.md)·[`prepare-usb-pack.sh`](scripts/prepare-usb-pack.sh)（默认 `--filter all`）

## 当前进度

- [x] 需求、学生端小窗、全量 API、教师后台
- [x] 加分请求 TTL / 过期清理 / 每日 02:00 清空
- [x] 自动签到周历、附件上传、多题型、导出筛选、错误率图
- [x] 开机自启、管理员退出/关自启/系统卸载引导
- [x] schema + confirm/cleanup 集成测试、GitHub Actions CI
- [x] Windows NSIS 打包（`dist:win`，含可配置 `apiBase`）
- [x] 节假日例外、MIME 白名单、学生 CSV 导入、备份脚本、Playwright/CI health

## 环境

- Node.js **22.5+**（内置 `node:sqlite`）
- npm workspaces

```bash
cp .env.example .env
```

### 最小部署（推荐）

```bash
npm install
npm run start:minimal   # 机房
npm run start:campus    # 校园网（门户+Zones；网关三项可选）
```

见 [`docs/MINIMAL_DEPLOY.md`](./docs/MINIMAL_DEPLOY.md) · [`docs/CAMPUS_MINIMAL.md`](./docs/CAMPUS_MINIMAL.md)。禁止对外写 GA/绝密/安全局最高机密。

### 生产部署与 JWT_SECRET（必读）

| 变量 | 生产要求 | 说明 |
|---|---|---|
| `JWT_SECRET` | **必填** | 长随机串；禁止写进源码。未设置时开发模式会生成临时密钥，进程重启后旧 token 失效。 |
| `ADMIN_PASSWORD` | 建议首启设置 | bcrypt 写入 `settings.admin_password_hash`，不明文落库。 |
| `TEACHER_USERNAME` / `TEACHER_PASSWORD` | 建议首启设置 | 首次无教师账号时创建。 |
| `DEFAULT_CLASS_CODE` | 可选 | 首启默认班级码。 |
| `PORT` / `HOST` | 可选 | 默认 `8787` / `0.0.0.0` |
| `CLASSROOM_DESK_DATA_DIR` | 可选 | SQLite 与 uploads 目录 |
| `VITE_API_BASE` | 前端构建时 | 指向学校服务器，如 `http://10.0.0.5:8787` |

生产启动示例：

```bash
export NODE_ENV=production
export JWT_SECRET="$(openssl rand -hex 32)"
export ADMIN_PASSWORD='********'
export TEACHER_PASSWORD='********'
npm run start --workspace=@classroom-desk/server
```

校内部署建议：教师机/教室服务器跑 API；学生端通过局域网访问；反向代理可加 TLS，但勿把密钥提交进 git。

**家长 PDF / 离线部署（硬步骤）：** 第一次生成家长 PDF，或离线部署（教师机不能临时下载字体）之前，必须先执行 `npm run fonts:cjk`，确认 `apps/server/assets/fonts/` 里已有 `NotoSansSC-VF.ttf`（或 `NotoSansSC-Regular.otf`）。字体文件不进 git；未执行时中文家长 PDF 会回退 ASCII。

## 安装与运行

```bash
cd ~/Projects/classroom-desk
npm install

# 一键联调（API + 教师 + 学生；单进程退出会自动重启，不断整链）
npm run dev:stack

# 或分端启动：
# API
JWT_SECRET=dev-secret-change-me \
ADMIN_PASSWORD=AdminPass123 \
TEACHER_PASSWORD=TeacherPass123 \
DEFAULT_CLASS_CODE=DEMO01 \
npm run dev:server

# 教师后台 http://127.0.0.1:5174
npm run dev:teacher

# 学生端
npm run dev:student
```

联调核对：`npm run verify:1plus1`（需 API 已起）；月末边界：`npm run test:month`；U 盘/host 脚本：`npm run verify:usb-host`。

首次启动用环境变量设置教师/管理员密码（见上）；正式课堂 UI **不预填**演示账号。联调口令仅用于本机/e2e。Electron 默认开启；仅 `ELECTRON_OFF=1` 可跳过（残留 `.electron-off` 会被自动删掉）。

## Windows 安装包

在 **Windows** 环境（本仓库 CI `windows-pack` job，或本地 Windows）执行：

```bash
npm run dist:win
```

产物：`apps/student-desktop/release/ClassroomDesk-Setup-*.exe`。

安装包内嵌 `resources/config.json`（`apiBase` + `classId`）。安装后改成教室服务器，例如 `http://192.168.1.50:8787`；也可在学生端「设置」用管理密码保存。无班级码进入。打包态由 Electron 主进程施加生产 CSP。

**代码签名**：仓库 Secrets 配置 `CSC_LINK`（.pfx 路径或 base64）与 `CSC_KEY_PASSWORD`；CI 有密钥则签名，无密钥则未签名包。时间戳：DigiCert RFC3161。Artifact：`classroom-desk-windows-setup` → `apps/student-desktop/release/*.exe`。生产清单见 [docs/DEPLOY.md](docs/DEPLOY.md)。

### 未签名包 SmartScreen

可打印一页纸（含 SHA256 填写栏）：[docs/SMARTSCREEN.md](docs/SMARTSCREEN.md)。  
网盘 `unsigned/` 与 `signed/` 并行留档：[docs/NAS_RELEASES.md](docs/NAS_RELEASES.md)。

**卸载（合规）**：学生端无卸载按钮。管理员密码可打开系统「应用和功能」正常卸载；无防卸载。

**无证书教室互联（教师机跑服务 + 学生机连教师机 IP）：** [docs/CLASSROOM_TEACHER_HOST.md](docs/CLASSROOM_TEACHER_HOST.md)。  
网络 / AP 隔离排查：[docs/NETWORK.md](docs/NETWORK.md)。

### 教师后台生产托管

第一次家长 PDF 或离线部署前，先拉中文字体（硬步骤，见上）：

```bash
npm run fonts:cjk
```

```bash
npm run build:teacher
JWT_SECRET=... npm run start:server
# 浏览器打开 http://服务器:8787/admin/
```

数据库备份（可同步校内 NAS）：

```bash
# 本地
npm run backup:db
# 同步到已挂载的校内网盘
CLASSROOM_DESK_NAS_DIR=/Volumes/SchoolNAS/classroom-desk npm run backup:db
```

## 测试与 CI

```bash
npm run test:server          # schema + confirm/cleanup
npm run typecheck:server
npm run verify:exit-lock-packaged
npm run verify:exit-lock-audit   # 需 API；审计分页 / CSV / 解除码超期
# 需 API + 教师端已启动：
npm run test:e2e
# 口令已在后台改过导致 e2e 401 时（发版联调）：
TEACHER_PASSWORD=TeacherPass123 node scripts/ensure-teacher.mjs
npx playwright test e2e/exit-lock-ws.spec.ts e2e/exit-lock-toast.spec.ts
# API 被杀后教师 Vite 保活（另开终端先 npm run dev:stack -- --no-student）：
npm run smoke:dev-stack-api-restart
```

GitHub Actions（`.github/workflows/ci.yml`）：typecheck、server tests、`/health` smoke、Playwright e2e；push 时 Windows runner 打 NSIS，`REQUIRE_WIN_EXE=1` 无 exe 硬失败，Artifact `classroom-desk-windows-setup` 保留 30 天。

## 结构

```text
apps/server           Express + SQLite API / 清理与自动签到调度
apps/student-desktop  Electron 学生小窗（含 Windows 打包配置）
apps/teacher-web      教师 Vite 后台
packages/shared       共享常量
docs/                 需求 / API / 安全
```
