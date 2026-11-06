# 学生端退出锁定 · 应用层与 MDM/Kiosk

Classroom Desk 学生端默认**禁止关闭**（关窗、`Cmd/Ctrl+Q`、菜单退出）。允许退出的唯一正规途径：

1. 教师后台「批量允许关闭学生端」（限时）
2. 本机「设置」输入解除码（或管理密码）后退出

## 应用层已覆盖

| 路径 | 行为 |
|---|---|
| 无框窗口关闭 | 拦截，提示并跳转「设置」 |
| 应用菜单 / 快捷键退出 | 无菜单；`before-quit` 拦截 |
| `admin:quit` IPC | 未解锁拒绝 |
| 教师批量解除 | `clientExitUnlockUntil` 轮询同步；标题栏倒计时 |
| 解除码错误 | 15 分钟内 5 次失败 → 锁定 15 分钟（429） |

开发临时放开：`ALLOW_STUDENT_EXIT=1`。

## 应用层挡不住的（需系统策略）

任务管理器「结束任务」、`taskkill /F`、`kill -9`、强制退出属于 **操作系统权限**，普通桌面应用无法 100% 拦截。教室若要求「系统级也关不掉」，请用学校既有 **MDM / 分配访问 / Kiosk** 策略，例如：

### Windows（推荐）

1. **分配访问（Assigned Access）/ 多应用展台**  
   将学生账户限制为仅可运行 `Classroom Desk`（及必要系统应用）。  
   设置路径：设置 → 帐户 → 家庭和其他用户 → 设置分配访问（因版本而异）。
2. **组策略 / Intune**  
   - 禁止学生帐户打开任务管理器（`CTRL+SHIFT+ESC`）  
   - 限制「结束任务」权限  
   - 可选：开机仅启动学生端（配合已有 `openAtLogin`）
3. **Shell 替换（高风险，慎用）**  
   仅在专用学生机、有回滚方案时考虑。

### 验证打包安装态退出锁定

1. 安装 `ClassroomDesk-Setup-*.exe`（unsigned 可 SmartScreen 绕过，见 SMARTSCREEN.md）。
2. 确认 `config.json` 指向教师机 LAN API（禁止 `127.0.0.1`）。
3. 启动后标题栏显示 **已锁定**；尝试关闭无效。
4. 教师端批量解除 → 学生标题栏出现 **可退出 m:ss** → 可关闭。
5. 教师「重新锁定」→ 再次无法关闭。
6. 本机解除码路径：设置 → 输入码 → 退出。
7. 自动化静态检查：`npm run verify:exit-lock-packaged`（校验打包产物内嵌锁定逻辑）。

详见 [LOCAL_USB_CHECKLIST.md](./LOCAL_USB_CHECKLIST.md)「锁退出」项。
