# 教室互联部署（无代码签名 · 教师机当服务器）

**拓扑（仅单教室）：** 一台教师机跑中心服务；本教室多台学生机只装客户端，全部连该教师机局域网 IP。不跨教室部署。  
**不需要：** `CSC_LINK` / 签名证书。未签名安装包按 [SMARTSCREEN.md](./SMARTSCREEN.md) 处理即可。  
**讲台一页纸：** [PRINT_DESK_CARD.md](./PRINT_DESK_CARD.md)  
**U 盘联调勾选：** [LOCAL_USB_CHECKLIST.md](./LOCAL_USB_CHECKLIST.md)

```text
        ┌────────────────────────────┐
        │ 教师机（服务器）              │
        │  Node: 0.0.0.0:8787         │
        │  浏览器: /admin 教师后台      │
        └─────────────▲──────────────┘
                      │ TCP 8787
     ┌────────────────┼────────────────┐
     │                │                │
 学生机A            学生机B          学生机C
 apiBase=http://教师机IP:8787
```

## 一、教师机（只做一次）

### 1. 准备软件

1. 安装 [Node.js 22+](https://nodejs.org/)（勾选加入 PATH）。
2. 把本仓库拷到教师机，例如 `C:\classroom-desk`（U 盘 / 网盘均可）。
3. 管理员 PowerShell：

```powershell
cd C:\classroom-desk
npm install
npm run build:teacher
```

### 2. 放行防火墙 + 查看本机 IP

在**管理员** PowerShell 执行仓库脚本：

```powershell
cd C:\classroom-desk
powershell -ExecutionPolicy Bypass -File .\scripts\windows-teacher-host.ps1
```

脚本会：放行入站 TCP **8787**，并打印本机局域网 IP（记下，例如 `192.168.1.50`）。

建议在路由器给教师机做 **DHCP 地址预留 / 固定 IP**，避免第二天 IP 变了学生全连不上。

### 3. 启动中心服务

新建 `C:\classroom-desk\.env`（可参考 `.env.example`）：

```env
JWT_SECRET=请改成一长串随机字符
TEACHER_PASSWORD=TeacherPass123
ADMIN_PASSWORD=AdminPass123
DEFAULT_CLASS_CODE=DEMO01
HOST=0.0.0.0
PORT=8787
```

`HOST=0.0.0.0` 必须保留，否则学生机连不进来（只监听本机）。

```powershell
cd C:\classroom-desk
npm run start:server
```

保持此窗口开着（或做成开机任务）。本机浏览器打开：

- 健康检查：`http://127.0.0.1:8787/health` → `"ok":true`
- 教师后台：`http://127.0.0.1:8787/admin/`（也可用 `http://本机局域网IP:8787/admin/`）

用教师账号登录，建班 / 发作业。

### 4. 自测「别人能不能连我」

在**另一台**已连同一 Wi‑Fi/网线的电脑浏览器打开：

`http://教师机IP:8787/health`

- 通：可以装学生端。
- 不通：按 [NETWORK.md](./NETWORK.md) 查 **AP 隔离** 与防火墙；教师机「设置 → 一键检测 /health」仅代表本机，学生机要用浏览器再测一次。

## 二、学生机（每台重复）

1. 从教师机共享文件夹 / U 盘拷贝 **未签名** `ClassroomDesk-Setup-*.exe`（CI artifact `classroom-desk-windows-setup`，或教师机本地 `npm run dist:win`）。
2. SmartScreen：更多信息 → 仍要运行（见 SMARTSCREEN.md）。
3. 安装结束后按提示设置服务器地址，或打开应用 → **我的** → 管理密码后填写：

```text
http://教师机IP:8787
```

例如：`http://192.168.1.50:8787`（不要写成 `127.0.0.1`，那是学生自己）。

4. 确认本机 `classId` 已指派（教师后台「指派学生机」下载 config，或学生端「设置」填写）。  
5. 学生在 **积分** 花名册点自己的姓名 → 请求加分 / 答题；教师在 `/admin` 审核加分、查看正确率。

批量改配置：也可在安装后改  
`%APPDATA%\Classroom Desk\...` 用户配置，或重打包前改 `apps/student-desktop/resources/config.json` 里的默认 `apiBase` 再分发（见下）。

### 可选：打包时写死教室 IP

若全班 IP 固定，教师机构建安装包前改：

```json
{ "apiBase": "http://192.168.1.50:8787" }
```

然后在教师机（或 CI）`npm run dist:win`，学生机装完即可连，少一步手改。

## 三、互联检查清单（上课前 2 分钟）

| # | 检查 | 期望 |
|---|---|---|
| 1 | 师生同一 SSID / 网段，非访客 Wi‑Fi | ping 教师机通 |
| 2 | AP 隔离关闭 | 学生浏览器能打开 `/health` |
| 3 | 教师机服务窗口还在跑 | `/health` ok |
| 4 | 防火墙 8787 仍在 | 脚本已建规则 |
| 5 | 学生 `apiBase` = `http://教师IP:8787` | 非 127.0.0.1 |
| 6 | 一名学生交作业，教师审核 | 积分变化 |

## 四、常见失败

| 现象 | 处理 |
|---|---|
| 学生「无法连接服务器」 | 查 apiBase、教师机是否休眠/关进程、防火墙 |
| 只有教师机能打开 /admin | AP 隔离或学生连了访客网 |
| 第二天全班挂了 | 教师机 IP 变了 → 固定 IP 或批量改 apiBase |
| SmartScreen / 杀软拦安装包 | SMARTSCREEN.md；可先装一台样机再镜像 |

## 五、不需要做的事

- 不必申请代码签名证书也能上课（仅安装时多点一次「仍要运行」）。
- 不必每台学生机装 Node / 跑服务器。
- 不要把 8787 映射到公网。
