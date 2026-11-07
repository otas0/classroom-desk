import { Router } from 'express';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { chunkIds, parseIdList, sqlInPlaceholders } from '../utils/bulkIds.js';
import { currentMonth, localMonthRange, monthRange } from '../utils/csv.js';
import { parseFormat, sendTableExport } from '../utils/exportFormats.js';

export const exportsRouter = Router();

exportsRouter.get(
  '/api/v1/exports/attendance',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req, res) => {
    const month = String(req.query.month ?? currentMonth());
    const format = parseFormat(req.query.format);
    const classId = String(req.query.classId ?? '');
    let range: { start: string; end: string };
    try {
      range = localMonthRange(month);
    } catch {
      res.status(400).json({ error: 'invalid_month' });
      return;
    }

    const sessionId = String(req.query.sessionId ?? '').trim();
    let sql = `SELECT c.name AS className, u.display_name AS studentName, u.student_no AS studentNo,
                s.id AS sessionId, s.mode AS sessionMode, s.start_at AS sessionStart,
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
    if (sessionId) {
      sql += ` AND s.id = ?`;
      params.push(sessionId);
    }
    sql += ` ORDER BY COALESCE(r.checked_at, s.start_at)`;

    const rows = openDb().prepare(sql).all(...params) as Array<Record<string, string>>;
    const fileSuffix = sessionId ? `session-${sessionId.slice(0, 8)}` : month;
    sendTableExport(res, {
      format,
      filenameBase: `attendance-${fileSuffix}`,
      headers: ['班级', '学生', '学号', '场次', '场次开始', '签到模式', '签到时间', '状态', '来源', '备注'],
      rows: rows.map((r) => [
        r.className,
        r.studentName,
        r.studentNo,
        r.sessionId,
        r.sessionStart,
        r.sessionMode,
        r.checkedAt,
        r.status,
        r.source,
        r.remark,
      ]),
    });
  },
);

/**
 * Per-session roster exceptions: 缺勤 / 请假 / 迟到 as separate columns (and xlsx sheets).
 * 「本场缺勤名单」仍可用：汇总表含未到与请假；迟到单独分列/分表。
 */
exportsRouter.get(
  '/api/v1/exports/attendance-absent',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req, res) => {
    const format = parseFormat(req.query.format);
    const classId = String(req.query.classId ?? '').trim();
    const sessionId = String(req.query.sessionId ?? '').trim();
    if (!classId || !sessionId) {
      res.status(400).json({ error: 'class_id_and_session_id_required' });
      return;
    }
    const db = openDb();
    const sess = db
      .prepare(
        `SELECT id, start_at AS startAt, status, mode FROM attendance_sessions
         WHERE id = ? AND class_id = ?`,
      )
      .get(sessionId, classId) as
      | { id: string; startAt: string; status: string; mode: string }
      | undefined;
    if (!sess) {
      res.status(404).json({ error: 'session_not_found' });
      return;
    }
    const students = db
      .prepare(
        `SELECT id, display_name AS displayName, student_no AS studentNo FROM users
         WHERE role = 'student' AND class_id = ?
           AND (deleted_at IS NULL OR deleted_at = '')
         ORDER BY student_no, display_name`,
      )
      .all(classId) as Array<{ id: string; displayName: string; studentNo: string | null }>;
    const statusByStudent = new Map(
      (
        db
          .prepare(
            `SELECT student_id AS studentId, status FROM attendance_records WHERE session_id = ?`,
          )
          .all(sessionId) as Array<{ studentId: string; status: string }>
      ).map((r) => [r.studentId, r.status]),
    );

    type Row = Array<string | number | null>;
    const headers = ['学号', '姓名', '缺勤', '请假', '迟到', '原始状态', '场次开始', '场次状态', '签到模式'];
    const summaryRows: Row[] = [];
    const absentRows: Row[] = [];
    const leaveRows: Row[] = [];
    const lateRows: Row[] = [];

    for (const s of students) {
      const st = statusByStudent.get(s.id) ?? 'absent';
      if (st === 'present') continue;
      const isAbsent = st === 'absent' || !statusByStudent.has(s.id);
      const isLeave = st === 'leave';
      const isLate = st === 'late';
      const row: Row = [
        s.studentNo,
        s.displayName,
        isAbsent ? '是' : '',
        isLeave ? '是' : '',
        isLate ? '是' : '',
        st,
        sess.startAt,
        sess.status,
        sess.mode,
      ];
      summaryRows.push(row);
      if (isAbsent) absentRows.push(row);
      if (isLeave) leaveRows.push(row);
      if (isLate) lateRows.push(row);
    }

    sendTableExport(res, {
      format,
      filenameBase: `attendance-absent-${sessionId.slice(0, 8)}`,
      headers,
      rows: summaryRows,
      sheets:
        format === 'xlsx'
          ? [
              { name: '汇总', headers, rows: summaryRows },
              { name: '缺勤', headers, rows: absentRows },
              { name: '请假', headers, rows: leaveRows },
              { name: '迟到', headers, rows: lateRows },
            ]
          : undefined,
    });
  },
);

exportsRouter.get(
  '/api/v1/exports/attendance-summary',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
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
      range = localMonthRange(month);
    } catch {
      res.status(400).json({ error: 'invalid_month' });
      return;
    }
    const db = openDb();
    const sessionId = String(req.query.sessionId ?? '').trim();
    const sessionCount = sessionId
      ? 1
      : (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM attendance_sessions WHERE class_id = ? AND start_at >= ? AND start_at < ?`,
            )
            .get(classId, range.start, range.end) as { c: number }
        ).c;
    const students = db
      .prepare(
        `SELECT id, display_name AS displayName, student_no AS studentNo FROM users
         WHERE role = 'student' AND class_id = ?
           AND (deleted_at IS NULL OR deleted_at = '')
         ORDER BY student_no, display_name`,
      )
      .all(classId) as Array<{ id: string; displayName: string; studentNo: string | null }>;

    const rows = students.map((s) => {
      let c: number;
      if (sessionId) {
        c = (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM attendance_records r
               WHERE r.student_id = ? AND r.session_id = ?
                 AND r.status IN ('present','late')`,
            )
            .get(s.id, sessionId) as { c: number }
        ).c;
      } else {
        c = (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM attendance_records r
               JOIN attendance_sessions sess ON sess.id = r.session_id
               WHERE r.student_id = ? AND sess.class_id = ? AND sess.start_at >= ? AND sess.start_at < ?
                 AND r.status IN ('present','late')`,
            )
            .get(s.id, classId, range.start, range.end) as { c: number }
        ).c;
      }
      const rate = sessionCount > 0 ? ((c / sessionCount) * 100).toFixed(1) + '%' : '0%';
      return [s.displayName, s.studentNo, c, sessionCount, rate];
    });

    const fileSuffix = sessionId ? `session-${sessionId.slice(0, 8)}` : month;
    sendTableExport(res, {
      format,
      filenameBase: `attendance-summary-${fileSuffix}`,
      headers: sessionId
        ? ['学生', '学号', '本场出勤', '场次数', '出勤率']
        : ['学生', '学号', '本月出勤次数', '本月场次数', '出勤率'],
      rows,
    });
  },
);

