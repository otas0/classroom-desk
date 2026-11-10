# 从 GitHub 安装（任意教室 · 无签名 · 无优盘）

> **先看这个：** [教室部署（只要三步）](./CLASSROOM_DEPLOY_ONEPAGE.md) — `npm run start:classroom` 即可。下面是例外场景细项，**默认不要读完**。

仓库：<https://github.com/otas0/classroom-desk>

本项目是**开源、可自托管**的课堂工具：任意学校机房只要有一台「教师机/教室服务器」跑 API，学生机装未签名客户端并写入本教室的 `apiBase` + `classId` 即可。  
**不绑定**某一固定 IP 或某一班级；下文中的地址一律改成你自己的局域网配置。

## 拓扑

```
学生机 × N  ──局域网──►  教师机（Express :8787 + SQLite + /admin）
```

| 角色 | 做什么 |
|------|--------|
| 教师机 | `git clone` → `npm install` → **`npm run start:classroom`** → 浏览器开 `/admin/`（字体/构建已含） |
| 学生机 | 下载 `ClassroomDesk-Setup-*.exe` → 扫码指派（或手填 `apiBase` + `classId`） |

未签名安装包：Windows SmartScreen →「更多信息」→「仍要运行」。说明见 [SMARTSCREEN.md](./SMARTSCREEN.md)。

### 合规（强制勾选）

部署退出锁定 / Assigned Access 前：

- [ ] **须学校 IT 知情**：已告知机房或信息中心本方案为合法课堂 kiosk（解除码 + 批量解锁 + 可选 Assigned Access），无隐蔽监控；文档见 [EXIT_LOCK_MDM.md](./EXIT_LOCK_MDM.md)、[STUDENT_LOCK_HARDENING_PLAN.md](./STUDENT_LOCK_HARDENING_PLAN.md)。  
- [ ] **物理输入锁须告知学生**：正式使用键鼠/语音/相机锁或考试模式前，已向学生说明（见 [EXIT_LOCK_MDM.md](./EXIT_LOCK_MDM.md)「物理输入锁」）。

未勾选不得在正式机房开启退出锁定 / 物理输入锁。

---

## 你需要准备的本班参数

部署前在教师机记下（或打印讲台卡 [PRINT_DESK_CARD.md](./PRINT_DESK_CARD.md)）：

| 参数 | 含义 | 示例（请替换） |
|------|------|----------------|
| 教师机局域网 IP | 学生机能 ping 通的地址 | `192.168.1.50` |
| `apiBase` | `http://<教师机IP>:8787` | `http://192.168.1.50:8787` |
| `classId` | 教师后台「指派学生机」复制 | UUID，登录后台后可见 |
| 教师账号 | 首启用环境变量创建 | 默认用户名常为 `teacher`，**密码自设** |

禁止在学生机使用 `127.0.0.1` / `localhost`（那是学生本机，连不上教师机服务）。

---

## A. 教师机（Windows 推荐；macOS/Linux 亦可跑服务）

### 1. 前置

