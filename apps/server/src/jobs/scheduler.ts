import { openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import {
  cleanupDailyPointRequests,
  cleanupExpiredPointRequests,
  shouldRunDailyCleanup,
} from '../services/cleanup.js';
import { openScheduledAttendanceSessions } from '../services/attendanceSchedule.js';
import { purgeExpiredSoftDeletes } from '../services/audit.js';
import { flushAuditRetryQueue } from '../services/auditRetry.js';
import { runDbBackup, shouldRunDailyBackup } from '../services/backup.js';
import { takeFleetDriftSnapshot } from '../services/fleetDrift.js';
import { purgeExpiredInputLocks } from '../services/inputLock.js';
import { broadcastInputLock } from '../services/inputLockHub.js';
import { nowIso } from '../utils/id.js';

let timer: NodeJS.Timeout | null = null;
let lastDriftSnapshotAt = 0;

function autoCloseQuestions(): number {
  const db = openDb();
  const now = nowIso();
  const info = db
    .prepare(
      `UPDATE questions
       SET closed_at = ?
       WHERE closes_at IS NOT NULL
         AND closes_at != ''
         AND closes_at <= ?
         AND (closed_at IS NULL OR closed_at = '')`,
    )
    .run(now, now);
  return Number(info.changes ?? 0);
}

function maybeDailyBackup(): void {
  const db = openDb();
  const last = getSetting(db, 'last_auto_backup_at');
  if (!shouldRunDailyBackup(last && last.length > 0 ? last : null)) return;
  const result = runDbBackup();
  if (result.ok) {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('last_auto_backup_at', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(nowIso());
    console.log(`[backup] auto wrote ${result.path} (keep ${result.kept})`);
  } else {
    console.error(`[backup] auto failed: ${result.error}`);
  }
}

export function startCleanupScheduler(): void {
  if (timer) return;

  const tick = () => {
    const db = openDb();
    try {
      const expiredRemoved = cleanupExpiredPointRequests(db);
      if (expiredRemoved > 0) {
        console.log(`[cleanup] expired point requests removed: ${expiredRemoved}`);
      }
      if (shouldRunDailyCleanup(db)) {
        const dailyRemoved = cleanupDailyPointRequests(db);
        console.log(`[cleanup] daily wipe removed: ${dailyRemoved}`);
      }
      const opened = openScheduledAttendanceSessions(db);
      if (opened > 0) {
        console.log(`[attendance] opened scheduled sessions: ${opened}`);
      }
      const closed = autoCloseQuestions();
      if (closed > 0) {
        console.log(`[questions] auto-closed: ${closed}`);
      }
      const purged = purgeExpiredSoftDeletes(db);
      if (purged.students > 0 || purged.questions > 0) {
        console.log(
          `[recycle] purged soft-deletes students=${purged.students} questions=${purged.questions}`,
        );
      }
      try {
        const ttl = purgeExpiredInputLocks(db);
        if (ttl.purged) {
          broadcastInputLock(db);
          console.log('[input-lock] TTL expired → cleared + broadcast');
        }
      } catch (e) {
        console.error('[scheduler] input-lock TTL purge failed', e);
      }
      const auditFlush = flushAuditRetryQueue();
      if (auditFlush.flushed > 0 || auditFlush.remaining > 0 || auditFlush.failed > 0) {
        console.log(
          `[audit-retry] flushed=${auditFlush.flushed} remaining=${auditFlush.remaining} failed=${auditFlush.failed}`,
        );
      }
      maybeDailyBackup();
      const driftMins = Math.max(
        0,
        Math.min(1440, Math.trunc(Number(getSetting(db, 'fleet_drift_snapshot_minutes') ?? 5) || 0)),
      );
      if (driftMins > 0 && Date.now() - lastDriftSnapshotAt >= driftMins * 60_000) {
        lastDriftSnapshotAt = Date.now();
        try {
          takeFleetDriftSnapshot({ intervalMinutes: driftMins });
        } catch (e) {
          console.error('[scheduler] drift snapshot failed', e);
        }
      }
    } catch (error) {
      console.error('[scheduler] failed', error);
    }
  };

  tick();
  timer = setInterval(tick, 30_000);
  timer.unref?.();
}

export function stopCleanupScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Mark scheduler drift clock so a manual snapshot does not double-fire immediately. */
export function markFleetDriftSnapshotTaken(): void {
  lastDriftSnapshotAt = Date.now();
}
