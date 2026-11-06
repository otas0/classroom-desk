# 校内网盘：未签名 / 签名包并行留档

建议挂载根：`$CLASSROOM_DESK_NAS_DIR`（备份）旁另建发布目录，例如：

```text
/mnt/school-nas/classroom-desk/
  backups/                 # backup-db.sh 同步的 DB
  releases/
    unsigned/              # CI 无 CSC 时的包（可有 SmartScreen）
      ClassroomDesk-Setup-0.1.0.exe
      ClassroomDesk-Setup-0.1.0.exe.sha256
      README.txt           # 指向 docs/SMARTSCREEN.md
    signed/                # 配置 CSC 后的包（优先发给教室）
      ClassroomDesk-Setup-0.1.0.exe
      ClassroomDesk-Setup-0.1.0.exe.sha256
    CURRENT.txt            # 一行：signed/ClassroomDesk-Setup-0.1.0.exe
```

## 规则

1. **教室默认发 `signed/`**；仅当本周无签名构建时临时发 `unsigned/`，并附 SmartScreen 一页纸。
2. 每个 `.exe` 必须带同名 `.sha256`（CI 已生成）。
3. `CURRENT.txt` 只指向一个相对路径，机房脚本/口头分发以它为准。
4. 保留最近 5 个版本；更旧的移到 `releases/archive/`。
5. DB 备份与安装包目录分离，避免误删。

## 从 Actions 拷到网盘（管理员）

```bash
# 下载 artifact 后：
VERSION=0.1.0
KIND=unsigned   # 或 signed
DEST="$CLASSROOM_DESK_NAS_DIR/../releases/$KIND"  # 按实际改
mkdir -p "$DEST"
cp ClassroomDesk-Setup-$VERSION.exe "$DEST/"
cp ClassroomDesk-Setup-$VERSION.exe.sha256 "$DEST/" 2>/dev/null || true
echo "$KIND/ClassroomDesk-Setup-$VERSION.exe" > "$(dirname "$DEST")/CURRENT.txt"
```