1. [Node.js 22.5+](https://nodejs.org/)（勾选加入 PATH）  
2. [Git](https://git-scm.com/)  
3. 管理员终端：

```powershell
cd C:\
git clone https://github.com/otas0/classroom-desk.git
cd C:\classroom-desk
npm install
npm run fonts:cjk
npm run build:teacher
```

**硬步骤：** `npm run fonts:cjk` 必须在第一次家长 PDF 或离线部署之前执行，让 `NotoSansSC-VF.ttf`（或 `NotoSansSC-Regular.otf`）落到 `apps/server/assets/fonts/`。字体不进 git；跳过则中文家长 PDF 回退 ASCII，离线机房也无法临时下载。

macOS / Linux 同样：`git clone` → `npm install` → `npm run fonts:cjk` → `npm run build:teacher`。

### 2. 环境变量

复制 `.env.example` → `.env`（勿提交到 git）：

```env
JWT_SECRET=请改成足够长的随机串
TEACHER_USERNAME=teacher
TEACHER_PASSWORD=请改成个人强密码
ADMIN_PASSWORD=请改成管理强密码
HOST=0.0.0.0
PORT=8787
# 可选：数据目录
# CLASSROOM_DESK_DATA_DIR=C:\classroom-desk-data
```

首启用环境变量写入教师/管理员哈希；正式课堂 **UI 不预填**演示口令。登录后请在「设置」再改一次个人密码。

本地联调 / Playwright 若因「口令已在后台改过」出现 401，可重置哈希后再测（勿用于生产教室）：

```bash
TEACHER_PASSWORD=TeacherPass123 node scripts/ensure-teacher.mjs
```

### 3. 固定 IP · 防火墙 · 开机自启（Windows）

按本教室网段改脚本参数（不要照抄别人教室的 IP）：

```powershell
cd C:\classroom-desk
powershell -ExecutionPolicy Bypass -File .\scripts\windows-set-fixed-ip.ps1 -IpAddress 192.168.1.50
powershell -ExecutionPolicy Bypass -File .\scripts\windows-teacher-host.ps1 -SmokeTest
powershell -ExecutionPolicy Bypass -File .\scripts\windows-autostart-server.ps1 -RepoRoot C:\classroom-desk
```

放行 TCP `8787` 入站。若学生连不上，先查访客 Wi‑Fi / AP 隔离：[NETWORK.md](./NETWORK.md)。

### 4. 启动

```powershell
cd C:\classroom-desk
npm run start:server
```

本机浏览器：

- 教师后台：<http://127.0.0.1:8787/admin/>  
- 健康 JSON：<http://127.0.0.1:8787/health>（应含 `lanIps`、`suggestedApiBase`）  
- 上课前检测页：<http://127.0.0.1:8787/ready>  

局域网验收用：`http://<教师机IP>:8787/ready`。

### 5. 开课前在后台完成

1. 登录 → 若提示改密，先改个人密码。  
2. 默认进入「上课」；若无班/无名单/未指派，按顶部**开课清单**三步走。  
3. 「备课 → 名单」：Excel/CSV 导入（支持常见表头与分隔，不必是英文逗号）；可覆盖导入前先 `npm run backup:db`。  
4. 「指派学生机」：保存教室 `apiBase`、复制/下载 `config.json`、可扫 QR。  
5. 「备课 → 设置」：留言开关、备份提示等。  

备份：`npm run backup:db`；服务也会按日自动备份到数据目录下 `backups/`（保留约 N 份）。确认 `/health` 无 `backup.lastError`。

教室互联补充：[CLASSROOM_TEACHER_HOST.md](./CLASSROOM_TEACHER_HOST.md)。

---

## B. 学生机（Windows）

### 方式 1（推荐）：GitHub Releases

1. 打开 [Releases](https://github.com/otas0/classroom-desk/releases)  
2. 下载最新 `ClassroomDesk-Setup-*.exe`（可核对同页 `.sha256`）  
3. 下载同页 `config.example.json`，改名为 `config.json`，填入**本教室**值：

```json
{
  "apiBase": "http://<教师机局域网IP>:8787",
  "classId": "<本班-classId>",
  "comment": "Per-classroom. Never use 127.0.0.1."
}
```

4. **推荐：** 安装后打开客户端，按 **首次配置** 向导填写服务器地址与机位班级（写入用户目录 `config.json`）并自动校验 `/health`。也可手动改 `config.example.json` → `config.json` 放到安装目录（常见 `resources\config.json`）。未签名拦截见 [SMARTSCREEN.md](./SMARTSCREEN.md)（含组策略放行）。  
5. 浏览器先打开 `http://<教师机IP>:8787/ready`，通过后再启动 Classroom Desk。  
6. 点自己的姓名 →「确认是我」→ 签到 / 答题 / 积分。

### 方式 2：Actions Artifact

尚无 Release 时：仓库 **Actions** → 成功的 `CI` → `windows-pack` → 下载 `classroom-desk-windows-setup` 内 exe，配置同上。

### 方式 3：教师机本机打包再分发

```powershell
cd C:\classroom-desk
node scripts\pack-classroom-config.mjs --apiBase http://<教师机IP>:8787 --classId <本班classId>
npm run dist:win
```

产物在 `apps\student-desktop\release\`。用网盘/内网共享分发（exe 约百兆，邮件易被拒）。

**代码签名**：可选。仓库 Secrets 配置 `CSC_LINK` + `CSC_KEY_PASSWORD` 则 CI 签名；未配置则发**未签名**包，教室仍可按 SmartScreen 步骤安装。

---

## C. 验收清单（任意机房）

- [ ] 已执行 `npm run fonts:cjk`，`apps/server/assets/fonts/` 内有 NotoSansSC（第一次家长 PDF / 离线部署之前）  
- [ ] `/health` 的 `lanIps` 含学生机能访问的教师机 IP  
- [ ] 学生浏览器能打开 `/ready`  
- [ ] 学生客户端名单来自真实导入，无预填假名  
- [ ] 点名确认后可答题；关留言时无「留言」Tab  
- [ ] 教师能导入名单、发题（可选正确项）、收卷、导出  
- [ ] 讲台卡已写：IP + classId（非仓库里别人的示例）

---

## D. 更新

教师机：

```powershell
cd C:\classroom-desk
git pull
npm install
npm run fonts:cjk
npm run build:teacher
# 重启服务或注销再登录以触发自启任务
```

学生机：下载新 Release 覆盖安装；`config.json` 一般不用改。

---

## E. 与「某一间示范教室」文档的关系

仓库内可能仍有 `CLASSROOM_IDENTITY.example.md`、U 盘清单等**示例**路径/IP，仅供对照写法。开源部署时请：

1. 复制示例 → 改成自己的 IP / classId；  
2. **不要**把真实班级密码、完整花名册提交进公开仓库；  
3. Issue / PR 截图打码学号与人脸。

数据与合规原则见 [SECURITY.md](./SECURITY.md)、[DEPLOY.md](./DEPLOY.md)。
