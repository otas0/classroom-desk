import { Router } from 'express';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { newId, nowIso } from '../utils/id.js';
import { paramId } from '../utils/params.js';

export const attendanceRouter = Router();

attendanceRouter.post(
  '/api/v1/attendance/sessions',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = String(req.body?.classId ?? '');
    const mode = String(req.body?.mode ?? 'manual');
    if (!classId || !['auto', 'manual'].includes(mode)) {
      res.status(400).json({ error: 'invalid_session' });
      return;
    }
    const startAt = String(req.body?.startAt ?? nowIso());
    const endAt = String(req.body?.endAt ?? new Date(Date.now() + 15 * 60_000).toISOString());
    const lateAfterMinutes = Number(req.body?.lateAfterMinutes ?? 5);
    const id = newId();
    const createdAt = nowIso();
    openDb()
      .prepare(
        `INSERT INTO attendance_sessions
          (id, class_id, mode, start_at, end_at, late_after_minutes, created_by, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(id, classId, mode, startAt, endAt, lateAfterMinutes, req.user!.id, createdAt);
    res.status(201).json({ id, classId, mode, startAt, endAt, lateAfterMinutes, status: 'open', createdAt });
  },
);

attendanceRouter.get('/api/v1/attendance/sessions', requireAuth, (req: AuthedRequest, res) => {
  const classId = String(req.query.classId ?? req.user?.classId ?? '');
  if (!classId) {
    res.status(400).json({ error: 'class_id_required' });
    return;
  }
  const items = openDb()
    .prepare(
      `SELECT id, class_id AS classId, mode, start_at AS startAt, end_at AS endAt,
              late_after_minutes AS lateAfterMinutes, status, created_at AS createdAt
       FROM attendance_sessions WHERE class_id = ? ORDER BY start_at DESC LIMIT 50`,
    )
    .all(classId);
  res.json({ items });
});

attendanceRouter.post('/api/v1/attendance/sessions/:id/check-in', requireAuth, requireRoles('student'), (req: AuthedRequest, res) => {
  const db = openDb();
  const session = db.prepare(`SELECT * FROM attendance_sessions WHERE id = ?`).get(paramId(req.params.id)) as
    | {
        id: string;
        class_id: string;
        mode: string;
        start_at: string;
        end_at: string;
        late_after_minutes: number;
        status: string;
      }
    | undefined;

  if (!session || session.status !== 'open') {
    res.status(404).json({ error: 'session_closed_or_missing' });
    return;
  }
  if (req.user?.classId !== session.class_id) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  const now = Date.now();
  const end = new Date(session.end_at).getTime();
  const start = new Date(session.start_at).getTime();
  if (now > end) {
    res.status(400).json({ error: 'session_ended', status: 'ended' });
    return;
  }

  const lateMs = session.late_after_minutes * 60_000;
  const status = now > start + lateMs ? 'late' : 'present';
  const checkedAt = nowIso();
  const id = newId();

  try {
    db.prepare(
      `INSERT INTO attendance_records
        (id, session_id, student_id, status, checked_at, source, remark, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, 'manual', '', NULL, NULL)`,
    ).run(id, session.id, req.user.id, status, checkedAt);
  } catch {
    res.status(409).json({ error: 'already_checked_in' });
    return;
  }

  res.status(201).json({ id, status, checkedAt, source: 'manual' });
});

attendanceRouter.post(
  '/api/v1/attendance/records',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const sessionId = String(req.body?.sessionId ?? '');
    const studentId = String(req.body?.studentId ?? '');
    const status = String(req.body?.status ?? '');
    if (!sessionId || !studentId || !['present', 'late', 'absent', 'leave'].includes(status)) {
      res.status(400).json({ error: 'invalid_record' });
      return;
    }
    const db = openDb();
    const existing = db
      .prepare(`SELECT id FROM attendance_records WHERE session_id = ? AND student_id = ?`)
      .get(sessionId, studentId) as { id: string } | undefined;
    const now = nowIso();
    if (existing) {
      db.prepare(
        `UPDATE attendance_records
         SET status = ?, source = 'teacher', remark = ?, updated_by = ?, updated_at = ?, checked_at = COALESCE(checked_at, ?)
         WHERE id = ?`,
      ).run(status, String(req.body?.remark ?? ''), req.user!.id, now, now, existing.id);
      res.json({ id: existing.id, status });
      return;
    }
    const id = newId();
    db.prepare(
      `INSERT INTO attendance_records
        (id, session_id, student_id, status, checked_at, source, remark, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, 'teacher', ?, ?, ?)`,
    ).run(id, sessionId, studentId, status, now, String(req.body?.remark ?? ''), req.user!.id, now);
    res.status(201).json({ id, status });
  },
);

attendanceRouter.get('/api/v1/attendance/records', requireAuth, (req: AuthedRequest, res) => {
  const db = openDb();
  const classId = String(req.query.classId ?? req.user?.classId ?? '');
  const studentId = String(req.query.studentId ?? '');
  const status = String(req.query.status ?? '');
  const date = String(req.query.date ?? '');

  let sql = `
    SELECT r.id, r.session_id AS sessionId, r.student_id AS studentId, u.display_name AS studentName,
           c.name AS className, s.mode AS sessionMode, r.status, r.checked_at AS checkedAt,
           r.source, r.remark, s.start_at AS sessionStart
    FROM attendance_records r
    JOIN attendance_sessions s ON s.id = r.session_id
    JOIN classes c ON c.id = s.class_id
    JOIN users u ON u.id = r.student_id
    WHERE 1=1`;
  const params: string[] = [];
  if (classId) {
    sql += ` AND s.class_id = ?`;
    params.push(classId);
  }
  if (studentId) {
    sql += ` AND r.student_id = ?`;
    params.push(studentId);
  }
  if (status) {
    sql += ` AND r.status = ?`;
    params.push(status);
  }
  if (date) {
    sql += ` AND substr(COALESCE(r.checked_at, s.start_at), 1, 10) = ?`;
    params.push(date);
  }
  if (req.user?.role === 'student') {
    sql += ` AND r.student_id = ?`;
    params.push(req.user.id);
  }
  sql += ` ORDER BY COALESCE(r.checked_at, s.start_at) DESC LIMIT 200`;
  res.json({ items: db.prepare(sql).all(...params) });
});

attendanceRouter.get('/api/v1/attendance/my-status', requireAuth, requireRoles('student'), (req: AuthedRequest, res) => {
  const db = openDb();
  const now = nowIso();
  const session = db
    .prepare(
      `SELECT id, mode, start_at AS startAt, end_at AS endAt, late_after_minutes AS lateAfterMinutes, status
       FROM attendance_sessions
       WHERE class_id = ? AND status = 'open' AND start_at <= ? AND end_at >= ?
       ORDER BY start_at DESC LIMIT 1`,
    )
    .get(req.user!.classId, now, now) as
    | {
        id: string;
        mode: string;
        startAt: string;
        endAt: string;
        lateAfterMinutes: number;
        status: string;
      }
    | undefined;

  if (!session) {
    res.json({ session: null, status: 'none' });
    return;
  }

  const record = db
    .prepare(
      `SELECT status, checked_at AS checkedAt, source FROM attendance_records WHERE session_id = ? AND student_id = ?`,
    )
    .get(session.id, req.user!.id) as { status: string; checkedAt: string; source: string } | undefined;

  if (record) {
    res.json({ session, status: record.status, record });
    return;
  }

  if (new Date(session.endAt).getTime() < Date.now()) {
    res.json({ session, status: 'ended' });
    return;
  }

  res.json({ session, status: 'absent' });
});

attendanceRouter.get(
  '/api/v1/attendance/schedules',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req, res) => {
    const classId = String(req.query.classId ?? '');
    if (!classId) {
      res.status(400).json({ error: 'class_id_required' });
      return;
    }
    const items = openDb()
      .prepare(
        `SELECT id, class_id AS classId, weekdays, start_time AS startTime, end_time AS endTime,
                late_after_minutes AS lateAfterMinutes, enabled, created_at AS createdAt
         FROM attendance_schedules WHERE class_id = ? ORDER BY start_time`,
      )
      .all(classId)
      .map((row) => {
        const r = row as { weekdays: string };
        let weekdays: number[] = [];
        try {
          weekdays = JSON.parse(r.weekdays) as number[];
        } catch {
          weekdays = [];
        }
        return { ...row, weekdays };
      });
    res.json({ items });
  },
);

attendanceRouter.post(
  '/api/v1/attendance/schedules',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = String(req.body?.classId ?? '');
    const weekdays = Array.isArray(req.body?.weekdays) ? req.body.weekdays.map(Number) : [];
    const startTime = String(req.body?.startTime ?? '');
    const endTime = String(req.body?.endTime ?? '');
    const lateAfterMinutes = Number(req.body?.lateAfterMinutes ?? 5);
    if (!classId || weekdays.length === 0 || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      res.status(400).json({ error: 'invalid_schedule' });
      return;
    }
    const id = newId();
    const createdAt = nowIso();
    openDb()
      .prepare(
        `INSERT INTO attendance_schedules
          (id, class_id, weekdays, start_time, end_time, late_after_minutes, enabled, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(id, classId, JSON.stringify(weekdays), startTime, endTime, lateAfterMinutes, req.user!.id, createdAt);
    res.status(201).json({
      id,
      classId,
      weekdays,
      startTime,
      endTime,
      lateAfterMinutes,
      enabled: 1,
      createdAt,
    });
  },
);

attendanceRouter.delete(
  '/api/v1/attendance/schedules/:id',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req, res) => {
    openDb().prepare(`DELETE FROM attendance_schedules WHERE id = ?`).run(paramId(req.params.id));
    res.json({ ok: true });
  },
);

