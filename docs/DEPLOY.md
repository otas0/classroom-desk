# Production checklist

**教室从 GitHub 安装（教师机 + 学生机 · 无优盘）：** [SETUP_FROM_GITHUB.md](./SETUP_FROM_GITHUB.md)

## Secrets & bootstrap

1. Set a strong `JWT_SECRET` (≥32 random bytes); rotate by redeploying with a new value (invalidates all sessions).
2. Set `ADMIN_PASSWORD` / `TEACHER_PASSWORD` only on first boot; change via app/settings afterward; do not leave demo passwords.
3. Prefer env injection (systemd `EnvironmentFile`, Docker secrets); never commit `.env`.

## HTTPS & reverse proxy

1. Terminate TLS at nginx/Caddy; proxy to `127.0.0.1:8787`.
2. Teacher UI: `https://classroom.example/admin/` (Express serves `teacher-web/dist`).
3. Students set `apiBase` to `https://classroom.example` (no trailing slash).

## SQLite permissions

1. Run the service as a dedicated user; data dir mode `750`, `classroom.db` `640`.
2. Keep `CLASSROOM_DESK_DATA_DIR` on local disk (not NFS) for WAL reliability.
3. Exclude live `*.db-wal`/`*.db-shm` from ad-hoc copies; use `npm run backup:db`.

## Backups & NAS

1. Mount school share, set `CLASSROOM_DESK_NAS_DIR`.
2. Cron daily (see `scripts/install-backup-cron.example.sh`); default local+NAS retention `CLASSROOM_DESK_BACKUP_KEEP_DAYS=14`.
3. Confirm `/health` → `backup.latestAt` / `ageHours` after first run.

## Windows client signing

1. Repo secrets: `CSC_LINK` (pfx path or base64), `CSC_KEY_PASSWORD`.
2. Push to `main` → `windows-pack` uploads `classroom-desk-windows-setup` artifact (`apps/student-desktop/release/*.exe`).
3. Without secrets, CI builds unsigned (`signExecutable=false`); SmartScreen may warn.

## Ops webhook（Slack / 飞书）

1. GitHub repo **Settings → Secrets and variables → Actions** 新增 `CLASSROOM_DESK_OPS_WEBHOOK`（Slack Incoming Webhook 或飞书自定义机器人 URL）。
2. Release `record-artifacts` 失败时会 POST 机房频道；详见 [ARTIFACTS.md](./ARTIFACTS.md)。

## systemd unit example

`/etc/classroom-desk.env`（权限 `640`，属主 `root:classroom`）:

```bash
JWT_SECRET=replace-me
ADMIN_PASSWORD=
TEACHER_PASSWORD=
DEFAULT_CLASS_CODE=DEMO01
CLASSROOM_DESK_DATA_DIR=/var/lib/classroom-desk
CLASSROOM_DESK_NAS_DIR=/mnt/school-nas/classroom-desk
CLASSROOM_DESK_BACKUP_KEEP_DAYS=14
PORT=8787
HOST=127.0.0.1
```

`/etc/systemd/system/classroom-desk.service`:

```ini
[Unit]
Description=Classroom Desk API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=classroom
Group=classroom
# 按学校预发机实际路径修改，例如 /srv/classroom-desk 或 /home/classroom/app
WorkingDirectory=/opt/classroom-desk
EnvironmentFile=/etc/classroom-desk.env
# 若用绝对 node：ExecStart=/usr/bin/node /opt/classroom-desk/apps/server/dist/index.js
ExecStart=/usr/bin/npm run start --workspace=@classroom-desk/server
Restart=on-failure
RestartSec=5
# Harden a bit
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

预发机清单：

1. 建用户 `classroom`，数据目录 `/var/lib/classroom-desk`（750）。
2. 克隆仓库到 `WorkingDirectory`（与 unit 一致），`npm ci`，**`npm run fonts:cjk`**（第一次家长 PDF / 离线部署之前的硬步骤，把 NotoSansSC 放到 `apps/server/assets/fonts/`），`npm run build:teacher`。
3. 写 `/etc/classroom-desk.env`，`systemctl enable --now classroom-desk`。
4. 挂载网盘 → `CLASSROOM_DESK_NAS_DIR`；`bash scripts/install-backup-cron.example.sh`。
5. 人为断 NAS 跑一次 backup，确认 `curl /health` 含 `backup.lastError`。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now classroom-desk
# Cron: bash scripts/install-backup-cron.example.sh
```

## Post-install smoke

1. Install NSIS package on a lab PC; set `apiBase` to classroom server.
2. Student join → submit homework; teacher `/admin` review → points update.
3. `curl -fsS https://…/health` shows `ok` and recent backup (`backup.lastError` should be null).
