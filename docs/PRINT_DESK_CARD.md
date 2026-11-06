# 讲台一页纸（可打印）

## A. 未签名安装（SmartScreen）

1. 只用本校 U 盘/网盘的 `ClassroomDesk-Setup-*.exe`，核对 SHA256。  
2. 提示未知发布者 → **更多信息 → 仍要运行**。  
3. 学生机 **apiBase = http://教师机局域网IP:8787**（禁止 127.0.0.1）。  
4. 本机 **classId** 由教师后台「指派学生机」下载 config 或设置页填写。

## B. 教师机当服务器

1. 管理员运行 `scripts\windows-teacher-host.ps1`（放行 8787，看 IP）。  
2. 固定教师机 IP；`.env` 中 `HOST=0.0.0.0`；`npm run start:server`（或开机任务 `windows-autostart-server.ps1`）。  
3. 浏览器 `http://本机IP:8787/admin/`：导入花名册 → 发题 → 审核加分。  
4. 上课前：任选一台学生浏览器打开 `http://教师IP:8787/health`，不通先关 AP 隔离。

## C. 课堂流程

教师：选班 → 导入 Excel/CSV → 下载本教室 config / 专用安装包 → 发题。  
学生：花名册点自己姓名 → 请求加分 / 答题 / 留言（若开启）。  
教师：加分审核通过 → 学生积分更新；查看题目正确率/错误率。

详文：`CLASSROOM_TEACHER_HOST.md` · `SMARTSCREEN.md` · `NETWORK.md`
