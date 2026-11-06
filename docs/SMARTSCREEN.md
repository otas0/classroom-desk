# 教室机旁 SmartScreen 话术（可打印）

**适用：** 未签名或新发布的 `ClassroomDesk-Setup-*.exe`  
**对象：** 任课教师 / 机房管理员

---

## 对学生怎么说（30 秒）

「这是学校发的课堂积分客户端，不是网上下载的未知软件。如果 Windows 提示『未知发布者』，点 **更多信息 → 仍要运行**。装完后老师会帮你们填教室服务器地址。」

## 操作步骤

1. 只安装来自 **本校网盘 / 教师分发** 的安装包（核对下方 SHA256）。
2. SmartScreen 拦截 → **更多信息** → **仍要运行**。
3. 安装结束弹窗：设置 **apiBase**（例 `http://192.168.1.50:8787`）。
4. 学生：本机已指派 `classId` 后，在 **积分** 花名册点自己的姓名 → 交作业 / 加分请求；教师 `/admin` 审核。无班级码进入、无「我的」页。

## 安装包校验（填写本批哈希）

| 字段 | 值 |
|---|---|
| 文件名 | ClassroomDesk-Setup-_______.exe |
| SHA256 | ______________________________________ |
| 来源 | GitHub Actions artifact `classroom-desk-windows-setup` / 校内网盘路径 |
| 签名 | □ 已签名（CSC）　□ 未签名（预期可能有 SmartScreen） |

在教室机 PowerShell 校验：

```powershell
Get-FileHash .\ClassroomDesk-Setup-0.1.0.exe -Algorithm SHA256
```

与网盘旁 `.sha256` 文件或 Actions 日志中的 `sha256 ...` 行对照，不一致则**不要安装**。

## 长期

申请代码签名证书 → 仓库 Secrets `CSC_LINK` + `CSC_KEY_PASSWORD` → 重打签名包，SmartScreen 显著减少。

网盘留档约定见 [NAS_RELEASES.md](./NAS_RELEASES.md)。  
教师机当服务器、学生机互联见 [CLASSROOM_TEACHER_HOST.md](./CLASSROOM_TEACHER_HOST.md)。
