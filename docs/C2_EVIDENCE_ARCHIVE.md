# C2 证据归档（样机 · 不入库）

本文件是清单模板；**音视频与截图不要 commit**。复制到教师机：

```text
证据/C2-YYYYMMDD/
  C2-narrator.mp4
  C2-taskmgr-deny.mp4
  C2-titlebar.png
  C2-intune-version.txt
  C2-intune-policy.png
  ClassroomDesk-Setup-*.exe
  ClassroomDesk-Setup-*.exe.sha256
```

核对步骤见 [EXIT_LOCK_MDM.md](./EXIT_LOCK_MDM.md)。Intune XML 示例：[intune-student-kiosk.example.xml](./intune-student-kiosk.example.xml)。版本表模板：[C2_intune-version.example.txt](./C2_intune-version.example.txt)。安装包命名：[ARTIFACTS.md](./ARTIFACTS.md)。

样机本批建议：`ClassroomDesk-Setup-0.1.7.exe`（Release `v0.1.7`）。本地可把填好的 `C2-intune-version.txt` 放在 `artifacts/`（gitignore）或 `证据/C2-YYYYMMDD/`；录完 `C2-narrator.mp4` / `C2-taskmgr-deny.mp4` 后按上表归档。
