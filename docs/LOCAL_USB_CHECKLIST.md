# 纯本地部署 · U 盘联调检查表（无签名）

本教室联调身份见 [CLASSROOM_IDENTITY.example.md](./CLASSROOM_IDENTITY.example.md)。  
U 盘目录示例：`releases/192.168.31.179/`（exe 已 gitignore，本机生成）。

## 已在本机备好（可连学生机）

- 班级：**本教室** · `classId=00d6b800-6628-4d20-a49c-9765325d9eef`
- `apiBase=http://192.168.31.179:8787`（已写入 settings + student `config.json`）
- 花名册/题目/留言：禁止预填假名；空库显示空状态；仅真实导入与真实发题
- 留言默认关；签到记为到课（无学校作息迟到配置）
- 教师请在设置里改成个人密码
- `releases/**` 二进制不入库；只提交 `releases/README.md`

清库重生：`npm run prepare:live -- --apiBase http://192.168.31.179:8787 --className 本教室`

## A. U 盘

- [ ] Actions 下最新 `classroom-desk-windows-setup`（或用 `releases/<IP>/` 已有 exe）
- [ ] 同目录：`config.json`、`PRINT_DESK_CARD.md`、身份 JSON、花名册模板

## B. 教师机 Windows

- [ ] 固定 IP：`windows-set-fixed-ip.ps1`（默认 192.168.31.179）
- [ ] `windows-teacher-host.ps1` + `windows-autostart-server.ps1`
- [ ] 重启服务加载最新 API 后：`/health` 含 `suggestedApiBase` / `lanIps`
- [ ] `npm run backup:db` → `lastError` 空

## C. 学生机

- [ ] 浏览器：`http://192.168.31.179:8787/health` 或 `/ready`
- [ ] 时钟与教师机一致
- [ ] 安装 exe 或写入 `config.json`（禁止 127.0.0.1）
- [ ] 花名册点自己的名；关留言时无「留言」Tab

## D. 课堂核对

- [ ] 导出四格式人工对列
- [ ] 正式班 Excel 覆盖导入（教师端勾选「覆盖导入」；先 `backup:db`；模板见 `releases/.../ops-verify/正式班-花名册.xlsx`）
- [ ] 损坏 `.xlsx` → 中文「文件损坏…」（需新版 server）
- [ ] 月末/月初出勤边界
- [ ] 打印讲台卡并手写 IP/classId
