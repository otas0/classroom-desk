import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { newClassCode, newId, nowIso } from '../utils/id.js';
import { paramId } from '../utils/params.js';

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

type ImportRow = { name: string; studentNo: string | null; line: number };

function isHeaderName(name: string): boolean {
  const n = name.toLowerCase();
  return ['name', 'display_name', 'display-name', '姓名'].includes(n);
}

function parseCsvToRows(csvText: string): ImportRow[] {
  const rows: ImportRow[] = [];
  const rawLines = csvText.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i]?.trim() ?? '';
    if (!line) continue;
    const parts = line.split(',').map((p) => p.trim());
    const name = parts[0] ?? '';
    if (!name || isHeaderName(name)) continue;
    const hasNoCol = parts.length >= 2;
    const studentNo = hasNoCol ? parts[1] || null : null;
    rows.push({ name, studentNo: hasNoCol && !parts[1] ? '' : studentNo, line: i + 1 });
  }
  return rows;
}

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
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const rows: ImportRow[] = [];
  json.forEach((row, idx) => {
    const keys = Object.keys(row);
    const nameKey =
      keys.find((k) => /^(姓名|name|display_?name)$/i.test(k.trim())) ?? keys[0];
    const noKey = keys.find((k) => /^(学号|student_?no|studentno)$/i.test(k.trim())) ?? keys[1];
    const name = String(row[nameKey ?? ''] ?? '').trim();
    if (!name || isHeaderName(name)) return;
    const rawNo = noKey != null ? String(row[noKey] ?? '').trim() : '';
    const hasNoCol = noKey != null;
    rows.push({
      name,
      studentNo: hasNoCol ? rawNo || '' : null,
      line: idx + 2, // + header
    });
  });
  return rows;
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
    `INSERT INTO users (id, role, display_name, username, password_hash, student_no, class_id, total_points, created_at)
     VALUES (?, 'student', ?, NULL, NULL, ?, ?, 0, ?)`,
  );
  const existsByName = db.prepare(
    `SELECT id FROM users WHERE role = 'student' AND class_id = ? AND display_name = ? COLLATE NOCASE`,
  );
  const existsByNo = db.prepare(
    `SELECT id FROM users WHERE role = 'student' AND class_id = ? AND student_no = ?`,
  );

  for (const row of rows) {
    const { name, line } = row;
    const hasStudentNoColumn = row.studentNo !== null;
    const studentNo = row.studentNo === '' ? null : row.studentNo;
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
    if (hasStudentNoColumn && !studentNo) {
      skipped += 1;
      failures.push({
        line,
        name,
        studentNo: null,
        reason: 'empty_student_no',
        reasonText: '学号为空',
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
    insert.run(newId(), name, studentNo, classId, createdAt);
    created += 1;
  }

  return { created, skipped, replaced, total: rows.length, failures };
}

classesRouter.get('/api/v1/classes', requireAuth, requireRoles('teacher', 'admin'), (_req, res) => {
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
  try {
    openDb()
      .prepare(`INSERT INTO classes (id, name, class_code, created_at) VALUES (?, ?, ?, ?)`)
      .run(id, name, classCode, createdAt);
  } catch {
    res.status(409).json({ error: 'class_code_conflict' });
    return;
  }
  res.status(201).json({ id, name, classCode, createdAt });
});

/** Public roster for student machines assigned to this classId (no class-code join). */
classesRouter.get('/api/v1/classes/:id/roster', (req, res) => {
  const classId = paramId(req.params.id);
  const db = openDb();
  const klass = db
    .prepare(`SELECT id, name FROM classes WHERE id = ?`)
    .get(classId) as { id: string; name: string } | undefined;
  if (!klass) {
    res.status(404).json({ error: 'class_not_found' });
    return;
  }
  const items = db
    .prepare(
      `SELECT id, display_name AS displayName, student_no AS studentNo, total_points AS totalPoints
       FROM users WHERE role = 'student' AND class_id = ? ORDER BY display_name COLLATE NOCASE`,
    )
    .all(classId);
  res.json({ class: klass, items });
});

classesRouter.get(
  '/api/v1/classes/:id/students',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req, res) => {
    const students = openDb()
      .prepare(
        `SELECT id, display_name AS displayName, student_no AS studentNo, total_points AS totalPoints, created_at AS createdAt
         FROM users WHERE role = 'student' AND class_id = ? ORDER BY display_name`,
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
        `SELECT id, display_name AS displayName, student_no AS studentNo
         FROM users WHERE id = ? AND role = 'student' AND class_id = ?`,
      )
      .get(studentId, classId) as
      | { id: string; displayName: string; studentNo: string | null }
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

    if (!/^[\u4e00-\u9fffA-Za-z0-9·•\s._-]{1,40}$/.test(nextName)) {
      res.status(400).json({ error: 'invalid_name', message: '姓名含非法字符或过长' });
      return;
    }
    if (hasNo && !/^[A-Za-z0-9_-]{1,32}$/.test(hasNo)) {
      res.status(400).json({ error: 'invalid_student_no', message: '学号含非法字符（仅字母数字_-）' });
      return;
    }

    const dupName = db
      .prepare(
        `SELECT id FROM users
         WHERE role = 'student' AND class_id = ? AND display_name = ? COLLATE NOCASE AND id != ?`,
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
           WHERE role = 'student' AND class_id = ? AND student_no = ? AND id != ?`,
        )
        .get(classId, hasNo, studentId);
      if (dupNo) {
        res.status(409).json({ error: 'duplicate_student_no', message: '学号已存在' });
        return;
      }
    }

    db.prepare(`UPDATE users SET display_name = ?, student_no = ? WHERE id = ?`).run(
      nextName,
      hasNo,
      studentId,
    );
    res.json({
      ok: true,
      id: studentId,
      displayName: nextName,
      studentNo: hasNo,
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
    const info = db
      .prepare(`DELETE FROM users WHERE id = ? AND role = 'student' AND class_id = ?`)
      .run(studentId, classId);
    if (!info.changes) {
      res.status(404).json({ error: 'student_not_found', message: '学生不在本班名单中' });
      return;
    }
    res.json({ ok: true, id: studentId });
  },
);
