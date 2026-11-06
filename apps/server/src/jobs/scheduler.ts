import { openDb } from '../db/client.js';
import {
  cleanupDailyPointRequests,
  cleanupExpiredPointRequests,
  shouldRunDailyCleanup,
} from '../services/cleanup.js';
import { openScheduledAttendanceSessions } from '../services/attendanceSchedule.js';

let timer: NodeJS.Timeout | null = null;

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
