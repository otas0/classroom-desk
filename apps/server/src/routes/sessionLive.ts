import { Router } from 'express';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { broadcastBuzz } from '../services/buzzHub.js';
import { addPoints } from '../services/points.js';
import { newId, nowIso } from '../utils/id.js';

export const sessionLiveRouter = Router();

/** Close all open published questions for class + clear live pending expansions client-side. */
sessionLiveRouter.post(
  '/api/v1/session/reset',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = String(req.body?.classId ?? '').trim();
    if (!classId) {
      res.status(400).json({ error: 'class_id_required' });
      return;
    }
    const db = openDb();
    const now = nowIso();
    const r = db
      .prepare(
        `UPDATE questions SET closed_at = ?
         WHERE class_id = ? AND published = 1
           AND (closed_at IS NULL OR closed_at = '')
           AND COALESCE(archived, 0) = 0
           AND (deleted_at IS NULL OR deleted_at = '')`,
      )
      .run(now, classId);
    // Close open buzz rounds
    db.prepare(
      `UPDATE buzz_rounds SET status = 'closed', closed_at = ? WHERE class_id = ? AND status = 'open'`,
    ).run(now, classId);
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'session.reset',
      classId,
      detail: { closedQuestions: r.changes, at: now },
      clientIp: req.ip,
    });
    broadcastBuzz(classId);
    res.json({ ok: true, closedQuestions: r.changes, at: now });
  },
);

sessionLiveRouter.post(
  '/api/v1/session/buzz/open',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = String(req.body?.classId ?? '').trim();
    const reason = String(req.body?.reason ?? '抢答').trim().slice(0, 64) || '抢答';
    if (!classId) {
      res.status(400).json({ error: 'class_id_required' });
      return;
    }
    const db = openDb();
    const now = nowIso();
    db.prepare(
      `UPDATE buzz_rounds SET status = 'closed', closed_at = ? WHERE class_id = ? AND status = 'open'`,
    ).run(now, classId);
    const id = newId();
    db.prepare(
      `INSERT INTO buzz_rounds (id, class_id, status, opened_at, reason) VALUES (?, ?, 'open', ?, ?)`,
    ).run(id, classId, now, reason);
    broadcastBuzz(classId);
    res.status(201).json({ id, classId, status: 'open', openedAt: now, reason });
  },
);

sessionLiveRouter.get('/api/v1/session/buzz/current', requireAuth, (req: AuthedRequest, res) => {
  const classId = String(req.query.classId ?? req.user?.classId ?? '').trim();
  if (!classId) {
    res.status(400).json({ error: 'class_id_required' });
    return;
  }
  const db = openDb();
  const round = db
    .prepare(
      `SELECT id, class_id AS classId, status, opened_at AS openedAt, closed_at AS closedAt,
              winner_student_id AS winnerStudentId, reason
       FROM buzz_rounds WHERE class_id = ? ORDER BY opened_at DESC LIMIT 1`,
    )
    .get(classId) as
    | {
        id: string;
        classId: string;
        status: string;
        openedAt: string;
        closedAt: string | null;
        winnerStudentId: string | null;
        reason: string;
      }
    | undefined;
  if (!round) {
    res.json({ round: null, hits: [] });
    return;
  }
  const hits = db
    .prepare(
      `SELECT h.student_id AS studentId, h.hit_at AS hitAt, u.display_name AS displayName, u.student_no AS studentNo
       FROM buzz_hits h JOIN users u ON u.id = h.student_id
       WHERE h.round_id = ? ORDER BY h.hit_at ASC LIMIT 20`,
    )
    .all(round.id);
  res.json({ round, hits });
});

