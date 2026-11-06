import { Router } from 'express';
import { openDb, withTransaction } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { cleanupExpiredPointRequests } from '../services/cleanup.js';
import { addPoints } from '../services/points.js';
import { config } from '../config.js';
import { newId, nowIso } from '../utils/id.js';
import { paramId } from '../utils/params.js';

export const pointRequestsRouter = Router();

function getTtlMinutes(db: ReturnType<typeof openDb>): number {
  const raw = Number(getSetting(db, 'point_request_ttl_minutes') ?? config.defaultPointRequestTtlMinutes);
  return Math.min(
    config.maxPointRequestTtlMinutes,
    Math.max(config.minPointRequestTtlMinutes, Number.isFinite(raw) ? raw : 60),
  );
}

function withCountdown<T extends { expires_at?: string; expiresAt?: string; created_at?: string; createdAt?: string }>(
  row: T,
) {
  const expiresAt = row.expiresAt ?? row.expires_at ?? '';
  const ms = new Date(expiresAt).getTime() - Date.now();
  return {
    ...row,
    expiresAt,
    countdownSeconds: Math.max(0, Math.floor(ms / 1000)),
  };
}

pointRequestsRouter.post('/api/v1/point-requests', requireAuth, requireRoles('student'), (req: AuthedRequest, res) => {
  const db = openDb();
  cleanupExpiredPointRequests(db);

  if (!req.user?.classId) {
    res.status(400).json({ error: 'class_required' });
    return;
  }
  const reason = String(req.body?.reason ?? '').trim();
  const category = String(req.body?.category ?? '').trim() || 'other';
  const points = Number(req.body?.points ?? 1);
  if (!Number.isFinite(points) || points === 0) {
    res.status(400).json({ error: 'invalid_request', message: '分值无效' });
    return;
  }

  const ttl = getTtlMinutes(db);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ttl * 60_000);
  const id = newId();

  db.prepare(
    `INSERT INTO point_requests
      (id, student_id, class_id, reason, category, status, created_at, expires_at, confirmed_by, confirmed_at, points)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, ?)`,
  ).run(id, req.user.id, req.user.classId, reason, category, createdAt.toISOString(), expiresAt.toISOString(), points);

  res.status(201).json(
    withCountdown({
      id,
      status: 'pending',
      reason,
      category,
      points,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }),
  );
});

pointRequestsRouter.get('/api/v1/point-requests/pending', requireAuth, (req: AuthedRequest, res) => {
  const db = openDb();
  cleanupExpiredPointRequests(db);

  const now = nowIso();
  if (req.user?.role === 'student') {
    const items = db
      .prepare(
        `SELECT id, reason, category, status, points, created_at AS createdAt, expires_at AS expiresAt
         FROM point_requests
         WHERE student_id = ? AND status = 'pending' AND expires_at >= ?
         ORDER BY created_at DESC`,
      )
      .all(req.user.id, now)
      .map((row) => withCountdown(row as { expiresAt: string }));
    res.json({ items });
    return;
  }

  const classId = String(req.query.classId ?? '');
  const items = db
    .prepare(
      `SELECT pr.id, pr.student_id AS studentId, u.display_name AS studentName, pr.reason, pr.category,
              pr.status, pr.points, pr.created_at AS createdAt, pr.expires_at AS expiresAt, pr.class_id AS classId
       FROM point_requests pr
       JOIN users u ON u.id = pr.student_id
       WHERE pr.status = 'pending' AND pr.expires_at >= ?
         AND (? = '' OR pr.class_id = ?)
       ORDER BY pr.created_at ASC`,
    )
    .all(now, classId, classId)
    .map((row) => withCountdown(row as { expiresAt: string }));
  res.json({ items });
});

pointRequestsRouter.post(
  '/api/v1/point-requests/:id/confirm',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const db = openDb();
    cleanupExpiredPointRequests(db);

    try {
      withTransaction(db, () => {
        const row = db.prepare(`SELECT * FROM point_requests WHERE id = ?`).get(paramId(req.params.id)) as
          | {
              id: string;
              student_id: string;
              class_id: string;
              reason: string;
              status: string;
              expires_at: string;
              points: number;
            }
          | undefined;
        if (!row) throw new Error('not_found');
        if (row.status !== 'pending') throw new Error('not_pending');
        if (new Date(row.expires_at).getTime() < Date.now()) {
          db.prepare(`DELETE FROM point_requests WHERE id = ?`).run(row.id);
          throw new Error('expired');
        }

        const awarded = addPoints(db, {
          studentId: row.student_id,
          classId: row.class_id,
          points: row.points,
          reasonSummary: row.reason.slice(0, 120),
          source: 'request',
          mode: 'manual',
          requestId: row.id,
          createdBy: req.user!.id,
          idempotencyKey: `point-request:${row.id}`,
        });
        if (!awarded.ok) throw new Error('duplicate');

        // After confirm, wipe personal reason text from request row by deleting it (points_log keeps summary).
        db.prepare(`DELETE FROM point_requests WHERE id = ?`).run(row.id);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'error';
      const status =
        message === 'not_found' || message === 'expired'
          ? 404
          : message === 'not_pending' || message === 'duplicate'
            ? 409
            : 500;
      res.status(status).json({ error: message });
      return;
    }

    res.json({ ok: true });
  },
);

pointRequestsRouter.post(
  '/api/v1/point-requests/:id/reject',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const db = openDb();
    const row = db.prepare(`SELECT id, status FROM point_requests WHERE id = ?`).get(paramId(req.params.id)) as
      | { id: string; status: string }
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    // Physical delete of request content on reject.
    db.prepare(`DELETE FROM point_requests WHERE id = ?`).run(row.id);
    res.json({ ok: true, deleted: true });
  },
);
