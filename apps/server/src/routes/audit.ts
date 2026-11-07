import { Router } from 'express';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { listAudit, listAuditActions, writeAudit } from '../services/audit.js';
import { parseFormat, sendTableExport, streamCsvExport } from '../utils/exportFormats.js';

export const auditRouter = Router();

const CLIENT_AUDIT_ACTIONS = new Set([
  'setup.scan_assign_cta',
  'setup.classroom_ready',
]);

auditRouter.get(
  '/api/v1/audit',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req: AuthedRequest, res) => {
    const classId = String(req.query.classId ?? '').trim() || undefined;
    const action = String(req.query.action ?? '').trim() || undefined;
    const limit = Number(req.query.limit ?? 100);
    res.json({
      items: listAudit({
        limit: Number.isFinite(limit) ? limit : 100,
        classId,
        action,
      }),
      actions: listAuditActions(),
    });
  },
);

/** Teacher SPA telemetry (扫码指派 CTA / 机房就绪时长). */
auditRouter.post(
  '/api/v1/audit/events',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req: AuthedRequest, res) => {
    const action = String(req.body?.action ?? '').trim();
    if (!CLIENT_AUDIT_ACTIONS.has(action)) {
      res.status(400).json({ error: 'invalid_action', allowed: [...CLIENT_AUDIT_ACTIONS] });
      return;
    }
    const classId = String(req.body?.classId ?? '').trim() || null;
    const detail =
      req.body?.detail && typeof req.body.detail === 'object'
        ? (req.body.detail as Record<string, unknown>)
        : { note: String(req.body?.detail ?? '') };
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action,
      classId,
      detail,
      clientIp: req.ip,
    });
    res.status(201).json({ ok: true });
  },
);

auditRouter.get(
  '/api/v1/audit/export',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req: AuthedRequest, res) => {
    const classId = String(req.query.classId ?? '').trim() || undefined;
    const action = String(req.query.action ?? '').trim() || undefined;
    const format = parseFormat(req.query.format);
    const items = listAudit({ limit: 500, classId, action });
    const headers = ['时间', '操作', '角色', '班级', '详情', 'IP'];
    const rows = items.map((a) => [
      String(a.createdAt ?? ''),
      String(a.action ?? ''),
      String(a.actorRole ?? ''),
      String(a.classId ?? ''),
      String(a.detail ?? ''),
      String(a.clientIp ?? ''),
    ]);
    if (format === 'csv' || format === 'tsv') {
      streamCsvExport(res, {
        format,
        filenameBase: 'audit',
        headers,
        rows,
      });
      return;
    }
    sendTableExport(res, { format, filenameBase: 'audit', headers, rows });
  },
);
