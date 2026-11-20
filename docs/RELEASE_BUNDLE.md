# 下一版全面 Release Bundle

目标 tag：**v0.1.12**（或下一日历版；勿跳到 1.0.0，除非 [`PILOT_SKU.md`](./PILOT_SKU.md) GA 门槛全过）。

自检：

```bash
npm run check:release-bundle              # 对照最新 GitHub Release
npm run check:release-bundle -- --local   # 对照本机 Dist / Give-To-Teacher
npm run check:release-bundle -- --tag v0.1.11
```

## Classroom Desk — 必须附件（全面 bundle）

| 资产 | 用途 | v0.1.11 实测 |
|---|---|---|
| `ClassroomDesk-Setup-<ver>-x64.exe` (+ `.sha256`) | 学生端 | 有（别名 `Student-Setup.exe`） |
| `ClassroomDesk-Setup-<ver>-arm64.exe` (+ `.sha256`) | 学生端 ARM | **缺** |
| `ClassroomDesk-Teacher-Setup-<ver>-x64.exe` (+ 稳定别名) | 优盘/离线教师一键 | 有 |
| `ClassroomDesk-Teacher-Bootstrap-<ver>-x64.exe` | 公网小引导下载整包 | **缺** |
| `ClassroomDesk-Service-Fix-<ver>-x64.exe` (+ 别名) | Node/服务修复 | 有 |
| `ClassroomDesk-<ver>-win-x64.zip` | 完整产品树（Install.bat） | **缺**（workflow 应出） |
| `config.example.json` | 学生配置样例 | **缺** |

可选但推荐：

| 资产 | 用途 |
|---|---|
| `ClassroomDesk-TeacherHost-<ver>-win-x64.zip` | 极简教师包（`npm run pack:teacher-host`）；与 Dist zip 二选一主推时以 Dist 为准 |
| Give-To-Teacher/* 稳定文件名 | 给教师的薄文件夹 |

## 产品门禁（meet / not）

| 门禁 | 状态 |
|---|---|
| 全球教师冷装 **&lt; 5 min**（优盘 Teacher-Setup / Dist zip） | **设计达标**（见 TIME_TO_CLASS）；依赖完整 zip 上架 |
| 学生 **一个链接** `/get` | **代码已合本分支**；须随下一 tag 发布 |
| `gaReady` / 1.0 GA | **未 meet** — 缺真实学校 live 证据 |
| Exam Box 量产硬件 | **未 meet** — `examBoxHardware=false` |
| Authenticode 签名 | **视 secrets**；未配则 SmartScreen 摩擦 |
| Work Desk / Brand Family 进同一 Release 附件 | **未要求** — 源码已在 `products/` |

## 发版步骤（维护者）

1. 合并本分支 → `main`；`package.json` version bump。  
2. `npm run pack`（Windows CI 在 `release.yml` 已跑）；本地可选 `npm run pack:teacher-host`。  
3. `npm run check:release-bundle -- --local` 全绿。  
4. `git tag vX.Y.Z && git push origin vX.Y.Z` → 等 Actions 上传。  
5. `npm run check:release-bundle -- --tag vX.Y.Z` 全绿后再对外喊「全面 bundle」。

Sibling 产品只随 git tag 进仓，不默认塞进机房 zip。
