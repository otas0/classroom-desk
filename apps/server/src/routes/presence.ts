import { Router } from 'express';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { newId, nowIso } from '../utils/id.js';

export const presenceRouter = Router();

/**
 * In-app presence heartbeat only — used for auto attendance.
 * Does not capture screens, keyboard, camera, or other system activity.
 */
presenceRouter.post('/api/v1/presence/heartbeat', requireAuth, requireRoles('student'), (req: AuthedRequest, res) => {
  if (!req.user?.classId) {
    res.status(400).json({ error: 'class_required' });
    return;
  }
  const db = openDb();
  const now = nowIso();
  db.prepare(
    `INSERT INTO presence_heartbeats (student_id, class_id, last_seen_at)
     VALUES (?, ?, ?)
     ON CONFLICT(student_id) DO UPDATE SET class_id = excluded.class_id, last_seen_at = excluded.last_seen_at`,
  ).run(req.user.id, req.user.classId, now);

  // Auto check-in for open auto sessions if online during window.
  const sessions = db
    .prepare(
      `SELECT * FROM attendance_sessions
       WHERE class_id = ? AND mode = 'auto' AND status = 'open' AND start_at <= ? AND end_at >= ?`,
    )
    .all(req.user.classId, now, now) as Array<{
    id: string;
    start_at: string;
    late_after_minutes: number;
  }>;

  for (const session of sessions) {
    const existing = db
      .prepare(`SELECT id FROM attendance_records WHERE session_id = ? AND student_id = ?`)
      .get(session.id, req.user.id);
    if (existing) continue;
    const lateBoundary = new Date(session.start_at).getTime() + session.late_after_minutes * 60_000;
    const status = Date.now() > lateBoundary ? 'late' : 'present';
    db.prepare(
      `INSERT INTO attendance_records
        (id, session_id, student_id, status, checked_at, source, remark, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, 'auto', '', NULL, NULL)`,
    ).run(newId(), session.id, req.user.id, status, now);
  }

  res.json({ ok: true, at: now });
});
