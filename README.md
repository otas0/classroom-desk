# Classroom Desk

学校课堂答题（正确率/错误率）、花名册积分请求、留言工具。学生端 Electron 小窗；教师端 Web；教师机跑 Express + SQLite。无班级码进入：上课前教师把班级 `classId` 指派到每台学生机，学生在花名册点自己的名字。

- 需求：[docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)
- API：[docs/API.md](docs/API.md)
- 合规：[docs/SECURITY.md](docs/SECURITY.md)

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

## 安装与运行

```bash
cd ~/Projects/classroom-desk
npm install

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

演示账号：`teacher` / `TeacherPass123`，班级码 `DEMO01`，管理员 `AdminPass123`。

## Windows 安装包

在 **Windows** 环境（本仓库 CI `windows-pack` job，或本地 Windows）执行：

```bash
npm run dist:win
```

产物：`apps/student-desktop/release/ClassroomDesk-Setup-*.exe`。

安装包内嵌 `resources/config.json`（`apiBase`）。安装后改成教室服务器，例如 `http://192.168.1.50:8787`；也可在学生端「我的」用管理密码保存。打包态由 Electron 主进程施加生产 CSP。

**代码签名**：仓库 Secrets 配置 `CSC_LINK`（.pfx 路径或 base64）与 `CSC_KEY_PASSWORD`；CI 有密钥则签名，无密钥则未签名包。时间戳：DigiCert RFC3161。Artifact：`classroom-desk-windows-setup` → `apps/student-desktop/release/*.exe`。生产清单见 [docs/DEPLOY.md](docs/DEPLOY.md)。

### 未签名包 SmartScreen

可打印一页纸（含 SHA256 填写栏）：[docs/SMARTSCREEN.md](docs/SMARTSCREEN.md)。  
网盘 `unsigned/` 与 `signed/` 并行留档：[docs/NAS_RELEASES.md](docs/NAS_RELEASES.md)。

**卸载（合规）**：学生端无卸载按钮。管理员密码可打开系统「应用和功能」正常卸载；无防卸载。

**无证书教室互联（教师机跑服务 + 学生机连教师机 IP）：** [docs/CLASSROOM_TEACHER_HOST.md](docs/CLASSROOM_TEACHER_HOST.md)。  
网络 / AP 隔离排查：[docs/NETWORK.md](docs/NETWORK.md)。

### 教师后台生产托管

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
# 需 API + 教师端已启动：
npm run test:e2e
```

GitHub Actions（`.github/workflows/ci.yml`）：typecheck、server tests、`/health` smoke、Playwright e2e；push 时 Windows runner 尝试打 NSIS。

## 结构

```text
apps/server           Express + SQLite API / 清理与自动签到调度
apps/student-desktop  Electron 学生小窗（含 Windows 打包配置）
apps/teacher-web      教师 Vite 后台
packages/shared       共享常量
docs/                 需求 / API / 安全
```
