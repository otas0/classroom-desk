# Classroom Desk API

Base URL: `http://<server>:8787`  
Auth: `Authorization: Bearer <jwt>`（除注明公开接口外）

环境变量：`JWT_SECRET`（生产必填）、`ADMIN_PASSWORD`、`TEACHER_USERNAME`、`TEACHER_PASSWORD`、`DEFAULT_CLASS_CODE`、`PORT`、`HOST`。

## Health / Settings

| Method | Path | Auth | 说明 |
|---|---|---|---|
| GET | `/health` | 无 | 服务与数据库健康检查 |
| GET | `/api/v1/settings/public` | 无 | 告知文案、TTL、每日清空时刻 |
| GET | `/api/v1/settings` | 教师 | 完整设置 |
| PATCH | `/api/v1/settings` | 教师 | 可改 `pointRequestTtlMinutes`；清空时刻只读 |

## Auth

| Method | Path | Auth | 说明 |
|---|---|---|---|
| POST | `/api/v1/auth/login` | 无 | 教师登录 `{ username, password }` |
| POST | `/api/v1/auth/student-select` | 无 | 本机 `classId` + 名单 `studentId` 选身份（无班级码入班） |
| POST | `/api/v1/auth/admin-unlock` | 无 | 校验管理员密码 `{ password }` |
| GET | `/api/v1/auth/me` | 登录 | 当前用户 |
| GET | `/api/v1/auth/bootstrap-info` | 无 | 是否已写入管理员哈希等 |
| POST | `/api/v1/auth/change-admin-password` | 教师 | 修改管理员密码 |

## Classes

| Method | Path | Auth | 说明 |
|---|---|---|---|
| GET | `/api/v1/classes` | 教师 | 班级列表 |
| POST | `/api/v1/classes` | 教师 | 创建班级 |
| GET | `/api/v1/classes/:id/students` | 教师 | 学生列表 |

## Assignments / Points

| Method | Path | Auth | 说明 |
|---|---|---|---|
| GET | `/api/v1/assignments` | 登录 | `?classId=` |
| POST | `/api/v1/assignments` | 教师 | 发布作业 |
| POST | `/api/v1/assignments/:id/submit` | 学生 | 提交 |
| POST | `/api/v1/assignments/:id/review` | 教师 | 审核并写 `points_log` |
| GET | `/api/v1/assignments/:id/submissions` | 教师 | 提交列表 |
| GET | `/api/v1/points/me` | 学生 | 我的积分与流水 |
| GET | `/api/v1/points/leaderboard` | 登录 | 排行 |
| POST | `/api/v1/points/manual` | 教师 | 手动加分 |

## Point requests

| Method | Path | Auth | 说明 |
|---|---|---|---|
| POST | `/api/v1/point-requests` | 学生 | 提交请求，写入 `expires_at` |
| GET | `/api/v1/point-requests/pending` | 登录 | 仅未过期 pending；含 `countdownSeconds` |
| POST | `/api/v1/point-requests/:id/confirm` | 教师 | 事务确认写流水并删除请求内容 |
| POST | `/api/v1/point-requests/:id/reject` | 教师 | 物理删除请求 |

定时任务：每 30s `cleanupExpiredPointRequests`；每天 `02:00` `cleanupDailyPointRequests`。

## Attendance / Presence

| Method | Path | Auth | 说明 |
|---|---|---|---|
| POST | `/api/v1/attendance/sessions` | 教师 | 发起签到场次 |
| GET | `/api/v1/attendance/sessions` | 登录 | 场次列表 |
| POST | `/api/v1/attendance/sessions/:id/check-in` | 学生 | 手动签到 |
| POST | `/api/v1/attendance/records` | 教师 | 补签/改状态 `{ sessionId, studentId, status, remark? }` |
| GET | `/api/v1/attendance/records` | 登录 | 筛选记录 |
| GET | `/api/v1/attendance/my-status` | 学生 | 当前签到状态 |
| POST | `/api/v1/presence/heartbeat` | 学生 | 应用内心跳；可触发 auto 签到 |

## Messages

| Method | Path | Auth | 说明 |
|---|---|---|---|
| GET | `/api/v1/messages` | 登录 | 留言列表 |
| POST | `/api/v1/messages` | 学生 | 提问 |
| POST | `/api/v1/messages/:id/replies` | 教师 | 回复 |
| POST | `/api/v1/messages/replies/:id/read` | 学生 | 标记已读 |
| GET | `/api/v1/messages/unread-count` | 学生 | 未读数 |

## Questions

| Method | Path | Auth | 说明 |
|---|---|---|---|
| GET | `/api/v1/questions` | 登录 | 题目列表 |
| POST | `/api/v1/questions` | 教师 | 发布题目 |
| POST | `/api/v1/questions/:id/answer` | 学生 | 作答并自动判分 |
| GET | `/api/v1/questions/:id/stats` | 教师 | 错误率 |
| GET | `/api/v1/questions/export.csv` | 教师 | 题目统计 CSV |
| GET | `/api/v1/students/:id/wrong-answers` | 教师 | 个人错题 |

## Attendance schedules / uploads

| Method | Path | Auth | 说明 |
|---|---|---|---|
| GET | `/api/v1/attendance/schedules?classId=` | 教师 | 自动签到周历 |
| POST | `/api/v1/attendance/schedules` | 教师 | `{ classId, weekdays:[1-7], startTime, endTime, lateAfterMinutes }` |
| DELETE | `/api/v1/attendance/schedules/:id` | 教师 | 删除规则 |
| GET | `/api/v1/attendance/holidays?classId=` | 教师 | 节假日例外列表 |
| POST | `/api/v1/attendance/holidays` | 教师 | `{ holidayDate, name, classId? }` |
| POST | `/api/v1/attendance/holidays/import` | 教师 | `{ csv, classId?, dryRun? }` 校历 `YYYY-MM-DD,名称`；`dryRun` 返回冲突预览 |
| DELETE | `/api/v1/attendance/holidays/:id` | 教师 | 删除节假日 |
| POST | `/api/v1/classes/:id/students/import` | 教师 | `{ csv }`「姓名」或「姓名,学号」；返回 `failures[]` 行号明细 |
| GET | `/api/v1/questions/export.csv?classId=&includeOptions=0\|1` | 教师 | 题目统计；`includeOptions=1` 含选项分布列 |
| POST | `/api/v1/uploads` | 教师 | `multipart/form-data` 字段 `file`（MIME 白名单），返回 `{ url }` |
| GET | `/api/v1/uploads/allowed-types` | 登录 | 允许的 MIME/扩展名 |
| GET | `/uploads/:filename` | 无（校内静态） | 附件下载 |

## Exports

| Method | Path | Auth | 说明 |
|---|---|---|---|
| GET | `/api/v1/exports/attendance?month=YYYY-MM` | 教师 | 签到按月 CSV |
| GET | `/api/v1/exports/points?month=YYYY-MM&mode=&source=` | 教师 | 已通过加分 CSV |

`GET /api/v1/settings` 额外返回只读 `cleanupStats`（清理条数，不含请求理由）。
