# 可选：U 盘 / 内网共享落盘清单（任意教室）

> 优盘不是必须。优先用 [SETUP_FROM_GITHUB.md](./SETUP_FROM_GITHUB.md) 从 GitHub Releases 安装。  
> 下列路径仅为**本机落盘示例**，请改成你的教室目录名（不要提交真实 exe 进 git）。

建议目录：`releases/<教师机IP或教室代号>/`（exe 已 gitignore）。

## 本批 0.1.7 安装包（USB）

从 Release `v0.1.7` 或本地 `artifacts/windows-pack-check/` 拷入 U 盘目录：

| 文件 | 校验 |
|---|---|
| 已签名的 `ClassroomDesk-Setup-0.1.7.exe`（或 `*-x64.exe`） | SHA256 `992ee805ff2a8e92f66dfaee6d26068b29ac598d08082af0ebc399408f898b57` |
| `ClassroomDesk-Setup-*-arm64.exe` | ARM / UTM Windows；旁路 `.sha256` 另核 |
| `ClassroomDesk-Setup-0.1.7.exe.sha256` | 第一列须与上表一致 |

```powershell
Get-FileHash -Algorithm SHA256 .\ClassroomDesk-Setup-0.1.7.exe
# 期望：992ee805ff2a8e92f66dfaee6d26068b29ac598d08082af0ebc399408f898b57
```

版本↔tag 对照见 [ARTIFACTS.md](./ARTIFACTS.md)。C2 勾选见下文「C2」。

一键组装 U 盘源目录（exe + sha + C2 清单 → `releases/<IP>/`）：

```bash
bash scripts/prepare-usb-pack.sh 192.168.x.x
bash scripts/copy-usb-release.sh /Volumes/YOUR_USB 192.168.x.x
```

可选：生成可扫码 **seat_map.id 对照表**（内嵌 SVG QR，离线打印）：

```bash
# 先拿教师 JWT，再指定班级
TOKEN=$(curl -sS -X POST http://127.0.0.1:8787/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"teacher","password":"YOUR_PASSWORD"}' | jq -r .token)
CD_TOKEN="$TOKEN" CD_CLASS_ID="<classId>" CD_API_BASE=http://127.0.0.1:8787 \
  bash scripts/prepare-usb-pack.sh 192.168.x.x
# → releases/<IP>/SEAT-MAP-ID-SHEET.html

# 或单独生成：
CD_TOKEN="$TOKEN" CD_CLASS_ID="<classId>" \
  node scripts/gen-seat-map-sheet.mjs --out releases/demo/SEAT-MAP-ID-SHEET.html
  # 可选：--filter empty|seated 设初始「仅空座 / 仅已排」；页内按钮可再切换后打印
  # 无障碍：筛选按钮有 aria-pressed / title；说明文案「筛选说明」在表上方；
  # aria-live 播报「当前筛选：全部/仅空座/仅已排」；Tab+Enter 可切换；打印时隐藏 aria-live
```

## 原则

- `apiBase=http://<教师机局域网IP>:8787`（写入 settings + 学生 `config.json`）  
- 名单/题目/留言：**禁止预填假名**；空库显示空状态；仅真实导入与真实发题  
- **优先使用学校发布者证书签名的 Setup**（与 Release / Artifact 同名 `.exe` + `.sha256`）；SmartScreen 信誉随发布者积累  
- 未签名应急包：见 [SMARTSCREEN.md](./SMARTSCREEN.md)（**禁止**把「关闭 Defender / 关 SmartScreen」当作产品标准步骤）  
- 连班口令仅教室网：见 [CLASSROOM_JOIN_SECURITY.md](./CLASSROOM_JOIN_SECURITY.md)

## 合规（强制）

- [ ] **须学校 IT 知情**：已向机房/信息中心说明「学生端退出锁定 + Assigned Access / 组策略」方案，并确认可审计、可卸载策略路径（见 [EXIT_LOCK_MDM.md](./EXIT_LOCK_MDM.md)、[STUDENT_LOCK_HARDENING_PLAN.md](./STUDENT_LOCK_HARDENING_PLAN.md)）  
- [ ] **物理输入锁须告知学生**：启用键鼠/语音/相机锁或「考试模式」前，已当面或投影说明用途与解除方式（学生端有醒目横幅；鼠标锁时仍可「向教师举手」）

清库重生（改成自己的 IP / 班名）：

```bash
npm run prepare:live -- --apiBase http://192.168.x.x:8787 --className 高一(3)班
```

