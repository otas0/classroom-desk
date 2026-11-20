# Service Fix patch（本机 API 起不来）

**症状：** 教师机浏览器打不开 `http://127.0.0.1:8787/health` 或 `/admin/`。  
**不是防火墙绕过问题**——本机服务未在听。

## 单独安装（给已装过教室的学校）

1. 从 GitHub Release / `Give-To-Teacher` 下载 **`Service-Fix.exe`**（即 `ClassroomDesk-Service-Fix-x64.exe`）
2. 教师机上**双击**（SmartScreen → More info → Run anyway）
3. UAC 同意后自动：
   - 定位 `C:\ClassroomDesk`
   - 缺包则续传修复 Dist zip
   - 补齐便携 Node
   - 用**绝对路径**重写开机任务 `ClassroomDeskServer`
   - 放行 TCP 8787
   - 启动 API，等到 `/health` 通
   - 打开 Admin；桌面留下 `ClassroomDesk-Service-OK.txt` 与 `ClassroomDesk-Fix-Service.cmd`（可再点一次）

**无需用户输入任何命令。**

## 何时发这个补丁

- 装完后 `/health` 不通  
- 重启后服务没起来  
- 任务计划里 Node 路径失效  

安全/可靠性补丁：只修本机服务启动与持久化，不改学生端、不关 Defender。
