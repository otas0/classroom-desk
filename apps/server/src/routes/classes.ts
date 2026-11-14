import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { RECYCLE_RETENTION_DAYS, writeAudit } from '../services/audit.js';
import { recycleTiming } from '../utils/recycleRetention.js';
import { clearSessionKick, kickStudents } from '../services/sessionKick.js';
import {
  parseCsvToRows,
  parseSheetMatrixToRows,
  type ImportRow,
} from '../services/rosterParse.js';
import { chunkIds, parseIdList, sqlInPlaceholders } from '../utils/bulkIds.js';
import { newClassCode, newId, nowIso } from '../utils/id.js';
import { paramId } from '../utils/params.js';
import {
  PURGE_CHUNK_SLOW_MS,
  PURGE_STREAM_HINT_MIN,
  purgeChunkSize,
} from '../utils/purgeChunk.js';

export const classesRouter = Router();

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

type ImportFailure = {
  line: number;
  name: string;
  studentNo: string | null;
  reason: string;
  reasonText: string;
};

function parseSheetToRows(buffer: Buffer): ImportRow[] {
  // xlsx is a zip; reject obvious corrupt/non-Excel bytes early for readable ZH errors
  const isZip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  const isOle = buffer.length >= 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf;
  if (!isZip && !isOle) {
    throw new Error('corrupt_or_not_excel');
  }
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    throw new Error('corrupt_or_not_excel');
  }
  if (!wb.SheetNames?.length) {
    throw new Error('corrupt_or_not_excel');
  }
  const sheet = wb.Sheets[wb.SheetNames[0] ?? ''];
  if (!sheet) return [];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: true,
  }) as unknown[][];
  return parseSheetMatrixToRows(matrix);
}

function clearClassStudents(classId: string): number {
  const db = openDb();
  const info = db.prepare(`DELETE FROM users WHERE role = 'student' AND class_id = ?`).run(classId);
  return Number(info.changes ?? 0);
}

function importStudentRows(classId: string, rows: ImportRow[], opts?: { replace?: boolean }) {
  const db = openDb();
  let replaced = 0;
  if (opts?.replace) {
    replaced = clearClassStudents(classId);
  }
  let created = 0;
  let skipped = 0;
  const failures: ImportFailure[] = [];
  const createdAt = nowIso();
  const insert = db.prepare(
    `INSERT INTO users (id, role, display_name, username, password_hash, student_no, contact_email, contact_phone, class_id, total_points, created_at)
     VALUES (?, 'student', ?, NULL, NULL, ?, ?, ?, ?, 0, ?)`,
  );
  const existsByName = db.prepare(
    `SELECT id FROM users WHERE role = 'student' AND class_id = ? AND display_name = ? COLLATE NOCASE
     AND (deleted_at IS NULL OR deleted_at = '')`,
  );
  const existsByNo = db.prepare(
    `SELECT id FROM users WHERE role = 'student' AND class_id = ? AND student_no = ?
     AND (deleted_at IS NULL OR deleted_at = '')`,
  );

  for (const row of rows) {
    const { name, line } = row;
    // Auto-detect may omit studentNo; empty string means "column present but blank"
    const studentNo = row.studentNo === '' || row.studentNo == null ? null : row.studentNo;
    const nameOk = /^[\u4e00-\u9fffA-Za-z0-9·•\s._-]{1,40}$/.test(name);
    if (!nameOk) {
      skipped += 1;
      failures.push({
        line,
        name,
        studentNo,
        reason: 'invalid_name',
        reasonText: '姓名含非法字符或过长',
      });
      continue;
    }
    if (studentNo && !/^[A-Za-z0-9_-]{1,32}$/.test(studentNo)) {
      skipped += 1;
      failures.push({
        line,
        name,
        studentNo,
        reason: 'invalid_student_no',
        reasonText: '学号含非法字符（仅字母数字_-）',
      });
      continue;
    }
    if (existsByName.get(classId, name)) {
      skipped += 1;
      failures.push({
        line,
        name,
        studentNo,
        reason: 'duplicate_name',
        reasonText: '同名已存在',
      });
      continue;
    }
    if (studentNo && existsByNo.get(classId, studentNo)) {
      skipped += 1;
      failures.push({
        line,
        name,
        studentNo,
        reason: 'duplicate_student_no',
        reasonText: '学号已存在',
      });
      continue;
    }
    const contactEmail =
      row.contactEmail === '' || row.contactEmail == null ? null : String(row.contactEmail).trim();
    const contactPhone =
      row.contactPhone === '' || row.contactPhone == null ? null : String(row.contactPhone).trim();
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      skipped += 1;
      failures.push({
        line,
        name,
        studentNo,
        reason: 'invalid_email',
        reasonText: '邮箱格式无效',
      });
      continue;
    }
    insert.run(newId(), name, studentNo, contactEmail, contactPhone, classId, createdAt);
    created += 1;
  }

  return { created, skipped, replaced, total: rows.length, failures };
}

