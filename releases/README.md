# releases/（本机 / U 盘产物，不入库）

按教室存放安装包与配置，**勿 git commit**（已在 `.gitignore`）。

建议目录：

```text
releases/
  <教师机IP>/
    ClassroomDesk-Setup-0.1.0.exe
    ClassroomDesk-Setup-0.1.0.exe.sha256
    config.json          # pack-classroom-config 生成
    classroom-identity.json
    PRINT_DESK_CARD.md
```

生成：

```bash
node scripts/prepare-live-classroom.mjs --apiBase http://教师IP:8787
node scripts/pack-classroom-config.mjs --apiBase http://教师IP:8787 --classId <id>
# CI 下载 windows-pack artifact → 拷入本目录后带 U 盘
```