exportsRouter.get(
  '/api/v1/exports/points',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
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
  requireRoles('teacher', 'admin', 'assistant'),
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
           AND (q.deleted_at IS NULL OR q.deleted_at = '')
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

/** Export only selected students (POST body: { classId, ids, format }). */
exportsRouter.post(
  '/api/v1/exports/students-selected',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req: AuthedRequest, res) => {
    const classId = String(req.body?.classId ?? '').trim();
    const ids = parseIdList(req.body?.ids, 500);
    const format = parseFormat(req.body?.format ?? req.query.format);
    if (!classId) {
      res.status(400).json({ error: 'class_id_required' });
      return;
    }
    if (ids.length === 0) {
      res.status(400).json({ error: 'ids_required', message: '请选择要导出的学生' });
      return;
    }
    const db = openDb();
    const rows: Array<Record<string, string | number | null>> = [];
    for (const chunk of chunkIds(ids)) {
      const ph = sqlInPlaceholders(chunk.length);
      const part = db
        .prepare(
          `SELECT display_name AS displayName, student_no AS studentNo, total_points AS totalPoints
           FROM users
           WHERE role = 'student' AND class_id = ?
             AND (deleted_at IS NULL OR deleted_at = '')
             AND id IN (${ph})
           ORDER BY student_no, display_name`,
        )
        .all(classId, ...chunk) as Array<Record<string, string | number | null>>;
      rows.push(...part);
    }
    sendTableExport(res, {
      format,
      filenameBase: `students-selected-${classId.slice(0, 8)}`,
      headers: ['姓名', '学号', '积分'],
      rows: rows.map((r) => [r.displayName, r.studentNo, r.totalPoints]),
    });
  },
);

/** Export only selected questions (POST body: { classId, ids, format }). */
exportsRouter.post(
  '/api/v1/exports/questions-selected',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req: AuthedRequest, res) => {
    const classId = String(req.body?.classId ?? '').trim();
    const ids = parseIdList(req.body?.ids, 200);
    const format = parseFormat(req.body?.format ?? req.query.format);
    if (!classId) {
      res.status(400).json({ error: 'class_id_required' });
      return;
    }
    if (ids.length === 0) {
      res.status(400).json({ error: 'ids_required', message: '请选择要导出的题目' });
      return;
    }
    const db = openDb();
    const rows: Array<Record<string, string | number>> = [];
    for (const chunk of chunkIds(ids)) {
      const ph = sqlInPlaceholders(chunk.length);
      const part = db
        .prepare(
          `SELECT q.title, q.type, COALESCE(e.answered_count,0) AS answered,
                  COALESCE(e.wrong_count,0) AS wrong, COALESCE(e.error_rate,0) AS errorRate
           FROM questions q
           LEFT JOIN error_stats e ON e.question_id = q.id
           WHERE q.class_id = ? AND q.id IN (${ph})
             AND (q.deleted_at IS NULL OR q.deleted_at = '')
           ORDER BY q.created_at DESC`,
        )
        .all(classId, ...chunk) as Array<Record<string, string | number>>;
      rows.push(...part);
    }
    sendTableExport(res, {
      format,
      filenameBase: `questions-selected-${classId.slice(0, 8)}`,
      headers: ['题目', '类型', '作答数', '错误数', '错误率'],
      rows: rows.map((r) => [r.title, r.type, r.answered, r.wrong, r.errorRate]),
    });
  },
);
