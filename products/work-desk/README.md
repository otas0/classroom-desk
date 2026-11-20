# Work Desk

面向工厂与办公的员工管理与工时工具。独立部署，不与课堂产品共用逻辑或数据库。

> **源码位置：** 本目录属于 monorepo [`otas0/classroom-desk`](https://github.com/otas0/classroom-desk) 的 `products/work-desk`。发版与机房包见仓库根 [`docs/RELEASE_BUNDLE.md`](../../docs/RELEASE_BUNDLE.md)；本产品默认**不**打进 Classroom Desk Release 附件。

## 做什么

- **员工身份与权限**：管理员 / 主管 / 员工；按部门组织
- **打卡**：上班 / 下班为考勤边界
- **在线时长**：登录心跳累计，仅辅助参考，不替代打卡
- **加班**：超出当日标准工时的部分可统计，主管确认后记入

## 不做什么

隐蔽监控、键鼠记录、截屏、用在线时长冒充考勤。

## 本地启动

```bash
cd products/work-desk
cp .env.example .env
# 首次启动可设 BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD 创建管理员
npm install
npm run dev          # API :8787
npm run dev:admin    # 管理端
npm run dev:employee # 员工端
```

未配置 bootstrap 时，打开管理端会引导创建首位管理员（库内无管理员时）。

## 仓库结构

```text
apps/server        API + SQLite
apps/admin-web     管理员 / 主管
apps/employee-web  员工打卡与在岗
packages/shared    共享类型与常量
```
