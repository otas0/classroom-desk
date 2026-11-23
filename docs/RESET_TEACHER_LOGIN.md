# Reset teacher login（默认 teacher / admin）

## 默认口令（新安装）

从本补丁起，教师端首次写入 `.env` 时默认：

| 项 | 值 |
| --- | --- |
| 用户名 | `teacher` |
| 登录密码 | `admin` |
| 管理密码 | `admin` |

登录后 Admin 会因弱口令闸**强制进入「设置」改密**（≥8 位且含字母与数字；勿再用 `admin`）。

## 已装旧版：单独投放本补丁

把下面三个文件**原样放进**教师机安装目录（通常 `C:\ClassroomDesk`），再双击 bat：

- `Reset-Teacher-Login.bat`
- `reset-teacher-login.ps1`
- `reset-teacher-login.mjs`

效果：

1. 重写 `.env`：`TEACHER_USERNAME=teacher`、`TEACHER_PASSWORD=admin`、`ADMIN_PASSWORD=admin`
2. 更新 `classroom.db` 里教师用户名与口令哈希、管理密码哈希
3. 清 `teacher_password_ok`，下次登录仍会要求改密
4. 重启计划任务 `ClassroomDeskServer`（若存在）
5. 桌面写下 `ClassroomDesk-Desk-Login.txt`
6. 在安装目录与 `patches\` 各留一份可再点的 bat

**无需命令行。** 若提示缺少 `node.exe`，先跑 `Service-Fix.exe` / `Install.bat`。

## 最新包已内置

每次 `npm run pack` / GitHub Release 都会带上：

- 安装树根目录：`Reset-Teacher-Login.bat`（+ `.ps1` / `.mjs`）
- `ClassroomDesk/patches/Reset-Teacher-Login.bat`（同套文件）
- `Give-To-Teacher/Reset-Teacher-Login/`（给旧教室单独拷贝）

见 `patches/README.md`。

## 安全说明

- `admin` 在弱口令黑名单中，**不能**作为改密后的正式口令。
- 正式 UI 登录框**不会**预填账号密码。
- 学期换班请轮换口令：见 [SEMESTER_RESET.md](./SEMESTER_RESET.md)。
