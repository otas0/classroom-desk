import type { DatabaseSync } from 'node:sqlite';
import { newId, nowIso } from '../utils/id.js';

type ScheduleRow = {
  id: string;
  class_id: string;
  weekdays: string;
  start_time: string;
  end_time: string;
  late_after_minutes: number;
  enabled: number;
  created_by: string;
};

/** Local weekday: Monday=1 ... Sunday=7 */
function localWeekday(d = new Date()): number {
  const js = d.getDay(); // 0 Sun
  return js === 0 ? 7 : js;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function todayLocalDate(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function hmNow(d = new Date()): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localDateTimeIso(date: string, hm: string): string {
  const [y, mo, day] = date.split('-').map(Number);
  const [h, m] = hm.split(':').map(Number);
  return new Date(y, mo - 1, day, h, m, 0, 0).toISOString();
}

/**
 * Open auto attendance sessions from enabled weekly schedules when inside the window.
 * Idempotent per schedule+date via session remark key in start_at uniqueness check.
 */
export function openScheduledAttendanceSessions(db: DatabaseSync, now = new Date()): number {
  const weekday = localWeekday(now);
  const date = todayLocalDate(now);
  const hm = hmNow(now);
  const schedules = db
    .prepare(`SELECT * FROM attendance_schedules WHERE enabled = 1`)
    .all() as ScheduleRow[];

  let opened = 0;
  for (const schedule of schedules) {
    let days: number[] = [];
    try {
      days = JSON.parse(schedule.weekdays) as number[];
    } catch {
      continue;
    }
    if (!days.includes(weekday)) continue;
    if (hm < schedule.start_time || hm > schedule.end_time) continue;

    const holiday = db
      .prepare(
        `SELECT id FROM attendance_holidays
         WHERE holiday_date = ?
           AND (class_id IS NULL OR class_id = ?)`,
      )
      .get(date, schedule.class_id);
    if (holiday) continue;

    const startAt = localDateTimeIso(date, schedule.start_time);
    const endAt = localDateTimeIso(date, schedule.end_time);

    const existing = db
      .prepare(
        `SELECT id FROM attendance_sessions
         WHERE class_id = ? AND mode = 'auto' AND start_at = ? AND end_at = ?`,
      )
      .get(schedule.class_id, startAt, endAt);
    if (existing) continue;

    db.prepare(
      `INSERT INTO attendance_sessions
        (id, class_id, mode, start_at, end_at, late_after_minutes, created_by, status, created_at)
       VALUES (?, ?, 'auto', ?, ?, ?, ?, 'open', ?)`,
    ).run(
      newId(),
      schedule.class_id,
      startAt,
      endAt,
      schedule.late_after_minutes,
      schedule.created_by,
      nowIso(),
    );
    opened += 1;
  }
  return opened;
}