classesRouter.get('/api/v1/classes', requireAuth, requireRoles('teacher', 'admin', 'assistant'), (_req, res) => {
  const rows = openDb()
    .prepare(`SELECT id, name, class_code AS classCode, created_at AS createdAt FROM classes ORDER BY created_at DESC`)
    .all();
  res.json({ items: rows });
});

classesRouter.post('/api/v1/classes', requireAuth, requireRoles('teacher', 'admin'), (req: AuthedRequest, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) {
    res.status(400).json({ error: 'name_required' });
    return;
  }
  const id = newId();
  const classCode = String(req.body?.classCode ?? newClassCode())
    .trim()
    .toUpperCase();
  const createdAt = nowIso();
  const db = openDb();
  try {
    db.prepare(`INSERT INTO classes (id, name, class_code, created_at) VALUES (?, ?, ?, ?)`).run(
      id,
      name,
      classCode,
      createdAt,
    );
  } catch {
    res.status(409).json({ error: 'class_code_conflict' });
    return;
  }
  // Day-1 default: new class is immediately joinable (Find classroom / 一键连班).
  for (const [key, value] of [
    ['student_easy_join', '1'],
    ['student_easy_join_class_id', id],
    ['student_easy_join_opened_at', createdAt],
  ] as const) {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, value);
  }
  res.status(201).json({ id, name, classCode, createdAt, easyJoin: true });
});

/** Public roster for lab machines. When private_device_portal_only=1, BYOD must use /portal. */
classesRouter.get('/api/v1/classes/:id/roster', (req, res) => {
  const classId = paramId(req.params.id);
  const db = openDb();
  const portalOnly = getSetting(db, 'private_device_portal_only') === '1';
  const clientHint = String(req.query.client ?? req.headers['x-cd-client'] ?? '')
    .trim()
    .toLowerCase();
  // Lab Electron still allowed; browsers / byod blocked when flag on.
  if (portalOnly && clientHint !== 'lab-agent' && clientHint !== 'electron') {
    res.status(403).json({
      error: 'portal_required',
      message: '私人设备请走校园网门户认证，不开放公开名单点选',
      portalPath: '/portal',
    });
    return;
  }
  const klass = db
    .prepare(`SELECT id, name FROM classes WHERE id = ?`)
    .get(classId) as { id: string; name: string } | undefined;
  if (!klass) {
    res.status(404).json({ error: 'class_not_found' });
    return;
  }
  const items = db
    .prepare(
      `SELECT id, display_name AS displayName, student_no AS studentNo, total_points AS totalPoints,
              contact_email AS contactEmail, contact_phone AS contactPhone
       FROM users
       WHERE role = 'student' AND class_id = ?
         AND (deleted_at IS NULL OR deleted_at = '')
       ORDER BY display_name COLLATE NOCASE`,
    )
    .all(classId);
  res.json({ class: klass, items });
});

classesRouter.get(
  '/api/v1/classes/:id/students',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req, res) => {
    const students = openDb()
      .prepare(
        `SELECT id, display_name AS displayName, student_no AS studentNo, total_points AS totalPoints,
                contact_email AS contactEmail, contact_phone AS contactPhone, created_at AS createdAt
         FROM users
         WHERE role = 'student' AND class_id = ?
           AND (deleted_at IS NULL OR deleted_at = '')
         ORDER BY display_name`,
      )
      .all(paramId(req.params.id));
    res.json({ items: students });
  },
);

classesRouter.post(
  '/api/v1/classes/:id/students/import',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = paramId(req.params.id);
    const db = openDb();
    if (!db.prepare(`SELECT id FROM classes WHERE id = ?`).get(classId)) {
      res.status(404).json({ error: 'class_not_found' });
      return;
    }
    const rows = parseCsvToRows(String(req.body?.csv ?? ''));
    if (rows.length === 0) {
      res.status(400).json({ error: 'empty_csv' });
      return;
    }
    const replace = Boolean(req.body?.replace);
    res.status(201).json(importStudentRows(classId, rows, { replace }));
  },
);

