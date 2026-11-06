import { Router } from 'express';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { currentMonth, monthRange, toCsv } from '../utils/csv.js';

export const exportsRouter = Router();

exportsRouter.get(
  '/api/v1/exports/attendance',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req, res) => {
    const month = String(req.query.month ?? currentMonth());
    let range: { start: string; end: string };
    try {
      range = monthRange(month);
    } catch {
      res.status(400).json({ error: 'invalid_month' });
      return;
    }

    const rows = openDb()
      .prepare(
        `SELECT c.name AS className, u.display_name AS studentName, s.id AS sessionId, s.mode AS sessionMode,
                r.checked_at AS checkedAt, r.status, r.source, r.remark
         FROM attendance_records r
         JOIN attendance_sessions s ON s.id = r.session_id
         JOIN classes c ON c.id = s.class_id
         JOIN users u ON u.id = r.student_id
         WHERE COALESCE(r.checked_at, s.start_at) >= ? AND COALESCE(r.checked_at, s.start_at) < ?
         ORDER BY COALESCE(r.checked_at, s.start_at)`,
      )
      .all(range.start, range.end) as Array<Record<string, string>>;

    const csv = toCsv(
      ['班级', '学生', '场次', '签到模式', '签到时间', '状态', '来源', '备注'],
      rows.map((r) => [
        r.className,
        r.studentName,
        r.sessionId,
        r.sessionMode,
        r.checkedAt,
        r.status,
        r.source,
        r.remark,
      ]),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${month}.csv"`);
    res.send('\uFEFF' + csv);
  },
);

exportsRouter.get(
  '/api/v1/exports/points',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req, res) => {
    const month = String(req.query.month ?? currentMonth());
    const mode = String(req.query.mode ?? '');
    const source = String(req.query.source ?? '');
    let range: { start: string; end: string };
    try {
      range = monthRange(month);
    } catch {
      res.status(400).json({ error: 'invalid_month' });
      return;
    }

    let sql = `
      SELECT c.name AS className, u.display_name AS studentName, p.points, p.source, p.mode,
             t.display_name AS teacherName, p.created_at AS confirmedAt, p.reason_summary AS reasonSummary
      FROM points_log p
      JOIN classes c ON c.id = p.class_id
      JOIN users u ON u.id = p.student_id
      LEFT JOIN users t ON t.id = p.created_by
      WHERE p.created_at >= ? AND p.created_at < ?`;
    const params: string[] = [range.start, range.end];
    if (mode === 'auto' || mode === 'manual') {
      sql += ` AND p.mode = ?`;
      params.push(mode);
    }
    if (source === 'request' || source === 'manual' || source === 'auto_rule') {
      sql += ` AND p.source = ?`;
      params.push(source);
    }
    sql += ` ORDER BY p.created_at`;

    const rows = openDb().prepare(sql).all(...params) as Array<Record<string, string | number>>;
    const csv = toCsv(
      ['班级', '学生', '加分分值', '来源', '模式', '确认教师', '确认时间', '备注摘要'],
      rows.map((r) => [
        r.className,
        r.studentName,
        r.points,
        r.source,
        r.mode,
        r.teacherName,
        r.confirmedAt,
        r.reasonSummary,
      ]),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="points-${month}.csv"`);
    res.send('\uFEFF' + csv);
  },
);
