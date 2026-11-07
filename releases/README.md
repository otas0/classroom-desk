# releases/（本机 / U 盘产物，不入库）

按教室存放安装包与配置，**勿 git commit**（已在 `.gitignore`）。

建议目录：

```text
releases/
  <教师机IP>/
    ClassroomDesk-Setup-0.1.7.exe
    ClassroomDesk-Setup-0.1.7.exe.sha256
    config.json          # pack-classroom-config 生成
    classroom-identity.json
    PRINT_DESK_CARD.md
    C2-intune-version.txt   # 可选：试验组填写后拷入
```

本批 SHA256（`v0.1.7`）：

```text
992ee805ff2a8e92f66dfaee6d26068b29ac598d08082af0ebc399408f898b57  ClassroomDesk-Setup-0.1.7.exe
```

生成：

```bash
node scripts/prepare-live-classroom.mjs --apiBase http://教师IP:8787
node scripts/pack-classroom-config.mjs --apiBase http://教师IP:8787 --classId <id>
# 优先：gh release download v0.1.7 -p 'ClassroomDesk-Setup-0.1.7.exe*'
# 或：CI windows-pack Artifact / 本地 artifacts/windows-pack-check/
```

对照表：[docs/ARTIFACTS.md](../docs/ARTIFACTS.md)；C2：[docs/C2_EVIDENCE_ARCHIVE.md](../docs/C2_EVIDENCE_ARCHIVE.md)。

## seat_map.id 对照表（可扫码）

```bash
CD_TOKEN=<teacherJWT> CD_CLASS_ID=<classId> CD_API_BASE=http://127.0.0.1:8787 \
  bash scripts/prepare-usb-pack.sh 192.168.x.x
# 或：
node scripts/gen-seat-map-sheet.mjs --api http://127.0.0.1:8787 --token "$TOKEN" --class "$CLASS_ID" \
  --out releases/192.168.x.x/SEAT-MAP-ID-SHEET.html
```

输出 `SEAT-MAP-ID-SHEET.html`：空座/已排 + **内嵌 SVG QR**（离线打印）。详见 [LOCAL_USB_CHECKLIST.md](../docs/LOCAL_USB_CHECKLIST.md)。