classesRouter.post(
  '/api/v1/classes/:id/students/import-file',
  requireAuth,
  requireRoles('teacher', 'admin'),
  importUpload.single('file'),
  (req: AuthedRequest, res) => {
    const classId = paramId(req.params.id);
    const db = openDb();
    if (!db.prepare(`SELECT id FROM classes WHERE id = ?`).get(classId)) {
      res.status(404).json({ error: 'class_not_found' });
      return;
    }
    const file = req.file;
    if (!file?.buffer) {
      res.status(400).json({
        error: 'file_required',
        message: '未收到上传文件，请重新选择 Excel/CSV 后再试',
      });
      return;
    }
    const name = (file.originalname || '').toLowerCase();
    let rows: ImportRow[] = [];
    try {
      if (name.endsWith('.csv') || file.mimetype === 'text/csv') {
        rows = parseCsvToRows(file.buffer.toString('utf8'));
      } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        rows = parseSheetToRows(file.buffer);
      } else {
        res.status(400).json({
          error: 'unsupported_file_type',
          message: '仅支持 .xlsx / .xls / .csv，请检查文件后缀',
        });
        return;
      }
    } catch (err) {
      const corrupt = err instanceof Error && err.message === 'corrupt_or_not_excel';
      res.status(400).json({
        error: corrupt ? 'corrupt_file' : 'parse_failed',
        message: corrupt
          ? 'Excel 文件损坏或不是有效的 .xlsx/.xls，请用 WPS/Excel 另存后再导入'
          : '文件解析失败：可能不是有效表格、文件损坏或列名无法识别（需要「姓名」列）',
      });
      return;
    }
    if (rows.length === 0) {
      res.status(400).json({
        error: 'empty_sheet',
        message: '表格无有效数据行。请确认有表头「姓名」（学号可选）且至少一行学生',
      });
      return;
    }
    const replace =
      String(req.query.replace ?? '') === '1' ||
      String(req.body?.replace ?? '') === '1' ||
      String(req.body?.replace ?? '') === 'true';
    const result = importStudentRows(classId, rows, { replace });
    if (result.failures.length > 0 && result.created === 0 && result.skipped === 0) {
      res.status(400).json({
        error: 'import_all_failed',
        message: `全班导入失败（共 ${result.failures.length} 行）。请按行核对：${result.failures
          .slice(0, 8)
          .map((f) => `第${f.line}行 ${f.name}→${f.reasonText}`)
          .join('；')}${result.failures.length > 8 ? '…' : ''}`,
        ...result,
      });
      return;
    }
    res.status(201).json(result);
  },
);

classesRouter.post(
  '/api/v1/classes/:id/students',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = paramId(req.params.id);
    const db = openDb();
    if (!db.prepare(`SELECT id FROM classes WHERE id = ?`).get(classId)) {
      res.status(404).json({ error: 'class_not_found', message: '班级不存在' });
      return;
    }
    const displayName = String(req.body?.displayName ?? '').trim();
    const studentNoRaw = req.body?.studentNo;
    const studentNo =
      studentNoRaw === undefined || studentNoRaw === null
        ? null
        : String(studentNoRaw).trim() || null;
    const contactEmail = String(req.body?.contactEmail ?? '').trim() || null;
    const contactPhone = String(req.body?.contactPhone ?? '').trim() || null;

    if (!/^[\u4e00-\u9fffA-Za-z0-9·•\s._-]{1,40}$/.test(displayName)) {
      res.status(400).json({ error: 'invalid_name', message: '姓名含非法字符或过长' });
      return;
    }
    if (studentNo && !/^[A-Za-z0-9_-]{1,32}$/.test(studentNo)) {
      res.status(400).json({ error: 'invalid_student_no', message: '学号含非法字符（仅字母数字_-）' });
      return;
    }
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      res.status(400).json({ error: 'invalid_email', message: '邮箱格式无效' });
      return;
    }
    if (
      db
        .prepare(
          `SELECT id FROM users WHERE role = 'student' AND class_id = ? AND display_name = ? COLLATE NOCASE
           AND (deleted_at IS NULL OR deleted_at = '')`,
        )
        .get(classId, displayName)
    ) {
      res.status(409).json({ error: 'duplicate_name', message: '同名已存在' });
      return;
    }
    if (
      studentNo &&
      db
        .prepare(
          `SELECT id FROM users WHERE role = 'student' AND class_id = ? AND student_no = ?
           AND (deleted_at IS NULL OR deleted_at = '')`,
        )
        .get(classId, studentNo)
    ) {
      res.status(409).json({ error: 'duplicate_student_no', message: '学号已存在' });
      return;
    }

    const id = newId();
    const createdAt = nowIso();
    db.prepare(
      `INSERT INTO users (id, role, display_name, username, password_hash, student_no, contact_email, contact_phone, class_id, total_points, created_at)
       VALUES (?, 'student', ?, NULL, NULL, ?, ?, ?, ?, 0, ?)`,
    ).run(id, displayName, studentNo, contactEmail, contactPhone, classId, createdAt);
    res.status(201).json({
      id,
      displayName,
      studentNo,
      contactEmail,
      contactPhone,
      totalPoints: 0,
      createdAt,
    });
  },
);

