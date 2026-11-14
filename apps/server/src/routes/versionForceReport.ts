import { Router } from 'express';
import { openDb } from '../db/client.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { upsertSetting } from '../services/exitLock.js';
import { getSetting } from '../db/migrate.js';

export const versionForceReportRouter = Router();

const KEY = 'version_force_failures';

type FailRow = {
  at: string;
  classId?: string;
  studentId?: string;
  errorCode: string;
  detail?: string;
};

versionForceReportRouter.post(
  '/api/v1/upgrades/force-failure',
  requireAuth,
  (req: AuthedRequest, res) => {
    const errorCode = String(req.body?.errorCode ?? req.body?.error ?? 'unknown').slice(0, 80);
    const classId = String(req.body?.classId ?? '').trim() || undefined;
    const studentId = String(req.body?.studentId ?? req.user?.id ?? '').trim() || undefined;
    const detail = String(req.body?.detail ?? '').slice(0, 400);
    const db = openDb();
    let rows: FailRow[] = [];
    try {
      rows = JSON.parse(getSetting(db, KEY) ?? '[]') as FailRow[];
    } catch {
      rows = [];
    }
    const row: FailRow = {
      at: new Date().toISOString(),
      classId,
      studentId,
      errorCode,
      detail,
    };
    rows.push(row);
    rows = rows.slice(-100);
    upsertSetting(db, KEY, JSON.stringify(rows));
    writeAudit({
      action: 'upgrades.force_failure',
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      classId,
      detail: { errorCode, studentId },
      clientIp: req.ip,
    });
    res.json({ ok: true });
  },
);

versionForceReportRouter.get(
  '/api/v1/upgrades/force-failures',
  requireAuth,
  (req: AuthedRequest, res) => {
    if (!['teacher', 'admin', 'assistant'].includes(String(req.user?.role))) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const classId = String(req.query.classId ?? '').trim();
    let rows: FailRow[] = [];
    try {
      rows = JSON.parse(getSetting(openDb(), KEY) ?? '[]') as FailRow[];
    } catch {
      rows = [];
    }
    if (classId) rows = rows.filter((r) => r.classId === classId);
    res.json({ items: rows.slice(-50).reverse() });
  },
);
