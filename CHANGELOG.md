# Classroom Desk 更新日志

## Unreleased

- 助教 grants e2e：跨班导出 403、有 grant 加分 201
- 抢答 WS：`?token=` JWT + teacher/admin/assistant 角色校验
- 座位：同班学生唯一索引；绑座冲突提示（一人一座）
- OCR 草稿 `sessionStorage` 打通 Packs → 上课快发题
- 家长 PDF：嵌入开源 Noto Sans SC 子集（失败回退 ASCII）
- 恢复向导：六位二次确认码 + 审计 `backup.restore_commit`
- 升级包：删除 / 校验 sha256 / 保留最新 N 份 Setup.exe
- 离线队列：条数与体积上限，淘汰最旧
- 调度 `fleet.drift_snapshot`（约 5 分钟）充实漂移趋势
- 投影色盲预设：Okabe–Ito / 蓝橙 / 灰阶
- purge：先 dry-run 预览再确认执行

## v0.1.7 — 2026-11-07

退出锁定运维与验收 hardening：

- 教师审计：`code_rotated` 中文标签；CSV「导出当前页 / 导出全部」（>500 条截断确认）
- 登录/侧栏解除码超期横幅「去设置更换」深链；助教只读审计、隐藏轮换操作
- API `/health` 恢复轻提示；轮询间隔 `VITE_HEALTH_POLL_MS` / `localStorage.cd_health_poll_ms`
- Playwright：`exit-lock-toast` / `exit-lock-ws` / `exit-lock-rotation-banner`
- CI：`verify:exit-lock-audit`；e2e 拉起 `ELECTRON_OFF=1` 学生 Vite；修 `auditRetry` 空库 migrate
- 联调口令漂移：`TEACHER_PASSWORD=… node scripts/ensure-teacher.mjs`

### 安装包

- 包版本已 bump 至 `0.1.7`；发版：`git tag v0.1.7 && git push origin v0.1.7` → Release / Artifact `classroom-desk-windows-setup`（见 [ARTIFACTS.md](./docs/ARTIFACTS.md)）

## v0.1.6 — 2026-11-07

助教按班授权、座位蛇形/拖拽、LAN 升级上传、抢答实时榜、家长 PDF、OCR 草稿、运维图表与恢复向导。

- 助教设置：按班勾选「可导出 / 可加分」；`exports` / `points` 路由强制校验 grants
- 座位图：拖拽换座；一键「按学号蛇形落座」
- LAN 升级：设置页上传 Setup.exe，自动配对生成 `.sha256`
- 学生端离线队列：显示待补交条数 + 失败重试
- 抢答 WebSocket 实时榜（替代仅靠教师手动刷新）
- 家长月报：分享链接一键下载 PDF（HTML 仍可打印）
- OCR：粘贴 Word / 选图 → 浏览器本地 Tesseract 出题草稿
- 健康仪表盘：就绪时长直方图、漂移趋势图
- 备份恢复向导：停服清单 + sha256 校验后再替换 live DB
- 投影色盲条：图例说明 + 色相可切换（C / 滑条）
- 数据保留：`recycle_retention_days` 调度 purge 接设置 UI（可立即 purge）
- e2e `ops-v016`：presence SSE + readiness + seats/session

### 安装包

- `ClassroomDesk-Setup-0.1.6.exe` + `.sha256` + `config.example.json`（由 tag `v0.1.6` Release workflow 产出）

---

## v0.1.5 — 2026-11-07

运维与上课台打磨：版本注入、机房就绪埋点、presence SSE、投影按课次计时、缺勤分列导出、可配置弱口令。

- 学生端版本由 `package.json` / Vite `define` 注入；去掉手写 `version.ts`
- 开课清单：无在线桌面端时「扫码指派」CTA；审计 `setup.scan_assign_cta` / `setup.classroom_ready`（就绪时长）
- 备课「在线机位」：SSE 推送（失败回退轮询）+ 一键复制漂移升级提示
- 教师侧栏班级版本漂移汇总（对齐 /health + presence）+ Release 链接
- 投影只读：按本场出勤课次 `startAt` 起算 N 分钟（重进投影不重置）
- 出勤单场缺勤导出：缺勤/请假/迟到分列；xlsx 多表 + 冻结首行/筛选
- QR 失败可粘贴 JSON；Windows `FIRST_RUN_GUIDE.html`（打开应用协议 + SmartScreen 交叉链接；`/S` 静默跳过）
- 弱口令：内置列表 + 设置扩展；`/api/v1/auth/password-policy` 合并下发
- 备份「显示目录」+「复制路径」
- CI bulk gate：`ops-polish` + `ops-v015`

### 安装包

- `ClassroomDesk-Setup-0.1.5.exe` + `.sha256` + `config.example.json`（由 tag `v0.1.5` Release workflow 产出）

---

## v0.1.4 — 2026-11-07

机房落地补丁：版本心跳、扫码首次配置、出勤单场重算、投影只读大屏、Release 按 tag 截取 CHANGELOG。

- CI e2e 固定 `PLAYWRIGHT_BROWSERS_PATH` + 浏览器缓存
- 学生端首次引导可扫教师 QR / 选图识别填入 `apiBase`/`classId`
- 心跳上报 `clientVersion`；开课清单显示「已连桌面端版本」
- 出勤报表选课次后表格按场重算；发题未勾正确项禁用发布
- 备份设置展示目录与保留份数；投影 `R` 只读大屏
- `/health` 与学生端版本漂移教师横幅；改密页强度与弱口令即时提示
- `docs/SMARTSCREEN.md`：SmartScreen + 机房组策略放行说明
- e2e `ops-polish`

---

## v0.1.3 — 2026-11-07

在 v0.1.2 上课台基础上补齐机房落地细节；学生机包含安装后首次引导。

### 学生端

- 安装后首次配置向导：写入本机 `config.json`（服务器地址 / 机位班级）并校验 `/health`。
- 单选/判断是否「确认提交」跟随教师设置（默认开启）。

### 教师端

- 开课清单：未完成项一键跳转；「服务器可达 / 学生端版本」健康探针。
- 发题：服务端强制多选至少一项正确。
- 出勤报表：按课次筛选，导出 CSV / Excel。
- 设置：答题确认开关；备份上次成功时间 / 失败原因，可立即备份。
- LiveBoard 投影：`Esc` 退出，`F` 全屏（`docs/TEACHER_PROJECTION.md`）。

### 部署与 CI

- `docs/SMARTSCREEN.md`：SmartScreen + 机房组策略放行说明。
- Release/CI：`actions/checkout@v5`、`setup-node@v5`、`softprops/action-gh-release@v3`（Node 24）。
- e2e `setup-identity`：bootstrap 密码先改密再跑通清单与指派。

### 安装包

- `ClassroomDesk-Setup-0.1.3.exe` + `.sha256` + `config.example.json`

---

## v0.1.2 — 2026-11-06

面向任意机房自托管：去掉演示假数据，补齐上课台 UX，发布未签名 Windows 学生机包。

- 重写 `docs/SETUP_FROM_GITHUB.md`（不绑定固定教室 IP）。
- 教师：上课 / 备课 / 指派；开课准备清单；SessionHome 快发题 + LiveBoard。
- 学生：IdentityGate 身份确认；未答数量提示；`config.example.json` 占位符。
- 发题可选正确项；签到入口改名「出勤报表」。
- 安装包：https://github.com/otas0/classroom-desk/releases/tag/v0.1.2

---

## v0.1.1

- 名单 UI 改名；打包辅助与小修复。

## v0.1.0

- 首个可发布学生机安装包与基础教师后台。
