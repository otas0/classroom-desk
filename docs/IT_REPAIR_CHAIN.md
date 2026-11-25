# IT 修复链（不进 GitHub Release）

教师日常路径只有 **`Teacher-Setup.exe`**。下面整段是 **IT / 运维** 用的，写进安装包是为了避免有人在 Release 页找 Bootstrap / Dist zip。

## GitHub Release 有什么 / 没有什么

| 有 | 没有（故意） |
| --- | --- |
| `ClassroomDesk-Teacher-Setup-<ver>-x64.exe` | `Teacher-Bootstrap.exe` |
| `ClassroomDesk-Setup-<ver>-{x64,arm64}.exe` | 独立 `Service-Fix` / `Teacher-Fix` / `ClassroomDesk.exe` |
| 上述 `.sha256` | `ClassroomDesk-*-win-x64.zip`（Dist zip） |

独立 Fix / Bootstrap / Dist zip 只在本机 `npm run pack` 后的 **`Give-To-Teacher/Advanced/`**，或已嵌进 Teacher-Setup 载荷（装完出桌面快捷方式）。

## 修复优先级

1. **再跑一遍完整 Teacher-Setup.exe**（U 盘 / 内网盘）— 载荷自带产品，不依赖 Dist zip。  
2. **Node MSI 下不来**：向导 →「Use Node already on this PC」→ Detect / Browse；或先装 [Node LTS](https://nodejs.org/en/download)。  
3. **IT 薄引导**：`Advanced/Teacher-Bootstrap.exe` 会拉 **一份** Dist zip。该 zip **必须由 IT 本地 `npm run pack` 产出并托管**，**不要**让教师去 GitHub Release 找。  
4. **应急**：`Advanced/Service-Fix.exe` 或桌面 **Classroom Desk Fix**（内容已在 Setup 里）。

## 禁止

- 在 Release 说明里写「去下 Dist zip / Bootstrap」。  
- 让教师在残网教室 `npm install` 从零装。  
- 把 Advanced 文件夹当教师日常入口。

相关：[RELEASE_BUNDLE.md](./RELEASE_BUNDLE.md) · [TEACHER_EXES.md](./TEACHER_EXES.md) · [TIME_TO_CLASS.md](./TIME_TO_CLASS.md)
