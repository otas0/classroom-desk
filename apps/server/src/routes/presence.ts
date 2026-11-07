import { Router } from 'express';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { newId, nowIso } from '../utils/id.js';

export const presenceRouter = Router();

const ONLINE_MS = 90_000;

/**
 * In-app presence heartbeat only — used for auto attendance + fleet version.
 * Does not capture screens, keyboard, camera, or other system activity.
 */
presenceRouter.post('/api/v1/presence/heartbeat', requireAuth, requireRoles('student'), (req: AuthedRequest, res) => {
  if (!req.user?.classId) {
    res.status(400).json({ error: 'class_required' });
    return;
  }
  const db = openDb();
  const now = nowIso();
  const clientVersion = String(req.body?.clientVersion ?? req.body?.version ?? '').trim().slice(0, 32);
  const clientPlatform = String(req.body?.clientPlatform ?? req.body?.platform ?? '').trim().slice(0, 64);
  db.prepare(
    `INSERT INTO presence_heartbeats (student_id, class_id, last_seen_at, client_version, client_platform)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(student_id) DO UPDATE SET
       class_id = excluded.class_id,
       last_seen_at = excluded.last_seen_at,
       client_version = excluded.client_version,
       client_platform = excluded.client_platform`,
  ).run(req.user.id, req.user.classId, now, clientVersion, clientPlatform);

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

/** Recent student desktops for a class (teacher checklist / version drift). */
presenceRouter.get(
  '/api/v1/presence/clients',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req: AuthedRequest, res) => {
    const classId = String(req.query.classId ?? '').trim();
    if (!classId) {
      res.status(400).json({ error: 'class_id_required' });
      return;
    }
    const sinceMs = Number(req.query.sinceMs ?? ONLINE_MS);
    const cutoff = new Date(Date.now() - (Number.isFinite(sinceMs) && sinceMs > 0 ? sinceMs : ONLINE_MS)).toISOString();
    const rows = openDb()
      .prepare(
        `SELECT p.student_id AS studentId, p.class_id AS classId, p.last_seen_at AS lastSeenAt,
                p.client_version AS clientVersion, p.client_platform AS clientPlatform,
                u.display_name AS displayName, u.student_no AS studentNo
         FROM presence_heartbeats p
         JOIN users u ON u.id = p.student_id
         WHERE p.class_id = ? AND p.last_seen_at >= ?
         ORDER BY p.last_seen_at DESC`,
      )
      .all(classId, cutoff) as Array<{
      studentId: string;
      classId: string;
      lastSeenAt: string;
      clientVersion: string;
      clientPlatform: string;
      displayName: string;
      studentNo: string | null;
    }>;
    const versions = [...new Set(rows.map((r) => r.clientVersion).filter(Boolean))];
    res.json({
      classId,
      onlineWindowMs: Number.isFinite(sinceMs) && sinceMs > 0 ? sinceMs : ONLINE_MS,
      count: rows.length,
      versions,
      items: rows,
    });
  },
);
