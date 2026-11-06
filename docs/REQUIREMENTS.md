# Classroom Desk — 完整需求文档（合并版）

版本：v1.1（主需求 + 签到 / 加分请求 / 按月导出 / 隔天清空）  
项目名：`classroom-desk`  
路径：`~/Projects/classroom-desk`

本文档合并「课堂作业与错题管理小工具」主需求与全部附加需求，并保留全部合规与安全约束。实现以本文为准。

---

## 0. 冲突处理说明

| 冲突点 | 旧表述 | 以本文为准 |
|---|---|---|
| 加分请求有效期 | 若曾约定「固定 60 分钟」 | **可配置** `point_request_ttl_minutes`，范围 **1–10080**（1 分钟–7 天），**默认 60** |
| 过期请求保留 | 仅改状态或前端隐藏 | 过期后状态改为 `expired`，并 **物理删除请求内容（理由等）**；列表不展示 |
| 长有效期 vs 隔天清空 | TTL 最长 7 天 | **隔天清空是硬性兜底**：未确认请求最多保留到次日清理时刻（默认 02:00），即使 TTL=7 天 |
| 拒绝请求 | 保留完整记录 | 拒绝后 **删除请求内容**；可不留或仅留最小化统计，**不保留学生填写的理由全文** |
| 加分写入 | 教师审核作业可直接加分 | 学生「请求加分」**必须教师确认**后才写 `points_log`；教师手动加分 / 已启用的自动规则加分另有来源字段 |
| 签到判定依据 | （主需求未定义） | **仅**学生端已登录 + 应用内心跳 + 教师开启的签到时段；**禁止**截屏 / 摄像头 / 键鼠记录 / 隐蔽监控 |
| 数据同步 | SQLite 或 Supabase 可选 | **首版固定**：校内中心 Express + SQLite；学生端连局域网 API；Supabase 不纳入首版 |
| 导出范围 | 错题 CSV | 额外要求：签到、已通过加分 **按月导出** CSV（Excel 可打开）；**不导出**已删除的 pending/expired 请求 |

未列出的主需求条款（窗口、角色、作业、留言、发题、打包等）全部保留，不被附加需求覆盖。

---

## 1. 产品定位

学校 / 教师统一部署、学生知情使用的课堂管理工具，**不是隐蔽监控软件**。

- 学生端：桌面右下角小窗（约 380×560），不占满屏；**无**卸载 / 退出按钮。
- 仅管理员 / 教师凭管理密码或系统管理员权限可退出、卸载、关闭开机自启。
- **禁止实现**：隐藏进程、键盘记录、截屏监控、拦截任务管理器、提权、防卸载对抗、绕过系统权限。

首次启动透明告知：

> 本工具由学校部署，用于作业、留言和错题统计。

签到相关额外告知：

> 签到仅记录本工具内的登录和在线状态。

---

## 2. 技术栈与部署

| 层 | 选型 |
|---|---|
| 学生端 | Electron + React + TypeScript + Vite |
| 教师端 | Web 管理后台（同仓库 Vite React SPA） |
| 后端 | Node.js + Express + SQLite（`node:sqlite` DatabaseSync） |
| 打包 | Windows 安装包（electron-builder）；开机自启用 Electron login item |
| 同步 | 中心服务持久化；多学生通过 HTTP API 读写同一库 |

目录约定（monorepo，npm workspaces）：

```text
classroom-desk/
├── apps/server/
├── apps/teacher-web/
├── apps/student-desktop/
├── packages/shared/
└── docs/
```

---

## 3. 窗口与部署要求

1. 学生端固定屏幕右下角，约 380×560，可折叠，不占全屏。
2. 始终置顶，不拦截系统快捷键，不隐藏进程（`skipTaskbar: false`）。
3. 开机自启：`app.setLoginItemSettings`；设置中说明用途。
4. 学生端 UI **不显示**退出 / 卸载 / 关闭自启。
5. 管理员密码模式可：退出程序、卸载程序、关闭开机自启、管理班级和学生。
6. 首次启动显示学校部署告知；签到前显示签到告知。
7. 不实现恶意持久化、防杀进程、防卸载对抗。

---

## 4. 功能模块

### 4.1 作业发布 + 加分系统

