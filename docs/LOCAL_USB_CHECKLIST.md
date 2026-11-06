# 纯本地部署 · U 盘联调检查表（无签名）

单教室：1 教师机 + 多学生机。不跨教室、不接公网、不做代码签名。  
讲台打印：[PRINT_DESK_CARD.md](./PRINT_DESK_CARD.md) · 教室身份：[CLASSROOM_IDENTITY.example.md](./CLASSROOM_IDENTITY.example.md)

本机 API 自动化：`node scripts/local-1plus1-verify.mjs http://127.0.0.1:8787`（结果在 `artifacts/exports-verify/`）。

## A. CI 绿 → U 盘

- [ ] GitHub Actions `CI` 全绿（含 `windows-pack`）— 参考 [42169438255](https://github.com/otas0/classroom-desk/actions/runs/42169438255)
- [ ] 下载 artifact `classroom-desk-windows-setup` → 拷 U 盘（勿用过期本地旧 exe）
- [ ] 核对 `.sha256`（可选）
- [ ] U 盘另拷：仓库脚本、`PRINT_DESK_CARD.md`、本检查表、身份表

## B. 教师机（固定 IP + 自启）— 须在 Windows 教师机完成

- [ ] 路由器 DHCP 预留 / 本机静态 IP（写入身份表）
- [ ] 管理员执行 `scripts/windows-teacher-host.ps1`（放行 8787、打印 IP）
- [ ] `.env`：`HOST=0.0.0.0`、`PORT=8787`、强 `JWT_SECRET`
- [ ] `npm run build:teacher` 后 `scripts/windows-autostart-server.ps1` 开机自启 API
- [x] 本机/联调机 `/health` → `"ok":true`（API 已验）
- [x] `npm run backup:db` → `/health` 的 `backup.lastError` 为空（API 已验）

## C. 上课前强制 /health（学生浏览器）— 须在学生机完成

任选一台学生机浏览器（**禁止**只测教师本机）：

`http://教师IP:8787/health`

- [ ] 返回 JSON 且 `"ok":true`
- [ ] 不通：关 AP/访客隔离、重跑防火墙脚本、确认同一网段

学生端客户端启动也会拦在 /health。

## D. 学生机时间同步

- [ ] Windows「自动设置时间」开启，与教师机时差 &lt; 1 分钟
- [ ] 联调前口头核对双方时钟（迟到判定依赖本地时刻）
- [x] 设置页迟到阈值可写：上课开始 `08:00` + `15` 分钟；签到返回 `lateAfterMinutes`（API 已验；下午会记 `late` 属预期）

## E. 本教室包 + 镜像

```powershell
node scripts/pack-classroom-config.mjs --apiBase http://教师IP:8787 --classId <本班id>
```

- [x] `pack-classroom-config` 已能写出 `apps/student-desktop/resources/config.json`（示例 IP `192.168.1.50`，部署时改成真实教师 IP）
- [ ] 样机安装实测通过
- [ ] 系统镜像刷其余学生机

## F. 1 教师机 + 1 学生机联调

API 层（本机 `local-1plus1-verify`，41/41）：

- [x] 指派 / 确认 `classId`（默认班 `00d6b800-6628-4d20-a49c-9765325d9eef`）
- [x] 点名加分（学生请求 + 教师确认）
- [x] 学生签到 + 迟到阈值（作息配置）
- [x] 发题 → 作答 → 正确率约 100%
- [x] 「留言」关闭 → `settings/public.messagesEnabled=false`（学生端应无留言 Tab）
- [x] 导出四种格式各一份（签到/月汇总/加分/题目 × csv/xlsx/json/tsv）→ `artifacts/exports-verify/`
- [x] 坏表/空表导入 → 中文失败提示
- [x] 题目「编辑原题」加载原选项并保存
- [x] 跨月出勤：本月有场次、上月 0（本地自然月）

真机 UI 仍须勾选：

- [ ] Electron 学生端关留言后界面无「留言」Tab
- [ ] 教师 Web 设置页改作息后肉眼确认签到状态
- [ ] 导出文件人工打开核对列名与人数

## G. 讲台

- [ ] 打印 [PRINT_DESK_CARD.md](./PRINT_DESK_CARD.md) 一页纸，塑封放讲台
- [ ] 身份表写明本教室 IP / classId（禁 127.0.0.1）

## 未做 / 不做

- 代码签名（`CSC_*`）、SmartScreen 企业白名单、跨教室 / NAS（可选以后再加）
