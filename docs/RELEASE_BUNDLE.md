# Release 附件（只两个 Setup）

目标 tag：**v0.1.14**（勿跳到 1.0.0，除非 [`PILOT_SKU.md`](./PILOT_SKU.md) GA 门槛全过）。

自检：

```bash
npm run check:release-bundle              # 对照最新 GitHub Release
npm run check:release-bundle -- --local   # 对照本机产物
npm run check:release-bundle -- --tag v0.1.11
```

## GitHub Release 必须附件（仅此）

| 资产 | 用途 |
|---|---|
| `ClassroomDesk-Teacher-Setup-<ver>-x64.exe` (+ `.sha256`) | **教师**一键安装（内含日常启动 / Fix / Service-Fix） |
| `ClassroomDesk-Setup-<ver>-x64.exe` (+ `.sha256`) | **学生** Setup |
| `ClassroomDesk-Setup-<ver>-arm64.exe` (+ `.sha256`) | **学生** ARM Setup |

说明：[TEACHER_EXES.md](./TEACHER_EXES.md)。教师装完后用桌面快捷方式，不必再下别的教师 exe。

## 不再上传到 Release（避免误解）

| 资产 | 去向 |
|---|---|
| `Teacher-Bootstrap.exe` / `Service-Fix.exe` / `Teacher-Fix.exe` / `ClassroomDesk.exe` | 打进 **Teacher-Setup**；或本机 `Give-To-Teacher/Advanced/`（IT） |
| `ClassroomDesk-*-win-x64.zip` | 不进 Release；IT 本地 `npm run pack` |
| `config.example.json` | 学生包内 / 仓库 `apps/student-desktop/resources/` |

> 自 **v0.1.14** 起 Release 页按上表收敛；旧 tag（如 v0.1.11）可能仍有多余附件。

## 产品门禁（meet / not）

| 门禁 | 状态 |
|---|---|
| 教师冷装 **&lt; 5 min**（Teacher-Setup） | **设计达标**（见 TIME_TO_CLASS） |
| 学生 **一个链接** `/get` | **代码已合**；须随下一 tag 发布 |
| `gaReady` / 1.0 GA | **未 meet** |
| Authenticode 签名 | **视 secrets** |

## 发版步骤（维护者）

1. 合并 → `main`；`package.json` version bump。  
2. `git tag vX.Y.Z && git push origin vX.Y.Z` → Actions `release.yml` 只上传 Setup。  
3. `npm run check:release-bundle -- --tag vX.Y.Z` 全绿后再对外喊发版。
