# Classroom Desk 更新日志

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