classesRouter.get(
  '/api/v1/classes/:id/students/:studentId/impact',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req, res) => {
    const classId = paramId(req.params.id);
    const studentId = paramId(req.params.studentId);
    const db = openDb();
    const row = db
      .prepare(
        `SELECT id, display_name AS displayName FROM users
         WHERE id = ? AND role = 'student' AND class_id = ?`,
      )
      .get(studentId, classId) as { id: string; displayName: string } | undefined;
    if (!row) {
      res.status(404).json({ error: 'student_not_found', message: '学生不在本班名单中' });
      return;
    }
    const countOne = (sql: string) =>
      Number((db.prepare(sql).get(studentId) as { c: number }).c);
    const attendanceRecords = countOne(
      `SELECT COUNT(*) AS c FROM attendance_records WHERE student_id = ?`,
    );
    const pointsLog = countOne(`SELECT COUNT(*) AS c FROM points_log WHERE student_id = ?`);
    const answers = countOne(`SELECT COUNT(*) AS c FROM student_answers WHERE student_id = ?`);
    const messages = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM messages WHERE student_id = ? OR to_student_id = ?`,
          )
          .get(studentId, studentId) as { c: number }
      ).c,
    );
    const pointRequests = countOne(`SELECT COUNT(*) AS c FROM point_requests WHERE student_id = ?`);
    res.json({
      id: row.id,
      displayName: row.displayName,
      attendanceRecords,
      pointsLog,
      answers,
      messages,
      pointRequests,
      total: attendanceRecords + pointsLog + answers + messages + pointRequests,
    });
  },
);

classesRouter.patch(
  '/api/v1/classes/:id/students/:studentId',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = paramId(req.params.id);
    const studentId = paramId(req.params.studentId);
    const db = openDb();
    const row = db
      .prepare(
        `SELECT id, display_name AS displayName, student_no AS studentNo,
                contact_email AS contactEmail, contact_phone AS contactPhone
         FROM users WHERE id = ? AND role = 'student' AND class_id = ?`,
      )
      .get(studentId, classId) as
      | {
          id: string;
          displayName: string;
          studentNo: string | null;
          contactEmail: string | null;
          contactPhone: string | null;
        }
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'student_not_found', message: '学生不在本班名单中' });
      return;
    }

    const nextName =
      req.body?.displayName != null ? String(req.body.displayName).trim() : row.displayName;
    const hasNo =
      req.body?.studentNo !== undefined
        ? String(req.body.studentNo ?? '').trim() || null
        : row.studentNo;
    const contactEmail =
      req.body?.contactEmail !== undefined
        ? String(req.body.contactEmail ?? '').trim() || null
        : row.contactEmail;
    const contactPhone =
      req.body?.contactPhone !== undefined
        ? String(req.body.contactPhone ?? '').trim() || null
        : row.contactPhone;

    if (!/^[\u4e00-\u9fffA-Za-z0-9·•\s._-]{1,40}$/.test(nextName)) {
      res.status(400).json({ error: 'invalid_name', message: '姓名含非法字符或过长' });
      return;
    }
    if (hasNo && !/^[A-Za-z0-9_-]{1,32}$/.test(hasNo)) {
      res.status(400).json({ error: 'invalid_student_no', message: '学号含非法字符（仅字母数字_-）' });
      return;
    }
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      res.status(400).json({ error: 'invalid_email', message: '邮箱格式无效' });
      return;
    }

    const dupName = db
      .prepare(
        `SELECT id FROM users
         WHERE role = 'student' AND class_id = ? AND display_name = ? COLLATE NOCASE AND id != ?
           AND (deleted_at IS NULL OR deleted_at = '')`,
      )
      .get(classId, nextName, studentId);
    if (dupName) {
      res.status(409).json({ error: 'duplicate_name', message: '同名已存在' });
      return;
    }
    if (hasNo) {
      const dupNo = db
        .prepare(
          `SELECT id FROM users
           WHERE role = 'student' AND class_id = ? AND student_no = ? AND id != ?
             AND (deleted_at IS NULL OR deleted_at = '')`,
        )
        .get(classId, hasNo, studentId);
      if (dupNo) {
        res.status(409).json({ error: 'duplicate_student_no', message: '学号已存在' });
        return;
      }
    }

    db.prepare(
      `UPDATE users SET display_name = ?, student_no = ?, contact_email = ?, contact_phone = ? WHERE id = ?`,
    ).run(nextName, hasNo, contactEmail, contactPhone, studentId);
    res.json({
      ok: true,
      id: studentId,
      displayName: nextName,
      studentNo: hasNo,
      contactEmail,
      contactPhone,
    });
  },
);

classesRouter.delete(
  '/api/v1/classes/:id/students/:studentId',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = paramId(req.params.id);
    const studentId = paramId(req.params.studentId);
    const db = openDb();
    const at = nowIso();
    const info = db
      .prepare(
        `UPDATE users SET deleted_at = ?
         WHERE id = ? AND role = 'student' AND class_id = ?
           AND (deleted_at IS NULL OR deleted_at = '')`,
      )
      .run(at, studentId, classId);
    if (!info.changes) {
      res.status(404).json({ error: 'student_not_found', message: '学生不在本班名单中' });
      return;
    }
    kickStudents([studentId], db);
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'students.soft_delete',
      classId,
      detail: { ids: [studentId] },
      clientIp: req.ip,
    });
    res.json({ ok: true, id: studentId, softDeleted: true, deletedAt: at });
  },
);

/** Aggregate impact for bulk delete confirmation. */
classesRouter.post(
  '/api/v1/classes/:id/students/bulk-impact',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req: AuthedRequest, res) => {
    const classId = paramId(req.params.id);
    const ids = parseIdList(req.body?.ids, 500);
    if (ids.length === 0) {
      res.status(400).json({ error: 'ids_required', message: '请选择学生' });
      return;
    }
    const db = openDb();
    let attendanceRecords = 0;
    let pointsLog = 0;
    let answers = 0;
    let messages = 0;
    let pointRequests = 0;
    let found = 0;
    for (const chunk of chunkIds(ids)) {
      const ph = sqlInPlaceholders(chunk.length);
      const rows = db
        .prepare(
          `SELECT id FROM users
           WHERE role = 'student' AND class_id = ?
             AND (deleted_at IS NULL OR deleted_at = '')
             AND id IN (${ph})`,
        )
        .all(classId, ...chunk) as Array<{ id: string }>;
      found += rows.length;
      const foundIds = rows.map((r) => r.id);
      if (foundIds.length === 0) continue;
      const ph2 = sqlInPlaceholders(foundIds.length);
      attendanceRecords += Number(
        (
          db
            .prepare(`SELECT COUNT(*) AS c FROM attendance_records WHERE student_id IN (${ph2})`)
            .get(...foundIds) as { c: number }
        ).c,
      );
      pointsLog += Number(
        (
          db.prepare(`SELECT COUNT(*) AS c FROM points_log WHERE student_id IN (${ph2})`).get(...foundIds) as {
            c: number;
          }
        ).c,
      );
      answers += Number(
        (
          db
            .prepare(`SELECT COUNT(*) AS c FROM student_answers WHERE student_id IN (${ph2})`)
            .get(...foundIds) as { c: number }
        ).c,
      );
      messages += Number(
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM messages
               WHERE student_id IN (${ph2}) OR to_student_id IN (${ph2})`,
            )
            .get(...foundIds, ...foundIds) as { c: number }
        ).c,
      );
      pointRequests += Number(
        (
          db
            .prepare(`SELECT COUNT(*) AS c FROM point_requests WHERE student_id IN (${ph2})`)
            .get(...foundIds) as { c: number }
        ).c,
      );
    }
    res.json({
      studentCount: found,
      requested: ids.length,
      attendanceRecords,
      pointsLog,
      answers,
      messages,
      pointRequests,
      total: attendanceRecords + pointsLog + answers + messages + pointRequests,
    });
  },
);

