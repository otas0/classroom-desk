# 教室部署一页（推荐路径）

目标：教师机当服务器，学生机装桌面端，同一局域网即可上课。详细/例外场景见文末链接，**不要**一开始读完全部文档。

## 10 分钟开课路径

1. **教师机**（Windows 优先）  
   - 安装 [Node.js 22+](https://nodejs.org/)  
   - `git clone` → `npm install` → **`npm run fonts:cjk`** → `npm run build:teacher`  
   - `npm run start:server`（默认 `http://<教师机局域网IP>:8787`）  
   - 浏览器打开 `http://127.0.0.1:8787/admin/`，登录后建班、导入名单、指派学生机。

2. **学生机**  
   - 安装 `ClassroomDesk-Setup-*.exe`（来自 CI artifact / GitHub Release / U 盘包）  
   - 扫教师「指派学生机」二维码，或手填教室 API 与班级 ID。  
   - 学生端**没有**语言入口；界面语言跟教师设置的 `uiLocale`。

3. **升级（推荐 LAN，可选自动提示）**  
   - 教师：设置 → **LAN 升级包**，上传新的 `Setup.exe`（自动生成 `.sha256`）。  
   - 可选勾选「学生端版本漂移时提示打开局域网安装包」（默认关；**只弹确认，不静默安装，不拉公网**）。  
   - 学生：有漂移时优先显示「打开局域网安装包」；未上传包时才回退 GitHub Release。

4. **加固（整机管控，可选）**  
   - 上课页「深锁」：冻结 / 仅试卷 / 杀外置浏览器（学校机学生端）。  
   - 应用内锁 ≠ 禁 Alt+Tab / 任务管理器。整机用学校 **Assigned Access / Intune**：见 [EXIT_LOCK_MDM.md](./EXIT_LOCK_MDM.md)。

## 常用命令

```bash
npm run fonts:cjk          # 首次 PDF / 离线字形（必做）
npm run build:teacher
npm run start:server
npm run dist:win           # 打包学生端 Setup.exe
npm run prepare:usb        # 组 U 盘包（需已有 Setup）
npm run check:git-remote   # 确认 origin SSH Host 别名
```

## 再展开时读这些

| 场景 | 文档 |
|---|---|
| 从 GitHub 冷启动 | [SETUP_FROM_GITHUB.md](./SETUP_FROM_GITHUB.md) |
| 教师机 Windows 托管细节 | [CLASSROOM_TEACHER_HOST.md](./CLASSROOM_TEACHER_HOST.md) |
| U 盘拷贝清单 | [LOCAL_USB_CHECKLIST.md](./LOCAL_USB_CHECKLIST.md) |
| 样机 C2 / Intune / AA | [SAMPLE_MACHINE_OPS.md](./SAMPLE_MACHINE_OPS.md) |
| systemd / NAS / TLS | [DEPLOY.md](./DEPLOY.md) |
| 安全边界 | [SECURITY.md](./SECURITY.md) |
