import { Router } from 'express';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { addPoints } from '../services/points.js';
import { newId } from '../utils/id.js';

export const pointsRouter = Router();

pointsRouter.get('/api/v1/points/me', requireAuth, requireRoles('student'), (req: AuthedRequest, res) => {
  const db = openDb();
  const user = db.prepare(`SELECT total_points AS totalPoints FROM users WHERE id = ?`).get(req.user!.id) as {
    totalPoints: number;
  };
  const log = db
    .prepare(
      `SELECT id, points, reason_summary AS reasonSummary, source, mode, created_at AS createdAt
       FROM points_log WHERE student_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .all(req.user!.id);
  res.json({ totalPoints: user.totalPoints, items: log });
});

pointsRouter.get('/api/v1/points/leaderboard', requireAuth, (req: AuthedRequest, res) => {
  const classId = String(req.query.classId ?? req.user?.classId ?? '');
  if (!classId) {
    res.status(400).json({ error: 'class_id_required' });
    return;
  }
  const items = openDb()
    .prepare(
      `SELECT id, display_name AS displayName, total_points AS totalPoints
       FROM users WHERE role = 'student' AND class_id = ?
       ORDER BY total_points DESC, display_name ASC LIMIT 50`,
    )
    .all(classId);
  res.json({ items });
});

pointsRouter.post('/api/v1/points/manual', requireAuth, requireRoles('teacher', 'admin'), (req: AuthedRequest, res) => {
  const studentId = String(req.body?.studentId ?? '');
  const classId = String(req.body?.classId ?? '');
  const points = Number(req.body?.points ?? 0);
  const reasonSummary = String(req.body?.reasonSummary ?? '').trim() || '教师手动加分';
  if (!studentId || !classId || !Number.isFinite(points) || points === 0) {
    res.status(400).json({ error: 'invalid_points' });
    return;
  }
  const idempotencyKey = String(req.body?.idempotencyKey ?? `manual:${studentId}:${newId()}`);
  const result = addPoints(openDb(), {
    studentId,
    classId,
    points,
    reasonSummary,
    source: 'manual',
    mode: 'manual',
    createdBy: req.user!.id,
    idempotencyKey,
  });
  if (!result.ok) {
    res.status(409).json({ error: 'duplicate' });
    return;
  }
  res.status(201).json({ id: result.id });
});
