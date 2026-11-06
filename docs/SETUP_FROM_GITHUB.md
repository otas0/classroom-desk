# 从 GitHub 安装（教师机 + 学生机 · 无 U 盘）

仓库：<https://github.com/otas0/classroom-desk>  
拓扑：教师机跑 API（`:8787`）；学生机只装客户端，全部连教师机局域网 IP。无需代码签名、无需优盘——**克隆仓库 / 下 Release 安装包**即可。

本教室联调身份示例：

| 项 | 值 |
|---|---|
| 教师机 IP | `192.168.31.179`（请按实际固定 IP 修改） |
| API | `http://192.168.31.179:8787` |
| 班级 | 本教室 · `classId=00d6b800-6628-4d20-a49c-9765325d9eef` |
| 教师账号 | `teacher`（密码在设置页自改，勿写进公开 Issue） |

---

## A. 教师机（Windows，一次即可）

### 1. 安装前置

1. 安装 [Node.js 22 LTS](https://nodejs.org/)（勾选加入 PATH）。  
2. 安装 [Git](https://git-scm.com/download/win)。  
3. 管理员 PowerShell：

```powershell
cd C:\
git clone https://github.com/otas0/classroom-desk.git
cd C:\classroom-desk
npm install
npm run build:teacher
```

若仓库为私有：先在浏览器登录 GitHub，再用有权限的账号 `git clone`，或改用 SSH。

### 2. 固定 IP + 防火墙 + 开机自启

```powershell
cd C:\classroom-desk
# 按教室改 IP（默认已是 192.168.31.179）
powershell -ExecutionPolicy Bypass -File .\scripts\windows-set-fixed-ip.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\windows-teacher-host.ps1 -SmokeTest
powershell -ExecutionPolicy Bypass -File .\scripts\windows-autostart-server.ps1 -RepoRoot C:\classroom-desk
```

### 3. 环境变量

复制 `.env.example` → `.env`，至少设置：

```env
JWT_SECRET=请改成一长串随机字符
TEACHER_USERNAME=teacher
TEACHER_PASSWORD=请改成个人密码
ADMIN_PASSWORD=请改成管理密码
HOST=0.0.0.0
PORT=8787
```

### 4. 启动服务

```powershell
cd C:\classroom-desk
npm run start:server
```

本机浏览器打开：

- 教师后台：<http://127.0.0.1:8787/admin/>  
- 健康检查：<http://127.0.0.1:8787/health>（应含 `lanIps` / `suggestedApiBase`）  
- 上课页：<http://127.0.0.1:8787/ready>

### 5. 上课前在后台完成

1. 登录 → 选班「本教室」（或新建正式班）。  
2. 名单：Excel/CSV 导入（可勾选「覆盖导入」，先 `npm run backup:db`）。  
3. 「指派学生机」：记下 `apiBase` + `classId`，或下载 `config.json`。  
4. 「留言」按需关闭（关闭后学生端无留言 Tab）。  
5. 「设置」修改个人登录密码。

备份：`npm run backup:db` → 确认 `/health` 无 `lastError`。

讲台一页纸：[PRINT_DESK_CARD.md](./PRINT_DESK_CARD.md)（手写 IP / classId）。

---

## B. 学生机（Windows）

### 方式 1（推荐）：GitHub Releases 安装包

1. 打开仓库 **Releases**：<https://github.com/otas0/classroom-desk/releases>  
2. 下载最新 `ClassroomDesk-Setup-*.exe`（未签名：SmartScreen → 更多信息 → 仍要运行，见 [SMARTSCREEN.md](./SMARTSCREEN.md)）。  
3. 安装后，把教师发的 `config.json` 放到安装目录的 `resources\config.json`（或与 exe 同级按客户端说明），内容示例：

```json
{
  "apiBase": "http://192.168.31.179:8787",
  "classId": "00d6b800-6628-4d20-a49c-9765325d9eef",
  "comment": "Classroom-specific. Do not use 127.0.0.1."
}
```

**禁止** `127.0.0.1` / `localhost`。

4. 浏览器先打开 `http://教师IP:8787/ready`，通了再启动客户端。  
5. 名单点自己的姓名 → 签到 / 答题 / 加分。

### 方式 2：Actions Artifact

若尚无 Release：仓库 **Actions** → 最新成功 `CI` → `windows-pack` → 下载 `classroom-desk-windows-setup` 里的 exe，步骤同方式 1。

### 方式 3：教师机本机打安装包再分发

在教师机（已 clone）上：

```powershell
cd C:\classroom-desk
node scripts\pack-classroom-config.mjs --apiBase http://192.168.31.179:8787 --classId <本班classId>
npm run dist:win
```

产物在 `apps\student-desktop\release\`。用网盘/内网共享/邮件发 exe + `config.json` 给学生机（exe≈100MB，邮件可能被拒，优先 Release/网盘）。

---

## C. 验收清单

- [ ] 教师机 `/health` 含正确 `lanIps`  
- [ ] 学生浏览器能打开 `/ready`  
- [ ] 学生客户端能出名单并点名  
- [ ] 关留言时学生端无「留言」Tab  
- [ ] 教师能导入名单、发题（含附件）、导出四格式  
- [ ] 讲台卡已贴：IP + classId  

网络不通先查 AP 隔离：[NETWORK.md](./NETWORK.md)。完整教室互联说明：[CLASSROOM_TEACHER_HOST.md](./CLASSROOM_TEACHER_HOST.md)。

---

## D. 更新版本

教师机：

```powershell
cd C:\classroom-desk
git pull
npm install
npm run build:teacher
# 重启服务 / 或注销再登录触发自启任务
```

学生机：重新下载新 Release exe 覆盖安装；`config.json` 一般不用改。
