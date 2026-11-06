import type { DatabaseSync } from 'node:sqlite';
import { getSetting } from '../db/migrate.js';
import { newId, nowIso } from '../utils/id.js';

export function cleanupExpiredPointRequests(db: DatabaseSync): number {
  const now = nowIso();
  const expired = db
    .prepare(
      `SELECT id FROM point_requests
       WHERE status = 'pending' AND expires_at < ?`,
    )
    .all(now) as Array<{ id: string }>;

  if (expired.length === 0) {
    upsertLastCleanup(db, 'expired', now);
    return 0;
  }

  const del = db.prepare(`DELETE FROM point_requests WHERE id = ?`);
  for (const row of expired) del.run(row.id);

  db.prepare(
    `INSERT INTO cleanup_stats (id, cleanup_date, removed_count, kind, created_at)
     VALUES (?, ?, ?, 'expired', ?)`,
  ).run(newId(), now.slice(0, 10), expired.length, now);
  upsertLastCleanup(db, 'expired', now);

  return expired.length;
}

function upsertLastCleanup(db: DatabaseSync, kind: string, at: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('last_cleanup_at', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(at);
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('last_cleanup_kind', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(kind);
}

/** Physically delete all pending/expired requests (daily hard wipe). */
export function cleanupDailyPointRequests(db: DatabaseSync): number {
  const rows = db
    .prepare(
      `SELECT id FROM point_requests WHERE status IN ('pending', 'expired')`,
    )
    .all() as Array<{ id: string }>;

  if (rows.length === 0) {
    const emptyAt = nowIso();
    db.prepare(
      `INSERT INTO cleanup_stats (id, cleanup_date, removed_count, kind, created_at)
       VALUES (?, ?, 0, 'daily', ?)`,
    ).run(newId(), emptyAt.slice(0, 10), emptyAt);
    upsertLastCleanup(db, 'daily', emptyAt);
    return 0;
  }

  const del = db.prepare(`DELETE FROM point_requests WHERE id = ?`);
  for (const row of rows) del.run(row.id);

  const now = nowIso();
  db.prepare(
    `INSERT INTO cleanup_stats (id, cleanup_date, removed_count, kind, created_at)
     VALUES (?, ?, ?, 'daily', ?)`,
  ).run(newId(), now.slice(0, 10), rows.length, now);
  upsertLastCleanup(db, 'daily', now);

  return rows.length;
}

export function getDailyCleanupTime(db: DatabaseSync): string {
  return getSetting(db, 'point_request_daily_cleanup_time') ?? '02:00';
}

export function shouldRunDailyCleanup(db: DatabaseSync, now = new Date()): boolean {
  const time = getDailyCleanupTime(db);
  const [hh, mm] = time.split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return false;
  if (now.getHours() !== hh || now.getMinutes() !== mm) return false;

  const today = now.toISOString().slice(0, 10);
  const already = db
    .prepare(`SELECT id FROM cleanup_stats WHERE kind = 'daily' AND cleanup_date = ? LIMIT 1`)
    .get(today) as { id: string } | undefined;
  return !already;
}