/**
 * Soft-delete students (回收站). Related rows kept until purge / retention expiry.
 * Body: { ids: string[], hard?: boolean } — hard=true 立即硬删（仅 admin/teacher）.
 */
classesRouter.post(
  '/api/v1/classes/:id/students/bulk-delete',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = paramId(req.params.id);
    const ids = parseIdList(req.body?.ids, 500);
    const hard = Boolean(req.body?.hard);
    if (ids.length === 0) {
      res.status(400).json({ error: 'ids_required', message: '请选择要删除的学生' });
      return;
    }
    const db = openDb();
    if (!db.prepare(`SELECT id FROM classes WHERE id = ?`).get(classId)) {
      res.status(404).json({ error: 'class_not_found', message: '班级不存在' });
      return;
    }
    const at = nowIso();
    let deleted = 0;
    const touched = new Set<string>();
    db.exec('BEGIN');
    try {
      for (const chunk of chunkIds(ids)) {
        const ph = sqlInPlaceholders(chunk.length);
        if (hard) {
          const info = db
            .prepare(
              `DELETE FROM users
               WHERE role = 'student' AND class_id = ? AND id IN (${ph})`,
            )
            .run(classId, ...chunk);
          deleted += Number(info.changes ?? 0);
        } else {
          const existing = db
            .prepare(
              `SELECT id FROM users
               WHERE role = 'student' AND class_id = ?
                 AND (deleted_at IS NULL OR deleted_at = '')
                 AND id IN (${ph})`,
            )
            .all(classId, ...chunk) as Array<{ id: string }>;
          for (const r of existing) touched.add(r.id);
          if (existing.length) {
            const ph2 = sqlInPlaceholders(existing.length);
            const info = db
              .prepare(
                `UPDATE users SET deleted_at = ?
                 WHERE role = 'student' AND class_id = ?
                   AND id IN (${ph2})
                   AND (deleted_at IS NULL OR deleted_at = '')`,
              )
              .run(at, classId, ...existing.map((r) => r.id));
            deleted += Number(info.changes ?? 0);
          }
        }
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    const missing = hard ? [] : ids.filter((id) => !touched.has(id));
    if (!hard && touched.size) {
      kickStudents([...touched], db);
    }
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: hard ? 'students.bulk_purge' : 'students.bulk_soft_delete',
      classId,
      detail: { ids, deleted, hard },
      clientIp: req.ip,
    });
    res.json({
      ok: true,
      softDeleted: !hard,
      deleted,
      requested: ids.length,
      missing: hard ? [] : missing,
      message: hard
        ? `已永久删除 ${deleted} 人`
        : missing.length
          ? `已移入回收站 ${deleted} 人，${missing.length} 人未在本班`
          : `已移入回收站 ${deleted} 人（${RECYCLE_RETENTION_DAYS} 日内可恢复）`,
    });
  },
);

