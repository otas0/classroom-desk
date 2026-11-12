import type { DatabaseSync } from 'node:sqlite';
import { getSetting } from '../db/migrate.js';
import { writeAudit } from './audit.js';

export function isEasyJoinAutoOff(db: DatabaseSync): boolean {
  return (getSetting(db, 'student_easy_join_auto_off') ?? '1') === '1';
}

export function isEasyJoinEnabled(db: DatabaseSync): boolean {
  return (getSetting(db, 'student_easy_join') ?? '0') === '1';
}

/** Turn off one-tap join (ghost podium after class). */
export function clearEasyJoin(
  db: DatabaseSync,
  meta?: { actorUserId?: string; actorRole?: string; clientIp?: string; reason?: string },
): boolean {
  const wasOn = isEasyJoinEnabled(db);
  if (!wasOn && !(getSetting(db, 'student_easy_join_class_id') ?? '').trim()) return false;
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('student_easy_join', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run('0');
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('student_easy_join_class_id', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run('');
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('student_easy_join_opened_at', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run('');
  writeAudit({
    actorUserId: meta?.actorUserId,
    actorRole: meta?.actorRole,
    action: 'settings.student_easy_join',
    detail: {
      studentEasyJoin: false,
      classId: null,
      reason: meta?.reason ?? 'clear',
    },
    clientIp: meta?.clientIp,
  });
  return true;
}

/** If auto-off is enabled, clear easy-join. Returns whether it was cleared. */
export function maybeAutoOffEasyJoin(
  db: DatabaseSync,
  meta?: { actorUserId?: string; actorRole?: string; clientIp?: string; reason?: string },
): boolean {
  if (!isEasyJoinAutoOff(db)) return false;
  return clearEasyJoin(db, meta);
}
