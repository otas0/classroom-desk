#!/usr/bin/env bash
# Backup classroom.db (and WAL companions if present).
# Optionally sync a copy to a school NAS / network drive.
#
# Example cron (daily 01:30):
#   30 1 * * * /path/to/classroom-desk/scripts/backup-db.sh >> /var/log/classroom-desk-backup.log 2>&1
#
# Env:
#   CLASSROOM_DESK_DATA_DIR      local data dir (default apps/server/data)
#   CLASSROOM_DESK_BACKUP_DIR    local backup dir (default $DATA_DIR/backups)
#   CLASSROOM_DESK_NAS_DIR       optional mounted school share, e.g. /Volumes/SchoolNAS/classroom-desk
#   CLASSROOM_DESK_BACKUP_KEEP_DAYS  local retention (default 14)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${CLASSROOM_DESK_DATA_DIR:-$ROOT_DIR/apps/server/data}"
BACKUP_DIR="${CLASSROOM_DESK_BACKUP_DIR:-$DATA_DIR/backups}"
NAS_DIR="${CLASSROOM_DESK_NAS_DIR:-}"
STAMP="$(date +%Y%m%d-%H%M%S)"
KEEP_DAYS="${CLASSROOM_DESK_BACKUP_KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

if [[ ! -f "$DATA_DIR/classroom.db" ]]; then
  echo "[backup] no database at $DATA_DIR/classroom.db"
  exit 1
fi

DEST="$BACKUP_DIR/classroom-$STAMP.db"
cp -p "$DATA_DIR/classroom.db" "$DEST"
[[ -f "$DATA_DIR/classroom.db-wal" ]] && cp -p "$DATA_DIR/classroom.db-wal" "$DEST-wal" || true
[[ -f "$DATA_DIR/classroom.db-shm" ]] && cp -p "$DATA_DIR/classroom.db-shm" "$DEST-shm" || true

find "$BACKUP_DIR" -name 'classroom-*.db' -type f -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true

echo "[backup] wrote $DEST"

if [[ -n "$NAS_DIR" ]]; then
  if [[ ! -d "$NAS_DIR" ]]; then
    echo "[backup] NAS dir missing or not mounted: $NAS_DIR" >&2
    exit 2
  fi
  mkdir -p "$NAS_DIR"
  cp -p "$DEST" "$NAS_DIR/"
  [[ -f "$DEST-wal" ]] && cp -p "$DEST-wal" "$NAS_DIR/" || true
  [[ -f "$DEST-shm" ]] && cp -p "$DEST-shm" "$NAS_DIR/" || true
  echo "[backup] synced to NAS $NAS_DIR"
fi
