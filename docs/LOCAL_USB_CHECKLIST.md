# 纯本地部署 · U 盘联调检查表（无签名）

单教室：1 教师机 + 多学生机。不接公网、不做代码签名。讲台打印见 [PRINT_DESK_CARD.md](./PRINT_DESK_CARD.md)。

## A. CI 绿 → U 盘

- [ ] GitHub Actions `CI` 全绿（含 `windows-pack`）
- [ ] 下载 artifact `classroom-desk-windows-setup` → 拷 U 盘
- [ ] 核对 `.sha256`（可选）
- [ ] U 盘另拷：仓库或教师机脚本、`docs/PRINT_DESK_CARD.md`、本检查表

## B. 教师机（固定 IP + 自启）

- [ ] 路由器 DHCP 预留 / 本机静态 IP（记下，如 `192.168.1.50`）
- [ ] 管理员执行 `scripts/windows-teacher-host.ps1`（放行 8787、打印 IP）
- [ ] `.env`：`HOST=0.0.0.0`、`PORT=8787`、强 `JWT_SECRET`
- [ ] `npm run build:teacher` 后 `scripts/windows-autostart-server.ps1` 开机自启 API
- [ ] 本机浏览器 `http://127.0.0.1:8787/health` → `"ok":true`
- [ ] `npm run backup:db` → `/health` 的 `backup.lastError` 为空

## C. 上课前强制 /health（学生浏览器）

任选一台学生机浏览器打开（**禁止**只测教师本机）：

`http://教师IP:8787/health`

- [ ] 返回 JSON 且 `"ok":true`
- [ ] 不通：关 AP/访客隔离、重跑防火墙脚本、确认同一网段

学生端客户端启动也会拦在 /health；通过后才进花名册。

## D. 学生机时间同步

- [ ] Windows「自动设置时间」开启，与教师机时差 &lt; 1 分钟
- [ ] 联调前口头核对双方时钟（迟到判定依赖本地时刻）

## E. 本教室包 + 镜像

```powershell
node scripts/pack-classroom-config.mjs --apiBase http://教师IP:8787 --classId <本班id>
# 再打 NSIS 或使用 CI 包 + 教师后台「指派学生机」写 config
```

- [ ] 样机安装实测通过
- [ ] 系统镜像刷其余学生机（config 已含 apiBase/classId）

## F. 1 教师机 + 1 学生机联调

- [ ] 教师后台指派 / 确认学生机 `classId`
- [ ] 花名册点名 → 自定义理由加分通过
- [ ] 学生签到成功；迟到阈值已按作息在「设置」配置
- [ ] 发题 → 学生作答 → 教师看正确率/错误率
- [ ] 「留言」关闭 → 学生端无「留言」Tab
- [ ] 导出四种格式各一份：csv / xlsx / json / tsv（签到明细、月出勤汇总、加分、题目至少各测一种）
- [ ] Excel 全班导入压测：故意坏文件/空表 → 界面出现**中文**失败提示

## G. 讲台

- [ ] 打印 [PRINT_DESK_CARD.md](./PRINT_DESK_CARD.md) 一页纸，塑封放讲台

## 未做 / 不做

- 代码签名（`CSC_*`）、SmartScreen 企业白名单、跨教室 / NAS（可选以后再加）