/** Bulk set / clear student numbers. action: prefix | clear | setPrefix */
classesRouter.post(
  '/api/v1/classes/:id/students/bulk-student-no',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = paramId(req.params.id);
    const ids = parseIdList(req.body?.ids, 500);
    const action = String(req.body?.action ?? '').trim();
    const prefix = String(req.body?.prefix ?? '').trim();
    if (ids.length === 0) {
      res.status(400).json({ error: 'ids_required', message: '请选择学生' });
      return;
    }
    if (!['clear', 'prefix'].includes(action)) {
      res.status(400).json({ error: 'invalid_action', message: 'action 须为 clear / prefix' });
      return;
    }
    if (action === 'prefix') {
      if (!prefix || !/^[A-Za-z0-9_-]{1,16}$/.test(prefix)) {
        res.status(400).json({
          error: 'invalid_prefix',
          message: '前缀须为 1–16 位字母数字_-',
        });
        return;
      }
    }
    const db = openDb();
    const students = db
      .prepare(
        `SELECT id, student_no AS studentNo, display_name AS displayName
         FROM users
         WHERE role = 'student' AND class_id = ?
           AND (deleted_at IS NULL OR deleted_at = '')`,
      )
      .all(classId) as Array<{ id: string; studentNo: string | null; displayName: string }>;
    const byId = new Map(students.map((s) => [s.id, s]));
    const selected = ids.map((id) => byId.get(id)).filter(Boolean) as Array<{
      id: string;
      studentNo: string | null;
      displayName: string;
    }>;
    if (selected.length === 0) {
      res.status(400).json({ error: 'none_found', message: '选中学生均不在本班' });
      return;
    }

    type Plan = { id: string; next: string | null };
    const plans: Plan[] = selected.map((s) => {
      if (action === 'clear') return { id: s.id, next: null };
      const base = (s.studentNo && s.studentNo.trim()) || s.id.slice(0, 8);
      const stripped = base.startsWith(prefix) ? base.slice(prefix.length) : base;
      const next = `${prefix}${stripped}`;
      return { id: s.id, next };
    });

    for (const p of plans) {
      if (p.next && !/^[A-Za-z0-9_-]{1,32}$/.test(p.next)) {
        res.status(400).json({
          error: 'invalid_student_no',
          message: `生成学号非法：${p.next}`,
        });
        return;
      }
    }

    const nextNos = plans.map((p) => p.next).filter((n): n is string => Boolean(n));
    const dupInBatch = nextNos.filter((n, i) => nextNos.indexOf(n) !== i);
    if (dupInBatch.length) {
      res.status(409).json({
        error: 'duplicate_in_batch',
        message: `批次内学号冲突：${[...new Set(dupInBatch)].slice(0, 5).join('、')}`,
      });
      return;
    }

    const selectedSet = new Set(plans.map((p) => p.id));
    const occupied = new Set(
      students
        .filter((s) => !selectedSet.has(s.id) && s.studentNo)
        .map((s) => String(s.studentNo)),
    );
    const conflicts = plans.filter((p) => p.next && occupied.has(p.next));
    if (conflicts.length) {
      res.status(409).json({
        error: 'duplicate_student_no',
        message: `与现有学号冲突：${conflicts
          .slice(0, 5)
          .map((c) => c.next)
          .join('、')}`,
      });
      return;
    }

    let updated = 0;
    db.exec('BEGIN');
    try {
      const stmt = db.prepare(`UPDATE users SET student_no = ? WHERE id = ? AND class_id = ?`);
      for (const p of plans) {
        const info = stmt.run(p.next, p.id, classId);
        if (info.changes) updated += 1;
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'students.bulk_student_no',
      classId,
      detail: { action, prefix: action === 'prefix' ? prefix : null, ids: plans.map((p) => p.id), updated },
      clientIp: req.ip,
    });
    res.json({
      ok: true,
      updated,
      requested: ids.length,
      message: action === 'clear' ? `已清空 ${updated} 人学号` : `已为 ${updated} 人加前缀「${prefix}」`,
    });
  },
);

