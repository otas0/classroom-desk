# 教室部署（只要三步）

不要一开始读完全部文档。大多数教室只做下面三步。

## 1. 教师机开服务

```bash
git clone <本仓库> && cd classroom-desk
npm install
npm run start:classroom
```

浏览器打开 `http://127.0.0.1:8787/admin/` → 登录 → **建班 / 导入名单 / 指派学生机**（上课页「开课准备」三步清单）。

> `start:classroom` = 缺字体时拉 CJK → 构建教师端 → 启动 API（`0.0.0.0:8787`）。

## 2. 学生机装客户端

1. 拷 `ClassroomDesk-Setup-*.exe`（Release / CI artifact / U 盘）
2. 对照旁路 `.sha256` 后安装，装完可删临时包
3. 扫教师「指派学生机」二维码

## 3.（可选）以后升级

设置 → **学生机升级包** → 上传新 `Setup.exe`（自动生成并校验 sha256，旧包自动删）。  
可选勾「学生机强制跟教师端同版本」（**教师可选、默认关**；开启后学生端不可取消，从教室 LAN 下载并静默安装，不拉公网）。

---

加固（深锁 / Assigned Access）、U 盘清单、systemd 等：**用到再查**

| 需要时 | 文档 |
|---|---|
| 冷启动细项 | [SETUP_FROM_GITHUB.md](./SETUP_FROM_GITHUB.md) |
| 讲台塑封卡 | [PRINT_DESK_CARD.md](./PRINT_DESK_CARD.md) |
| U 盘 | [LOCAL_USB_CHECKLIST.md](./LOCAL_USB_CHECKLIST.md) |
| 整机 AA / C2 | [EXIT_LOCK_MDM.md](./EXIT_LOCK_MDM.md) |
| 安全边界 | [SECURITY.md](./SECURITY.md) |