- 教师发布作业：标题、说明、截止时间、附件/链接、分值。
- 学生查看、标记完成、提交说明。
- 教师审核完成情况并加分。
- 加分规则类别：完成、优秀、补交、扣分等；全部进 `points_log`。
- 学生端显示我的积分、班级排行（或教师指定排行）。
- **防重复加分**：流水 + `idempotency_key`（及请求确认事务校验）。

### 4.2 留言区

- 学生留言 / 提问，教师回复。
- 按班级、学生、时间筛选。
- 学生端未读回复红点。
- 不做敏感内容监控之外的过度采集。

### 4.3 发题区 + 错误率统计

- 题型优先：单选、多选、判断、填空等客观题。
- 学生作答，系统自动判分。
- 错误率 = 错误人数 / 作答人数；可按班级、题目、选项看分布。
- 导出 CSV；教师可查看学生个人错题。

### 4.4 点名签到（附加）

**模式**

- **手动签到**：教师随时发起一场；学生在小窗点「签到」。教师可补签、改状态，须记操作人与时间。

**记录与导出**

- 筛选：班级、学生、日期、状态。
- 按月导出 CSV/Excel 兼容。

**表**

- `attendance_sessions`：`id`, `class_id`, `mode(auto|manual)`, `start_at`, `end_at`, `late_after_minutes`, `created_by`, `status`, …
- `attendance_records`：`id`, `session_id`, `student_id`, `status(present|late|absent|leave)`, `checked_at`, `source(auto|manual|teacher)`, `remark`, …
- **UNIQUE(`session_id`, `student_id`)** 防同场重复签到。

### 4.5 加分请求与确认（附加）

1. 学生点「请求加分」，填理由/类别 → `point_requests`（`pending`）。
2. **仅教师确认后**才真正加分；学生不能自加。
3. 两端显示倒计时（基于 `expires_at`）。
4. 确认事务：`pending` 且未过期 → 写 `points_log`，防重。
5. 拒绝：删除请求内容；可不留或仅最小化统计。
6. 加分记录按来源筛选：`request` / `manual` / `auto_rule`；按自动/手动时间段筛选；按月导出。
7. 自动加分仅用于教师预启用的明确规则（如按时签到、作业完成），规则可见；学生主动请求始终逐条确认。

**表 `point_requests`**

- `id`, `student_id`, `class_id`, `reason`, `category`, `status(pending|confirmed|rejected|expired)`, `created_at`, `expires_at`, `confirmed_by`, `confirmed_at`, …

**`points_log` 至少字段**

- `id`, `student_id`, `class_id`, `points`, `reason_summary`, `source(request|manual|auto_rule)`, `request_id`, `mode(auto|manual)`, `created_by`, `created_at`
- 另保留 `idempotency_key` UNIQUE 防重。

### 4.6 加分请求有效期与隔天清空（附加）

1. `point_request_ttl_minutes`：默认 60，最小 1，最大 10080。
2. 提交时 `expires_at = created_at + ttl`。
3. 超时未处理 → `expired` 并 **物理删除理由等内容**，列表不再显示。
4. **定时清理 + 查询惰性过滤** 双重保证，不依赖前端倒计时。
5. 每天固定时刻「隔天清空」，默认 **02:00**；教师端只读展示，**不可关闭**。
6. 清空对象：所有仍未确认请求（`pending` + `expired`）。
7. 方式：物理删除记录及理由；仅可保留「某日清理 N 条」类最小统计，**不保留理由文本**。
8. 硬性兜底：TTL=7 天时，未确认请求也最多留到次日清理时刻。
9. 已确认加分写在 `points_log`，隔天清空 **不得**删流水。
10. 只有教师确认通过的请求才写 `points_log` 并永久保留，可按月导出。
11. 请求删除后，`points_log` 仍保留；`request_id` 可置空或保留最小关联，**不保留请求理由全文**。
12. 导出只导 `points_log` 已通过数据。

### 4.7 教师端设置项（附加）

- `point_request_ttl_minutes`：默认 60，范围 1–10080。
- `point_request_daily_cleanup_time`：默认 `02:00`，固定启用，不可关闭。
- 说明文案：「未确认加分请求每天凌晨清空；已通过加分永久保留并可按月导出。」

### 4.8 导出（附加）

| 导出 | 默认 | 字段至少 |
|---|---|---|
| 签到 | 当前月，可选 `YYYY-MM` | 班级、学生、场次、签到模式、签到时间、状态、来源、备注 |
| 加分 | 当前月，可选月；可滤 mode/source | 班级、学生、加分分值、来源、模式、确认教师、确认时间、备注摘要 |

