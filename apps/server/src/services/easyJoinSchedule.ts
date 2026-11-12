/**
 * Tie easy-join open/close to attendance schedules (optional).
 * When student_easy_join_follow_schedule=1 and a schedule is open for the
 * configured class, ensure easy-join is on; when all windows end, auto-off.
 */
import type { DatabaseSync } from 'node:sqlite';
import { getSetting } from '../db/migrate.js';
import { clearEasyJoin } from './easyJoin.js';
import { writeAudit } from './audit.js';

function localWeekday(d = new Date()): number {
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function hmNow(d = new Date()): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type ScheduleRow = {
  class_id: string;
  weekdays: string;
  start_time: string;
  end_time: string;
  enabled: number;
};

export function syncEasyJoinToSchedules(db: DatabaseSync, now = new Date()): {
  opened: boolean;
  closed: boolean;
  classId: string | null;
} {
  if ((getSetting(db, 'student_easy_join_follow_schedule') ?? '0') !== '1') {
    return { opened: false, closed: false, classId: null };
  }
  const weekday = localWeekday(now);
  const hm = hmNow(now);
  const schedules = db
    .prepare(`SELECT class_id, weekdays, start_time, end_time, enabled FROM attendance_schedules WHERE enabled = 1`)
    .all() as ScheduleRow[];

  let activeClass: string | null = null;
  for (const s of schedules) {
    let days: number[] = [];
    try {
      days = JSON.parse(s.weekdays) as number[];
    } catch {
      continue;
    }
    if (!days.includes(weekday)) continue;
    if (hm >= s.start_time && hm <= s.end_time) {
      activeClass = s.class_id;
      break;
    }
  }

  const currentlyOn = (getSetting(db, 'student_easy_join') ?? '0') === '1';
  const currentClass = String(getSetting(db, 'student_easy_join_class_id') ?? '').trim();

  if (activeClass) {
    if (!currentlyOn || currentClass !== activeClass) {
      db.prepare(
        `INSERT INTO settings (key, value) VALUES ('student_easy_join', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run('1');
      db.prepare(
        `INSERT INTO settings (key, value) VALUES ('student_easy_join_class_id', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(activeClass);
      const openedAt = now.toISOString();
      db.prepare(
        `INSERT INTO settings (key, value) VALUES ('student_easy_join_opened_at', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(openedAt);
      writeAudit({
        actorUserId: null,
        actorRole: 'system',
        action: 'settings.student_easy_join',
        detail: { studentEasyJoin: true, classId: activeClass, reason: 'schedule_open' },
      });
      return { opened: true, closed: false, classId: activeClass };
    }
    return { opened: false, closed: false, classId: activeClass };
  }

  if (currentlyOn) {
    clearEasyJoin(db, { reason: 'schedule_end' });
    return { opened: false, closed: true, classId: currentClass || null };
  }
  return { opened: false, closed: false, classId: null };
}

/** Close easy-join when TTL minutes elapsed since opened_at. */
export function syncEasyJoinTtl(db: DatabaseSync, now = new Date()): boolean {
  const ttlMin = Number(getSetting(db, 'student_easy_join_ttl_minutes') ?? 0);
  if (!Number.isFinite(ttlMin) || ttlMin <= 0) return false;
  if ((getSetting(db, 'student_easy_join') ?? '0') !== '1') return false;
  const openedAt = String(getSetting(db, 'student_easy_join_opened_at') ?? '').trim();
  const t = Date.parse(openedAt);
  if (!Number.isFinite(t)) return false;
  if (now.getTime() - t < ttlMin * 60_000) return false;
  clearEasyJoin(db, { reason: 'ttl_expired' });
  return true;
}
