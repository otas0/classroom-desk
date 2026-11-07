import { Router } from 'express';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';

export const assistantGrantsRouter = Router();

assistantGrantsRouter.get(
  '/api/v1/auth/assistants/:id/grants',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req, res) => {
    const assistantId = String(req.params.id);
    const items = openDb()
      .prepare(
        `SELECT class_id AS classId, can_export AS canExport, can_award_points AS canAwardPoints
         FROM assistant_class_grants WHERE assistant_id = ?`,
      )
      .all(assistantId);
    res.json({ items });
  },
);

assistantGrantsRouter.put(
  '/api/v1/auth/assistants/:id/grants',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const assistantId = String(req.params.id);
    const grants = Array.isArray(req.body?.grants) ? req.body.grants : [];
    const db = openDb();
    const asst = db
      .prepare(`SELECT id FROM users WHERE id = ? AND role = 'assistant'`)
      .get(assistantId);
    if (!asst) {
      res.status(404).json({ error: 'assistant_not_found' });
      return;
    }
    db.prepare(`DELETE FROM assistant_class_grants WHERE assistant_id = ?`).run(assistantId);
    const ins = db.prepare(
      `INSERT INTO assistant_class_grants (assistant_id, class_id, can_export, can_award_points)
       VALUES (?, ?, ?, ?)`,
    );
    for (const g of grants as Array<{ classId: string; canExport?: boolean; canAwardPoints?: boolean }>) {
      const classId = String(g.classId ?? '').trim();
      if (!classId) continue;
      ins.run(assistantId, classId, g.canExport === false ? 0 : 1, g.canAwardPoints ? 1 : 0);
    }
    res.json({ ok: true });
  },
);

/** Assistants: list my class grants (export / award). Empty = legacy all-classes read. */
assistantGrantsRouter.get(
  '/api/v1/auth/me/grants',
  requireAuth,
  requireRoles('assistant'),
  (req: AuthedRequest, res) => {
    const items = openDb()
      .prepare(
        `SELECT class_id AS classId, can_export AS canExport, can_award_points AS canAwardPoints
         FROM assistant_class_grants WHERE assistant_id = ?`,
      )
      .all(req.user!.id);
    res.json({
      items,
      note:
        items.length === 0
          ? '未配置按班授权时沿用全局助教只读；配置后仅所列班级可导出/加分'
          : '已启用按班授权',
    });
  },
);
