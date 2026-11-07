# 可选：U 盘 / 内网共享落盘清单（任意教室）

> 优盘不是必须。优先用 [SETUP_FROM_GITHUB.md](./SETUP_FROM_GITHUB.md) 从 GitHub Releases 安装。  
> 下列路径仅为**本机落盘示例**，请改成你的教室目录名（不要提交真实 exe 进 git）。

建议目录：`releases/<教师机IP或教室代号>/`（exe 已 gitignore）。

## 原则

- `apiBase=http://<教师机局域网IP>:8787`（写入 settings + 学生 `config.json`）  
- 名单/题目/留言：**禁止预填假名**；空库显示空状态；仅真实导入与真实发题  
- 未签名包：SmartScreen 步骤见 [SMARTSCREEN.md](./SMARTSCREEN.md)

清库重生（改成自己的 IP / 班名）：

```bash
npm run prepare:live -- --apiBase http://192.168.x.x:8787 --className 高一(3)班
```

## 教师机勾选

- [ ] 固定 IP（`windows-set-fixed-ip.ps1`，参数用本教室地址）  
- [ ] 防火墙放行 8787 + 开机自启  
- [ ] `.env` 中 `JWT_SECRET` / 教师密码已自设  
- [ ] `npm run start:server`，`/health` 含正确 `lanIps`  
- [ ] 后台导入真实名单、指派并下载 `config.json`  
- [ ] `npm run backup:db`，`/health` 无 `lastError`

## 学生机勾选

- [ ] 浏览器：`http://<教师机IP>:8787/ready` 通过  
- [ ] 安装 Release exe + 本班 `config.json`  
- [ ] 点名「确认是我」后可答题  

## C2. 锁退出（须 Windows 真机）

详见 [EXIT_LOCK_MDM.md](./EXIT_LOCK_MDM.md)（C2 证据表 + Assigned Access 真实 NSIS 路径 + Intune XML [`intune-student-kiosk.example.xml`](./intune-student-kiosk.example.xml)）。  
静态检查（CI / `dist:win`）：`npm run verify:exit-lock-packaged`（`REQUIRE_WIN_EXE=1` 无 exe 硬失败；Artifact 保留 30 天）。

- [ ] 标题栏「已锁定」（讲述人录音）；关窗 / Alt+F4 无效 — 证据归档  
- [ ] 教师批量解除二次确认后，学生秒级「可退出 m:ss」并可关  
- [ ] 重新锁定后无法关闭  
- [ ] 解除码可退；错码限流；审计含 `code_rotated`；CSV 与当前页一致；超期横幅  
- [ ] Assigned Access 路径 `C:\Program Files\Classroom Desk\Classroom Desk.exe` + 任务管理器负向手测  
- [ ] （可选）试验组 Intune HideTaskManager 生效 

网络不通先查 [NETWORK.md](./NETWORK.md)。