sessionLiveRouter.post(
  '/api/v1/session/buzz/hit',
  requireAuth,
  requireRoles('student'),
  (req: AuthedRequest, res) => {
    const classId = req.user?.classId;
    if (!classId) {
      res.status(400).json({ error: 'class_required' });
      return;
    }
    const db = openDb();
    const round = db
      .prepare(
        `SELECT id, reason FROM buzz_rounds WHERE class_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1`,
      )
      .get(classId) as { id: string; reason: string } | undefined;
    if (!round) {
      res.status(404).json({ error: 'no_open_round' });
      return;
    }
    const now = nowIso();
    try {
      db.prepare(`INSERT INTO buzz_hits (id, round_id, student_id, hit_at) VALUES (?, ?, ?, ?)`).run(
        newId(),
        round.id,
        req.user!.id,
        now,
      );
    } catch {
      res.status(409).json({ error: 'already_hit' });
      return;
    }
    const first = db
      .prepare(`SELECT student_id AS studentId FROM buzz_hits WHERE round_id = ? ORDER BY hit_at ASC LIMIT 1`)
      .get(round.id) as { studentId: string };
    if (first.studentId === req.user!.id) {
      db.prepare(`UPDATE buzz_rounds SET winner_student_id = ? WHERE id = ? AND winner_student_id IS NULL`).run(
        req.user!.id,
        round.id,
      );
    }
    const rank = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM buzz_hits WHERE round_id = ? AND hit_at <= ?`)
        .get(round.id, now) as { n: number }
    ).n;
    broadcastBuzz(classId);
    res.status(201).json({ ok: true, rank, roundId: round.id, reason: round.reason });
  },
);

sessionLiveRouter.post(
  '/api/v1/session/buzz/award-winner',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const roundId = String(req.body?.roundId ?? '').trim();
    const points = Math.max(1, Math.min(50, Number(req.body?.points ?? 1) || 1));
    const db = openDb();
    const round = db
      .prepare(
        `SELECT id, class_id AS classId, winner_student_id AS winnerStudentId, reason, status
         FROM buzz_rounds WHERE id = ?`,
      )
      .get(roundId) as
      | { id: string; classId: string; winnerStudentId: string | null; reason: string; status: string }
      | undefined;
    if (!round?.winnerStudentId) {
      res.status(400).json({ error: 'no_winner' });
      return;
    }
    addPoints(db, {
      studentId: round.winnerStudentId,
      classId: round.classId,
      points,
      reasonSummary: round.reason || '抢答',
      source: 'manual',
      mode: 'manual',
      createdBy: req.user!.id,
      idempotencyKey: `buzz:${round.id}:${round.winnerStudentId}`,
    });
    if (round.status === 'open') {
      db.prepare(`UPDATE buzz_rounds SET status = 'closed', closed_at = ? WHERE id = ?`).run(nowIso(), round.id);
    }
    broadcastBuzz(round.classId);
    res.json({ ok: true, studentId: round.winnerStudentId, points });
  },
);

/** Random pick one online (or any roster) student for call-out. */
sessionLiveRouter.post(
  '/api/v1/session/random-call',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = String(req.body?.classId ?? '').trim();
    const preferOnline = req.body?.preferOnline !== false;
    if (!classId) {
      res.status(400).json({ error: 'class_id_required' });
      return;
    }
    const db = openDb();
    const roster = db
      .prepare(
        `SELECT id, display_name AS displayName, student_no AS studentNo FROM users
         WHERE role = 'student' AND class_id = ?
           AND (deleted_at IS NULL OR deleted_at = '')`,
      )
      .all(classId) as Array<{ id: string; displayName: string; studentNo: string | null }>;
    if (!roster.length) {
      res.status(404).json({ error: 'empty_roster' });
      return;
    }
    let pool = roster;
    if (preferOnline) {
      const cutoff = new Date(Date.now() - 90_000).toISOString();
      const onlineIds = new Set(
        (
          db
            .prepare(
              `SELECT student_id AS id FROM presence_heartbeats WHERE class_id = ? AND last_seen_at >= ?`,
            )
            .all(classId, cutoff) as Array<{ id: string }>
        ).map((r) => r.id),
      );
      const online = roster.filter((s) => onlineIds.has(s.id));
      if (online.length) pool = online;
    }
    const picked = pool[Math.floor(Math.random() * pool.length)];
    res.json({ student: picked, poolSize: pool.length, preferOnline });
  },
);
