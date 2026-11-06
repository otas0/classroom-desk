import { Router } from 'express';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { currentMonth, monthRange } from '../utils/csv.js';
import { parseFormat, sendTableExport } from '../utils/exportFormats.js';

export const exportsRouter = Router();

exportsRouter.get(
  '/api/v1/exports/attendance',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req, res) => {
    const month = String(req.query.month ?? currentMonth());
    const format = parseFormat(req.query.format);
    const classId = String(req.query.classId ?? '');
    let range: { start: string; end: string };
    try {
      range = monthRange(month);
    } catch {
      res.status(400).json({ error: 'invalid_month' });
      return;
    }

    let sql = `SELECT c.name AS className, u.display_name AS studentName, u.student_no AS studentNo,
                s.id AS sessionId, s.mode AS sessionMode,
                r.checked_at AS checkedAt, r.status, r.source, r.remark
         FROM attendance_records r
         JOIN attendance_sessions s ON s.id = r.session_id
         JOIN classes c ON c.id = s.class_id
         JOIN users u ON u.id = r.student_id
         WHERE COALESCE(r.checked_at, s.start_at) >= ? AND COALESCE(r.checked_at, s.start_at) < ?`;
    const params: string[] = [range.start, range.end];
    if (classId) {
      sql += ` AND s.class_id = ?`;
      params.push(classId);
    }
    sql += ` ORDER BY COALESCE(r.checked_at, s.start_at)`;

    const rows = openDb().prepare(sql).all(...params) as Array<Record<string, string>>;
    sendTableExport(res, {
      format,
      filenameBase: `attendance-${month}`,
      headers: ['班级', '学生', '学号', '场次', '签到模式', '签到时间', '状态', '来源', '备注'],
      rows: rows.map((r) => [
        r.className,
        r.studentName,
        r.studentNo,
        r.sessionId,
        r.sessionMode,
        r.checkedAt,
        r.status,
        r.source,
        r.remark,
      ]),
    });
  },
);

exportsRouter.get(
  '/api/v1/exports/attendance-summary',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req, res) => {
    const month = String(req.query.month ?? currentMonth());
    const format = parseFormat(req.query.format);
    const classId = String(req.query.classId ?? '');
    if (!classId) {
      res.status(400).json({ error: 'class_id_required' });
      return;
    }
    let range: { start: string; end: string };
    try {
      range = monthRange(month);
    } catch {
      res.status(400).json({ error: 'invalid_month' });
      return;
    }
    const db = openDb();
    const sessionCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM attendance_sessions WHERE class_id = ? AND start_at >= ? AND start_at < ?`,
        )
        .get(classId, range.start, range.end) as { c: number }
    ).c;
    const students = db
      .prepare(
        `SELECT id, display_name AS displayName, student_no AS studentNo FROM users
         WHERE role = 'student' AND class_id = ? ORDER BY student_no, display_name`,
      )
      .all(classId) as Array<{ id: string; displayName: string; studentNo: string | null }>;

    const rows = students.map((s) => {
      const c = (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM attendance_records r
             JOIN attendance_sessions sess ON sess.id = r.session_id
             WHERE r.student_id = ? AND sess.class_id = ? AND sess.start_at >= ? AND sess.start_at < ?
               AND r.status IN ('present','late')`,
          )
          .get(s.id, classId, range.start, range.end) as { c: number }
      ).c;
      const rate = sessionCount > 0 ? ((c / sessionCount) * 100).toFixed(1) + '%' : '0%';
      return [s.displayName, s.studentNo, c, sessionCount, rate];
    });

    sendTableExport(res, {
      format,
      filenameBase: `attendance-summary-${month}`,
      headers: ['学生', '学号', '本月出勤次数', '本月场次数', '出勤率'],
      rows,
    });
  },
);

exportsRouter.get(
  '/api/v1/exports/points',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req, res) => {
    const month = String(req.query.month ?? currentMonth());
    const format = parseFormat(req.query.format);
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
      SELECT c.name AS className, u.display_name AS studentName, u.student_no AS studentNo, p.points, p.source, p.mode,
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
    sendTableExport(res, {
      format,
      filenameBase: `points-${month}`,
      headers: ['班级', '学生', '学号', '加分分值', '来源', '模式', '确认教师', '确认时间', '备注摘要'],
      rows: rows.map((r) => [
        r.className,
        r.studentName,
        r.studentNo,
        r.points,
        r.source,
        r.mode,
        r.teacherName,
        r.confirmedAt,
        r.reasonSummary,
      ]),
    });
  },
);

exportsRouter.get(
  '/api/v1/exports/questions',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req, res) => {
    const format = parseFormat(req.query.format);
    const classId = String(req.query.classId ?? '');
    if (!classId) {
      res.status(400).json({ error: 'class_id_required' });
      return;
    }
    const rows = openDb()
      .prepare(
        `SELECT q.title, q.type, COALESCE(e.answered_count,0) AS answered,
                COALESCE(e.wrong_count,0) AS wrong, COALESCE(e.error_rate,0) AS errorRate
         FROM questions q
         LEFT JOIN error_stats e ON e.question_id = q.id
         WHERE q.class_id = ?
         ORDER BY q.created_at DESC`,
      )
      .all(classId) as Array<Record<string, string | number>>;
    sendTableExport(res, {
      format,
      filenameBase: `questions-${classId.slice(0, 8)}`,
      headers: ['题目', '类型', '作答数', '错误数', '错误率'],
      rows: rows.map((r) => [r.title, r.type, r.answered, r.wrong, r.errorRate]),
    });
  },
);
