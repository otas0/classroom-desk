# Classroom Desk · 学生端（Electron）

默认 `npm run dev` / `dev:stack` 会拉起 Vite + Electron 小窗。

**仅浏览器 / CI / Playwright（不开 Electron 窗）：**

```bash
ELECTRON_OFF=1 npm run dev --workspace=@classroom-desk/student-desktop
# → http://127.0.0.1:5173 （Vite-only）
```

打包：`npm run dist:win` → `release/ClassroomDesk-Setup-*.exe`。配置见 `resources/config.json` 与仓库 `docs/`。
