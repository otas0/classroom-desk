# 本教室身份（填完后勿提交真实密码）

复制为 `CLASSROOM_IDENTITY.md`（已 gitignore 可选）或贴在讲台卡背面。

| 项 | 值 | 注意 |
|---|---|---|
| 教师机固定 IP | `192.168.x.x` | 路由器 DHCP 预留 |
| API | `http://教师IP:8787` | 学生机 **禁止** `127.0.0.1` |
| `/health`（学生浏览器） | `http://教师IP:8787/health` | 上课前强制测 |
| `/admin` | `http://教师IP:8787/admin/` | 教师后台 |
| classId | （教师后台「指派学生机」复制） | 与 `pack-classroom-config --classId` 一致 |
| 本班包 | `node scripts/pack-classroom-config.mjs --apiBase http://教师IP:8787 --classId <id>` | 样机通过后镜像 |

联调本机曾用 classId 示例：`00d6b800-6628-4d20-a49c-9765325d9eef`（默认班级；教室部署请换成正式班）。
