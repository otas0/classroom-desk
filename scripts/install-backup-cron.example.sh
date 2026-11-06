#!/usr/bin/env bash
# Example: install a daily 01:30 backup cron that syncs to school NAS.
# Copy, edit paths/env, then: bash scripts/install-backup-cron.example.sh
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NAS_DIR="${CLASSROOM_DESK_NAS_DIR:-/Volumes/SchoolNAS/classroom-desk}"
LOG="${CLASSROOM_DESK_BACKUP_LOG:-/var/log/classroom-desk-backup.log}"
LINE="30 1 * * * CLASSROOM_DESK_NAS_DIR=$NAS_DIR CLASSROOM_DESK_BACKUP_KEEP_DAYS=14 $ROOT_DIR/scripts/backup-db.sh >> $LOG 2>&1"
echo "Add this crontab line (crontab -e):"
echo "$LINE"
