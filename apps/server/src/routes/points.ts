import { Router } from 'express';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { assistantMayAward } from '../services/assistantGrants.js';
import { addPoints } from '../services/points.js';
import {
  currentMonth,
  localMonthRange,
  localSemesterRange,
  localWeekRange,
} from '../utils/csv.js';
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

  const period = String(req.query.period ?? '').trim().toLowerCase();
  let range: { start: string; end: string };
  let label: string;
  let periodOut: string;

  if (period === 'week') {
    const w = localWeekRange();
    range = { start: w.start, end: w.end };
    label = w.label;
    periodOut = 'week';
  } else if (period === 'semester' || period === 'term') {
    const s = localSemesterRange();
    range = { start: s.start, end: s.end };
    label = s.label;
    periodOut = 'semester';
  } else {
    const month = String(req.query.month ?? '').trim() || currentMonth();
    try {
      range = localMonthRange(month);
    } catch {
      res.status(400).json({ error: 'invalid_month', message: '月份格式应为 YYYY-MM' });
      return;
    }
    label = month;
    periodOut = 'month';
  }

  const db = openDb();
  const teacher = req.user?.role === 'teacher' || req.user?.role === 'admin';
  const rows = db
    .prepare(
      `SELECT u.id, u.display_name AS displayName, u.student_no AS studentNo,
              COALESCE(SUM(pl.points), 0) AS periodPoints,
              u.total_points AS totalPoints
       FROM users u
       LEFT JOIN points_log pl
         ON pl.student_id = u.id
        AND pl.class_id = u.class_id
        AND pl.created_at >= ? AND pl.created_at < ?
       WHERE u.role = 'student' AND u.class_id = ?
       GROUP BY u.id
       ORDER BY periodPoints DESC, u.student_no COLLATE NOCASE, u.display_name COLLATE NOCASE`,
    )
    .all(range.start, range.end, classId) as Array<{
    id: string;
    displayName: string;
    studentNo: string | null;
    periodPoints: number;
    totalPoints: number;
  }>;

  const ranked = rows.map((r, i) => ({
    id: r.id,
    displayName: r.displayName,
    studentNo: r.studentNo,
    monthPoints: Number(r.periodPoints),
    periodPoints: Number(r.periodPoints),
    totalPoints: Number(r.totalPoints),
    rank: i + 1,
  }));

  const meId = req.user?.id;
  const mine = meId ? ranked.find((r) => r.id === meId) : undefined;

  if (!teacher) {
    res.json({
      period: periodOut,
      month: label,
      label,
      rosterTotal: ranked.length,
      myRank: mine?.rank ?? null,
      myMonthPoints: mine?.periodPoints ?? 0,
      myPeriodPoints: mine?.periodPoints ?? 0,
      myTotalPoints: mine?.totalPoints ?? 0,
      items: [],
    });
    return;
  }

  res.json({
    period: periodOut,
    month: label,
    label,
    rosterTotal: ranked.length,
    items: ranked.slice(0, 80),
    myRank: mine?.rank ?? null,
    myMonthPoints: mine?.periodPoints ?? null,
    myPeriodPoints: mine?.periodPoints ?? null,
  });
});

pointsRouter.post(
  '/api/v1/points/manual',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req: AuthedRequest, res) => {
  const studentId = String(req.body?.studentId ?? '');
  const classId = String(req.body?.classId ?? '');
  const points = Number(req.body?.points ?? 0);
  const reasonSummary = String(req.body?.reasonSummary ?? '').trim() || '教师手动加分';
  if (!studentId || !classId || !Number.isFinite(points) || points === 0) {
    res.status(400).json({ error: 'invalid_points' });
    return;
  }
  if (!assistantMayAward(req.user, classId)) {
    res.status(403).json({
      error: 'award_grant_required',
      message: '助教未获本班加分授权（请教师在设置中按班勾选「可加分」）',
    });
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
