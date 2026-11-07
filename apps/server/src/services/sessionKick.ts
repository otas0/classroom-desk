import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../db/client.js';
import { chunkIds, sqlInPlaceholders } from '../utils/bulkIds.js';
import { nowIso } from '../utils/id.js';

/** Clear presence and mark forced logout so student clients drop session ASAP. */
export function kickStudents(studentIds: string[], db: DatabaseSync = openDb()): number {
  if (studentIds.length === 0) return 0;
  const at = nowIso();
  let kicked = 0;
  for (const chunk of chunkIds(studentIds)) {
    const ph = sqlInPlaceholders(chunk.length);
    db.prepare(`DELETE FROM presence_heartbeats WHERE student_id IN (${ph})`).run(...chunk);
    const upsert = db.prepare(
      `INSERT INTO session_kicks (student_id, reason, created_at)
       VALUES (?, 'soft_deleted', ?)
       ON CONFLICT(student_id) DO UPDATE SET reason = excluded.reason, created_at = excluded.created_at`,
    );
    for (const id of chunk) {
      upsert.run(id, at);
      kicked += 1;
    }
  }
  return kicked;
}

export function clearSessionKick(studentId: string, db: DatabaseSync = openDb()): void {
  db.prepare(`DELETE FROM session_kicks WHERE student_id = ?`).run(studentId);
}

export function hasSessionKick(studentId: string, db: DatabaseSync = openDb()): boolean {
  const row = db.prepare(`SELECT student_id FROM session_kicks WHERE student_id = ?`).get(studentId);
  return Boolean(row);
}
