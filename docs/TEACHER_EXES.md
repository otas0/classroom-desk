# 教师端：和学生一样，只下一个 Setup

学生端下载 **`ClassroomDesk-Setup-*.exe`**（一个就够）。  
教师端对外同样：**只下一个 `Teacher-Setup.exe`**。

其它「启动 / 修复」exe **打进 Setup 安装包里**，装完后出现在桌面快捷方式，**不必单独下载**。

## 教师只要这一个

| 下载 | 作用 |
| --- | --- |
| **`Teacher-Setup.exe`** | 双击一次 → 装到 `C:\ClassroomDesk` → 起服务 → 打开 Admin → **自动在桌面建快捷方式** |

Release 附件全名：`ClassroomDesk-Teacher-Setup-<ver>-x64.exe`（Give-To-Teacher 里稳定名叫 `Teacher-Setup.exe`）。

默认登录：`teacher` / `admin` → Admin → **设置**改密。见 [RESET_TEACHER_LOGIN.md](./RESET_TEACHER_LOGIN.md)。

## 装完后怎么用（桌面快捷方式）

| 桌面 | 干什么 |
| --- | --- |
| **Classroom Desk** | 每天上课（内部已带 Windows Node 校验 + 开 Admin） |
| **Classroom Desk Admin** | 只打开后台网页 |
| **Classroom Desk Fix** | Node 坏了 / 忘密码 → 重置为 `teacher`/`admin` |

本体在 `C:\ClassroomDesk\`；日常**只点桌面快捷方式**。

## 说给教师听的两句话

1. **第一次：** 双击 `Teacher-Setup.exe`（SmartScreen → More info → Run anyway）。  
2. **以后：** 桌面 **Classroom Desk**；坏了点 **Classroom Desk Fix**。

## 学生端（别跟教师 Setup 搞混）

| 文件 | 谁用 |
| --- | --- |
| `ClassroomDesk-Setup-*.exe` / `Student-Setup.exe` | **学生机** |
| 教室 `http://教师机IP:8787/get` | 优先：装完教师端后用 LAN，不必人手发学生 Setup |

## IT / 高级（一般教师不用下）

这些仍会出现在 GitHub Release / `Give-To-Teacher/Advanced/`，给机房老师做兜底，**不是日常必需**：

| 文件 | 何时 |
| --- | --- |
| `Teacher-Bootstrap.exe` | 公网很慢、只有小包时（先下再装，效果等同 Setup） |
| `Service-Fix.exe` | 已安装但 `/health` 死透、快捷方式也不行 |
| `Teacher-Fix.exe` / `ClassroomDesk.exe` | 与桌面 Fix / 启动相同；已嵌在 Setup 里 |
| Dist zip | 完整目录树；高级修复 |

## 相关文档

- 五分钟上手：[TEACHER_EASY_SETUP.md](./TEACHER_EASY_SETUP.md)  
- 发版附件：[RELEASE_BUNDLE.md](./RELEASE_BUNDLE.md)  
- Service Fix：[SERVICE_FIX.md](./SERVICE_FIX.md)  