## 教师机勾选

- [ ] **硬步骤：** 第一次家长 PDF 或离线拷贝之前 `npm run fonts:cjk`，确认 `apps/server/assets/fonts/` 已有 NotoSansSC  
- [ ] （可选）机房张贴：用**本机**海报源文件打印（不进 GitHub；见本地 `docs/assets/` 或设计稿）  

- [ ] 固定 IP（`windows-set-fixed-ip.ps1`，参数用本教室地址）  
- [ ] 防火墙放行 8787 + 开机自启  
- [ ] `.env` 中 `JWT_SECRET` / 教师密码已自设  
- [ ] `npm run start:server`，`/health` 含正确 `lanIps`  
- [ ] 后台导入真实名单、指派并下载 `config.json`  
- [ ] `npm run backup:db`，`/health` 无 `lastError`

## 学生机勾选

- [ ] 浏览器：`http://<教师机IP>:8787/ready` 通过  
- [ ] 安装 Release exe + 本班 `config.json`  
- [ ] 点名「确认是我」后可答题  

## C2. 锁退出（须 Windows 真机）

操作员一页纸：[SAMPLE_MACHINE_OPS.md](./SAMPLE_MACHINE_OPS.md)。  
详见 [EXIT_LOCK_MDM.md](./EXIT_LOCK_MDM.md)（C2 证据表 + Assigned Access 真实 NSIS 路径 + Intune XML）。  
静态检查（CI / `dist:win`）：`npm run verify:exit-lock-packaged`（`REQUIRE_WIN_EXE=1` 无 exe 硬失败；Artifact 保留 30 天）。

### 联调口令旁注（证据目录 · AA · Intune · 回滚）

> 口令仅用于样机联调，**禁止**写进正式 UI 默认值（见 `.cursor/rules/no-mock`）。

| 用途 | 路径 / 命令 |
|---|---|
| 建今日证据目录（gitignore `证据/`） | `npm run init:c2-evidence` → `证据/C2-YYYYMMDD/` |
| Intune 勾选模板（拷入证据目录） | `docs/C2_intune-version.example.txt` → 目录内 `C2-intune-version.txt` |
| Intune 下发 XML（试验组） | [`docs/intune-student-kiosk.example.xml`](./intune-student-kiosk.example.xml) |
| Intune **回滚** XML | [`docs/intune-student-kiosk.rollback.xml`](./intune-student-kiosk.rollback.xml) |
| Assigned Access 清单示例 | [`docs/assigned-access-checklist.example.json`](./assigned-access-checklist.example.json) |
| 真机 Alt+Tab 负向视频 | 删 `C2-alttab-win.mp4.PLACEHOLDER`，放入真 `C2-alttab-win.mp4` |
| 归档说明 | [C2_EVIDENCE_ARCHIVE.md](./C2_EVIDENCE_ARCHIVE.md) |

联调登录（e2e / 样机，勿预填登录框）：教师 `teacher` + 本机 `.env` 的 `TEACHER_PASSWORD`；API `http://<教师机局域网IP>:8787`。

- [ ] `npm run init:c2-evidence`；填满 `C2-intune-version.txt`（22H2 / 24H2）  
- [ ] 真 `C2-alttab-win.mp4` 替换 PLACEHOLDER；另录 `C2-taskmgr-deny.mp4` / `C2-titlebar.png` / `C2-intune-policy.png`  
- [ ] 试验组 example.xml → 同步 → 手测；结束用 rollback.xml；`npm run verify:c2-evidence` 通过  
- [ ] 标题栏「已锁定」+ 讲述人 10s（`C2-narrator.mp4`）；关窗 / Alt+F4 无效并 toast「向教师申请解除」  
- [ ] 教师批量解除二次确认后，学生秒级「可退出 m:ss」并可关  
- [ ] 重新锁定后无法关闭  
- [ ] 解除码可退；错码限流；审计中文标签含「轮换解除码」；CSV 当前页/全部；超期横幅可点「去设置」  
- [ ] Assigned Access 路径 `C:\Program Files\Classroom Desk\Classroom Desk.exe` + 任务管理器负向  
- [ ] （可选）试验组 Intune HideTaskManager；试验结束用 **rollback.xml** 撤回  
- [ ] 实机 Electron DevTools 关 `/exit-lock/ws` → toast「实时通道已切到备用」+ SSE  

网络不通先查 [NETWORK.md](./NETWORK.md)。
