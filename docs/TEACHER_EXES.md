# 教师端 EXE 一览（GitHub Release / Give-To-Teacher）

教师机**只双击 exe**，不要翻 bat。装完后桌面会自动出现快捷方式。

## 发给教师时带哪些

| 文件名 | 什么时候用 | 做什么 |
| --- | --- | --- |
| **`Teacher-Setup.exe`** | **第一次安装（必用）** | 一键装到 `C:\ClassroomDesk`：Windows Node、服务、防火墙、开机任务；打开 Admin；**在教师桌面创建快捷方式** |
| **`ClassroomDesk.exe`** | **每天上课** | 强制校验/重装 Windows Node → 启动本机 API → 打开 Admin |
| **`Teacher-Fix.exe`** | Node 不对 / 忘密码 / 旧版教室 | 强制 Windows Node + 重置登录为 `teacher` / `admin`（再进设置改密） |
| **`Service-Fix.exe`** | 只有 `http://127.0.0.1:8787/health` 打不开 | 修计划任务 / 监听 / Node PE，不改密码 |
| **`Teacher-Bootstrap.exe`** | 公网慢、优盘没有整包 | 小引导包：先下 Dist zip，再等同 Teacher-Setup |
| **`Student-Setup.exe`** | 优盘兜底（优先用教室 LAN 安装卡） | 学生端安装程序 |

Release 里版本化名字（等价）：

| 稳定别名（Give-To-Teacher） | Release 附件名 |
| --- | --- |
| `Teacher-Setup.exe` | `ClassroomDesk-Teacher-Setup-<ver>-x64.exe` |
| `ClassroomDesk.exe` | `ClassroomDesk-Launcher-<ver>-x64.exe` |
| `Teacher-Fix.exe` | `ClassroomDesk-Teacher-Fix-<ver>-x64.exe` |
| `Service-Fix.exe` | `ClassroomDesk-Service-Fix-<ver>-x64.exe` |
| `Teacher-Bootstrap.exe` | `ClassroomDesk-Teacher-Bootstrap-<ver>-x64.exe` |
| `Student-Setup.exe` | `ClassroomDesk-Setup-<ver>-x64.exe` |

## 推荐流程（说给教师听的三句话）

1. **第一次：** 双击 `Teacher-Setup.exe`（SmartScreen → More info → Run anyway）。  
2. **以后每天：** 桌面快捷方式 **「Classroom Desk」**（或 `ClassroomDesk.exe`）。  
3. **坏了：** 双击 `Teacher-Fix.exe`；只有网页打不开再试 `Service-Fix.exe`。

默认登录：`teacher` / `admin` → 登录后到 Admin **设置**改密。详见 [RESET_TEACHER_LOGIN.md](./RESET_TEACHER_LOGIN.md)。

## 装完后桌面上会有什么

`Teacher-Setup.exe` 成功结束后，在**教师本人桌面**写入：

| 快捷方式 | 指向 |
| --- | --- |
| **Classroom Desk.lnk** | `C:\ClassroomDesk\ClassroomDesk.exe`（日常启动） |
| **Classroom Desk Admin.url** | `http://127.0.0.1:8787/admin/` |
| **Classroom Desk Fix.lnk** | `C:\ClassroomDesk\Teacher-Fix.exe`（修 Node / 重置密码） |
| `ClassroomDesk-Desk-Login.txt` | 备用账号卡（勿放公共桌面） |
| `ClassroomDesk-Health.url` | 健康检查页 |

程序本体仍在 `C:\ClassroomDesk\`；桌面以**快捷方式**为主，避免一堆散落 exe。

## 不要混淆

| 不是这个 | 说明 |
| --- | --- |
| `ClassroomDesk-Setup-*.exe` | **学生端**安装包，不是教师机 |
| Dist zip `ClassroomDesk-*-win-x64.zip` | 完整树；给 IT / 高级修复，普通教师用 Setup 即可 |
| `Reset-Teacher-Login\` 文件夹 | 旧补丁；新流程用 **`Teacher-Fix.exe`** |

## 相关文档

- 五分钟上手：[TEACHER_EASY_SETUP.md](./TEACHER_EASY_SETUP.md)  
- 发版附件清单：[RELEASE_BUNDLE.md](./RELEASE_BUNDLE.md)  
- Service Fix 细节：[SERVICE_FIX.md](./SERVICE_FIX.md)  
- 补丁清单：[`patches/README.md`](../patches/README.md)  
