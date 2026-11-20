import { Router } from 'express';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import {
  daySummary,
  listDaySummaries,
  punch,
  recordPresence,
  reviewOvertime,
  workDateFor,
} from '../services/time.js';
import { writeAudit } from '../services/auth.js';

export const timeRouter = Router();

timeRouter.use(requireAuth);

timeRouter.get('/today', (req: AuthedRequest, res) => {
  const date = workDateFor(new Date().toISOString());
  res.json({ summary: daySummary(req.user!.id, date) });
});

timeRouter.post('/clock-in', (req: AuthedRequest, res) => {
  try {
    const result = punch({ userId: req.user!.id, kind: 'clock_in', note: req.body?.note });
    writeAudit('time.clock_in', result, req.user);
    res.status(201).json({
      punch: result,
      summary: daySummary(req.user!.id, result.workDate),
    });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

timeRouter.post('/clock-out', (req: AuthedRequest, res) => {
  try {
    const result = punch({ userId: req.user!.id, kind: 'clock_out', note: req.body?.note });
    writeAudit('time.clock_out', result, req.user);
    res.status(201).json({
      punch: result,
      summary: daySummary(req.user!.id, result.workDate),
    });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

timeRouter.post('/presence', (req: AuthedRequest, res) => {
  const ip = req.ip || req.socket.remoteAddress || null;
  recordPresence(req.user!.id, ip);
  const date = workDateFor(new Date().toISOString());
  res.json({ summary: daySummary(req.user!.id, date) });
});

timeRouter.get('/day/:date', requireRoles('admin', 'manager'), (req: AuthedRequest, res) => {
  const date = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'invalid_date' });
    return;
  }
  const departmentId =
    req.user!.role === 'manager'
      ? req.user!.departmentId
      : typeof req.query.departmentId === 'string'
        ? req.query.departmentId
        : null;
  res.json({ date, summaries: listDaySummaries(date, departmentId) });
});

timeRouter.post(
  '/overtime/:userId/:date/review',
  requireRoles('admin', 'manager'),
  (req: AuthedRequest, res) => {
    const status = req.body?.status;
    if (status !== 'confirmed' && status !== 'rejected') {
      res.status(400).json({ error: 'invalid_status' });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) {
      res.status(400).json({ error: 'invalid_date' });
      return;
    }
    try {
      reviewOvertime({
        userId: req.params.userId,
        workDate: req.params.date,
        status,
        reviewerId: req.user!.id,
        note: req.body?.note,
      });
      writeAudit(
        'time.overtime_review',
        { userId: req.params.userId, date: req.params.date, status },
        req.user,
      );
      res.json({ summary: daySummary(req.params.userId, req.params.date) });
    } catch (err) {
      const e = err as Error & { status?: number };
      res.status(e.status ?? 500).json({ error: e.message });
    }
  },
);
