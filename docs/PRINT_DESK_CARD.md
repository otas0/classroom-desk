# 讲台一页纸 · 单教室

塑封放讲台。完整冷启动见 [CLASSROOM_DEPLOY_ONEPAGE.md](./CLASSROOM_DEPLOY_ONEPAGE.md)。

## 拓扑

教师机跑服务（8787）；学生机只装客户端，指向该教师机 IP。

## 上课前（3 条）

1. 教师机已开服务（`npm run start:classroom` 或自启），防火墙放行 8787。  
2. 学生机浏览器打开 `http://教师IP:8787/ready` 见「可以上课」。  
3. `/admin`：建班 → 名单 → 学生机扫码连上 → 发第一题。

## 本教室填写

| 教师 IP | classId |
|---|---|
| _______________ | _______________ |

学生机 `apiBase` **禁止** `127.0.0.1`。未签名包：SmartScreen → 更多信息 → 仍要运行。

## 课堂

| 角色 | 操作 |
|---|---|
| 学生 | 点名签到 / 答题 / 加分申请 |
| 教师 | 发题、审核加分、导出 |

备份：`npm run backup:db` → `apps/server/data/backups`。
