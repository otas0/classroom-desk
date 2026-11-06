# 本教室身份（复制为 CLASSROOM_IDENTITY.md 后手写，勿提交密码）

| 项 | 本机联调已填（可改） | 注意 |
|---|---|---|
| 教师机局域网 IP | `192.168.31.179` | 路由器 DHCP 预留 / 静态 IP |
| apiBase | `http://192.168.31.179:8787` | 学生机 **禁止** `127.0.0.1` |
| /health（学生浏览器） | `http://192.168.31.179:8787/health` | 上课前强制；也可用 `/ready` 看中文页 |
| /admin | `http://192.168.31.179:8787/admin/` | 教师后台（同域，勿写死 127.0.0.1） |
| classId | `00d6b800-6628-4d20-a49c-9765325d9eef` | 「指派学生机」复制；与 pack 一致 |
| 班级名 | `本教室` | 名单用 Excel 正式导入 |
| 教师账号 | `teacher` | 设置里改掉初始密码 |
| 学生 config | `releases/<IP>/config.json` | `pack-classroom-config` 生成 |

清假数据并重生：

```bash
TEACHER_PASSWORD='你的密码' node scripts/prepare-live-classroom.mjs \
  --apiBase http://192.168.31.179:8787 --className 本教室
node scripts/pack-classroom-config.mjs \
  --apiBase http://192.168.31.179:8787 --classId <classId>
```

名单模板：`docs/templates/roster-import-template.csv`
