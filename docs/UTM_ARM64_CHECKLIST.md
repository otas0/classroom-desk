# UTM ARM64 学生端全流程手测

本机 CI/macOS **不能**代替 UTM 内 Windows on ARM 安装验收。打印本表到样机旁勾选。

## 前置

| 项 | 值 |
|----|-----|
| UTM 访客系统 | Windows 11 ARM64（建议 24H2） |
| 安装包 | `ClassroomDesk-Setup-<ver>-arm64.exe`（`dist:win:arm64` / Release） |
| SHA256 | 与同名 `.sha256` 一致 |
| 教师机 | 同网可达 `:8787`；一键连班已开 |

## 勾选表

| # | 步骤 | 期望 | 操作员 | 日期 | □ |
|---|------|------|--------|------|---|
| 1 | 拷入 Setup；右键属性 | SmartScreen / 发行者提示可理解；**不**绕过签名要求 | | | |
| 2 | 安装（所有用户） | 完成；路径含 `Classroom Desk.exe` | | | |
| 3 | 装完自动启动或桌面快捷方式 | 进入首次配置（非空白死页） | | | |
| 4 | 同网发现 / 房间码连班 | 能拉到讲台；显示名正确 | | | |
| 5 | 写入本班后重启客户端 | **重连本班**优先于全网扫 | | | |
| 6 | `/api/v1/upgrades/latest?arch=arm64` | 指向 arm64 包（若教师已上传） | | | |
| 7 | presence `clientArch` | 教师侧可见 `arm64` | | | |
| 8 | 退出锁定标题栏 | 「已锁定」；关窗被拦 | | | |

## 失败时

- SmartScreen 拦：用学校签名包或 IT 信誉流程，**禁止**当产品功能教用户关闭 Defender。
- 发现不到讲台：同网段、防火墙 8787、一键连班、房间码（见 [HANDTEST_MULTI_CLASSROOM.md](./HANDTEST_MULTI_CLASSROOM.md)）。
