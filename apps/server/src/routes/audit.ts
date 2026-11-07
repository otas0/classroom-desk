import { Router } from 'express';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { listAudit, listAuditActions } from '../services/audit.js';
import { parseFormat, sendTableExport, streamCsvExport } from '../utils/exportFormats.js';

export const auditRouter = Router();

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