/** Recycle bin: soft-deleted students. */
classesRouter.get(
  '/api/v1/classes/:id/students/recycle',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req, res) => {
    const classId = paramId(req.params.id);
    const raw = openDb()
      .prepare(
        `SELECT id, display_name AS displayName, student_no AS studentNo, total_points AS totalPoints,
                deleted_at AS deletedAt, created_at AS createdAt
         FROM users
         WHERE role = 'student' AND class_id = ?
           AND deleted_at IS NOT NULL AND deleted_at != ''
         ORDER BY deleted_at DESC`,
      )
      .all(classId) as Array<{
      id: string;
      displayName: string;
      studentNo: string | null;
      totalPoints: number;
      deletedAt: string;
      createdAt: string;
    }>;
    const now = Date.now();
    const items = raw.map((row) => {
      const { expiresAt, daysLeft } = recycleTiming(row.deletedAt, now);
      return { ...row, expiresAt, daysLeft, retentionDays: RECYCLE_RETENTION_DAYS };
    });
    res.json({ items, retentionDays: RECYCLE_RETENTION_DAYS });
  },
);

classesRouter.post(
  '/api/v1/classes/:id/students/bulk-restore',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = paramId(req.params.id);
    const ids = parseIdList(req.body?.ids, 500);
    if (ids.length === 0) {
      res.status(400).json({ error: 'ids_required', message: '请选择要恢复的学生' });
      return;
    }
    const db = openDb();
    let restored = 0;
    db.exec('BEGIN');
    try {
      for (const chunk of chunkIds(ids)) {
        const ph = sqlInPlaceholders(chunk.length);
        const info = db
          .prepare(
            `UPDATE users SET deleted_at = NULL
             WHERE role = 'student' AND class_id = ?
               AND deleted_at IS NOT NULL AND deleted_at != ''
               AND id IN (${ph})`,
          )
          .run(classId, ...chunk);
        restored += Number(info.changes ?? 0);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    for (const id of ids) clearSessionKick(id, db);
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'students.bulk_restore',
      classId,
      detail: { ids, restored },
      clientIp: req.ip,
    });
    res.json({
      ok: true,
      restored,
      requested: ids.length,
      message: `已恢复 ${restored} 人`,
    });
  },
);

classesRouter.post(
  '/api/v1/classes/:id/students/bulk-purge',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = paramId(req.params.id);
    const ids = parseIdList(req.body?.ids, 500);
    if (ids.length === 0) {
      res.status(400).json({ error: 'ids_required', message: '请选择要永久删除的学生' });
      return;
    }
    const db = openDb();
    let purged = 0;
    db.exec('BEGIN');
    try {
      for (const chunk of chunkIds(ids)) {
        const ph = sqlInPlaceholders(chunk.length);
        const info = db
          .prepare(
            `DELETE FROM users
             WHERE role = 'student' AND class_id = ?
               AND deleted_at IS NOT NULL AND deleted_at != ''
               AND id IN (${ph})`,
          )
          .run(classId, ...chunk);
        purged += Number(info.changes ?? 0);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'students.bulk_purge',
      classId,
      detail: { ids, purged },
      clientIp: req.ip,
    });
    res.json({
      ok: true,
      purged,
      requested: ids.length,
      message: `已永久删除 ${purged} 人`,
    });
  },
);