优先 CSV；已删除加分请求不出现在待确认列表与导出。

---

## 5. 角色与权限

- **学生**：本机 `classId` + 花名册点名进入（无班级码）；作业、留言、答题、积分/错题、签到、提交加分请求；看倒计时。
- **教师 / 管理员**：发布作业、审核加分、回复留言、发题、统计导出、签到管理、确认/拒绝加分请求、配置 TTL（不可关隔天清空）、学生端管理员退出/卸载。
- 管理员密码：`bcrypt` 存 `settings`，禁止明文硬编码。

---

## 6. 数据表总览

主需求表：`users`, `classes`, `assignments`, `assignment_submissions`, `points_log`, `messages`, `message_replies`, `questions`, `question_options`, `student_answers`, `error_stats`, `settings`。

附加表：`attendance_sessions`, `attendance_records`, `point_requests`；可选 `cleanup_stats`（日清理条数）。

建议索引与约束见实现阶段 `schema.sql`；关键约束：

- `assignment_submissions(assignment_id, student_id)` UNIQUE
- `student_answers(question_id, student_id)` UNIQUE
- `attendance_records(session_id, student_id)` UNIQUE
- `points_log.idempotency_key` UNIQUE

---

## 7. 接口与定时任务（附加相关）

- `POST /api/v1/point-requests` — 学生提交；写 `expires_at`
- `GET /api/v1/point-requests/pending` — 仅未过期且未删的 pending
- `POST /api/v1/point-requests/:id/confirm`
- `POST /api/v1/point-requests/:id/reject`
- `cleanupExpiredPointRequests()` — 超 `expires_at` 清理
- `cleanupDailyPointRequests()` — 每日固定时刻删全部 pending/expired 内容
- `GET /api/v1/exports/attendance?month=YYYY-MM`
- `GET /api/v1/exports/points?month=YYYY-MM&mode=auto|manual&source=...`

签到、作业、留言、题目等其余 REST 在实现阶段与 `docs/API.md` 对齐。

学生端心跳（合规）：`POST /api/v1/presence/heartbeat` — 仅证明应用内在线，用于自动签到判定。

---

## 8. UI 要求

**学生端**

- 顶栏：班级 / 学生 / 积分；可拖动；可折叠。
- Tab：积分、签到、答题、留言、设置；（无「我的」/班级码页；加分请求入口在积分页明确可见）。
- 未读红点、截止提醒、积分变化提示、加分请求倒计时、签到状态。

**教师端**

- 列表 + 表单 + 统计图表；设置页展示 TTL 与只读「每日清空」说明。
- 签到管理、加分请求待确认列表（含倒计时）、按月导出。

---

## 9. 验收标准（合并）

1. Windows 安装后可开机自启。
2. 学生端启动后右下角、置顶、不占满屏。
3. 学生端无卸载/退出入口；管理员密码可退出和卸载。
4. 教师可发布作业并加分，学生可见积分变化。
5. 留言可提问回复，有未读提示。
6. 发题后可作答，错误率统计准确。
7. 学生提交加分请求后显示倒计时。
8. 教师可设有效期 1 分钟–7 天，默认 60 分钟。
9. 超过有效期未确认的请求自动删除，理由不保留。
10. 每天固定时间清空所有仍未确认的加分请求。
11. 教师确认通过的加分写入 `points_log`，隔天清空后仍在，可按月导出。
12. 签到支持自动/手动，记录可按月导出。
13. 已删除的加分请求不出现在待确认列表和导出结果中。
14. 数据持久化，重启不丢失。
15. 不实现隐藏进程、键盘记录、截屏、防卸载对抗等能力。

---

## 10. 开发顺序

1. 需求合并文档（本文）+ 冲突说明。
2. Electron + React + TS 基础小窗（可运行）。
3. 本地数据库与后端 API（含 settings、心跳骨架）。
4. 作业/加分、留言、发题/错误率；再签到与加分请求/清理/导出。
5. 开机自启、管理员退出/卸载、打包、README。

每步可运行、可验证；不一次性堆不可运行大块代码。

---

## 11. 明确不做清单

- 隐藏进程、伪装进程名对抗
- 键盘 / 剪贴板记录
- 截屏 / 摄像头监控
- 拦截任务管理器、提权、防卸载对抗
- 关闭「隔天清空」的教师开关
- 学生自行把积分写入 `points_log`