attendanceRouter.get(
  '/api/v1/attendance/holidays',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req, res) => {
    const classId = String(req.query.classId ?? '');
    const items = openDb()
      .prepare(
        `SELECT id, class_id AS classId, holiday_date AS holidayDate, name, created_at AS createdAt
         FROM attendance_holidays
         WHERE class_id IS NULL OR class_id = ?
         ORDER BY holiday_date`,
      )
      .all(classId);
    res.json({ items });
  },
);

attendanceRouter.post(
  '/api/v1/attendance/holidays',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const holidayDate = String(req.body?.holidayDate ?? '');
    const name = String(req.body?.name ?? '节假日');
    const classId = req.body?.classId ? String(req.body.classId) : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holidayDate)) {
      res.status(400).json({ error: 'invalid_date' });
      return;
    }
    const id = newId();
    const createdAt = nowIso();
    try {
      openDb()
        .prepare(
          `INSERT INTO attendance_holidays (id, class_id, holiday_date, name, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, classId, holidayDate, name, createdAt);
    } catch {
      res.status(409).json({ error: 'holiday_exists' });
      return;
    }
    res.status(201).json({ id, classId, holidayDate, name, createdAt });
  },
);

attendanceRouter.post(
  '/api/v1/attendance/holidays/import',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = req.body?.classId ? String(req.body.classId) : null;
    const csvText = String(req.body?.csv ?? '');
    const lines = csvText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [date, ...rest] = line.split(',').map((p) => p.trim());
        return { holidayDate: date, name: rest.join(',') || '节假日' };
      })
      .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.holidayDate));

    if (lines.length === 0) {
      res.status(400).json({ error: 'empty_or_invalid_csv' });
      return;
    }

    const db = openDb();
    const insert = db.prepare(
      `INSERT INTO attendance_holidays (id, class_id, holiday_date, name, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    let created = 0;
    let skipped = 0;
    const createdAt = nowIso();
    for (const row of lines) {
      try {
        insert.run(newId(), classId, row.holidayDate, row.name, createdAt);
        created += 1;
      } catch {
        skipped += 1;
      }
    }
    res.status(201).json({ created, skipped, total: lines.length });
  },
);

attendanceRouter.delete(
  '/api/v1/attendance/holidays/:id',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req, res) => {
    openDb().prepare(`DELETE FROM attendance_holidays WHERE id = ?`).run(paramId(req.params.id));
    res.json({ ok: true });
  },
);