classesRouter.post(
  '/api/v1/classes/:id/students/recycle/restore-all',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = paramId(req.params.id);
    const db = openDb();
    const doomed = db
      .prepare(
        `SELECT id FROM users
         WHERE role = 'student' AND class_id = ?
           AND deleted_at IS NOT NULL AND deleted_at != ''`,
      )
      .all(classId) as Array<{ id: string }>;
    const info = db
      .prepare(
        `UPDATE users SET deleted_at = NULL
         WHERE role = 'student' AND class_id = ?
           AND deleted_at IS NOT NULL AND deleted_at != ''`,
      )
      .run(classId);
    const restored = Number(info.changes ?? 0);
    for (const r of doomed) clearSessionKick(r.id, db);
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'students.recycle_restore_all',
      classId,
      detail: { restored },
      clientIp: req.ip,
    });
    res.json({ ok: true, restored, message: `已恢复全部 ${restored} 人` });
  },
);

classesRouter.post(
  '/api/v1/classes/:id/students/recycle/purge-all',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = paramId(req.params.id);
    const stream =
      String(req.query.stream ?? '') === '1' ||
      String(req.body?.stream ?? '') === '1' ||
      String(req.headers.accept ?? '').includes('application/x-ndjson');
    const db = openDb();
    const ids = (
      db
        .prepare(
          `SELECT id FROM users
           WHERE role = 'student' AND class_id = ?
             AND deleted_at IS NOT NULL AND deleted_at != ''`,
        )
        .all(classId) as Array<{ id: string }>
    ).map((r) => r.id);
    let purged = 0;
    const total = ids.length;
    const CHUNK = purgeChunkSize(total);
    const chunks = chunkIds(ids, CHUNK);
    const preferStream = total >= PURGE_STREAM_HINT_MIN;
    const useStream = stream || preferStream;
    const t0 = Date.now();
    let maxChunkMs = 0;
    let slowChunks = 0;

    if (useStream) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.write(
        `${JSON.stringify({
          type: 'progress',
          purged: 0,
          total,
          pct: total ? 0 : 100,
          done: false,
          preferStream,
        })}\n`,
      );
    }

    for (const chunk of chunks) {
      const c0 = Date.now();
      const ph = sqlInPlaceholders(chunk.length);
      const info = db
        .prepare(
          `DELETE FROM users
           WHERE role = 'student' AND class_id = ?
             AND deleted_at IS NOT NULL AND deleted_at != ''
             AND id IN (${ph})`,
        )
        .run(classId, ...chunk);
      purged += Number(info.changes ?? 0);
      const chunkMs = Date.now() - c0;
      if (chunkMs > maxChunkMs) maxChunkMs = chunkMs;
      if (chunkMs >= PURGE_CHUNK_SLOW_MS) {
        slowChunks += 1;
        console.warn(
          `[purge] students chunk slow ${chunkMs}ms size=${chunk.length} class=${classId}`,
        );
      }
      if (useStream) {
        const pct = total ? Math.min(100, Math.round((purged / total) * 100)) : 100;
        res.write(
          `${JSON.stringify({
            type: 'progress',
            purged,
            total,
            pct,
            done: false,
            chunkMs,
            maxChunkMs,
          })}\n`,
        );
      }
    }
    const durationMs = Date.now() - t0;
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'students.recycle_purge_all',
      classId,
      detail: {
        purged,
        chunks: chunks.length,
        chunkSize: CHUNK,
        durationMs,
        maxChunkMs,
        slowChunks,
        preferStream,
      },
      clientIp: req.ip,
    });
    const message = `已永久清空回收站 ${purged} 人（${durationMs}ms）`;
    if (useStream) {
      res.write(
        `${JSON.stringify({
          type: 'done',
          ok: true,
          purged,
          total,
          pct: 100,
          done: true,
          message,
          durationMs,
          maxChunkMs,
          slowChunks,
        })}\n`,
      );
      res.end();
      return;
    }
    res.json({
      ok: true,
      purged,
      message,
      durationMs,
      maxChunkMs,
      slowChunks,
      preferStream,
    });
  },
);
