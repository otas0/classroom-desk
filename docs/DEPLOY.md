# Production checklist

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

## Post-install smoke

1. Install NSIS package on a lab PC; set `apiBase` to classroom server.
2. Student join → submit homework; teacher `/admin` review → points update.
3. `curl -fsS https://…/health` shows `ok` and recent backup.
