import { Router } from 'express';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { newClassCode, newId, nowIso } from '../utils/id.js';
import { paramId } from '../utils/params.js';

export const classesRouter = Router();

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

/**
 * Bulk import students from CSV.
 * Formats:
 * - name
 * - name,studentNo
 * Header row optional: name / display_name / 姓名, student_no / 学号
 */
classesRouter.post(
  '/api/v1/classes/:id/students/import',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = paramId(req.params.id);
    const db = openDb();
    const klass = db.prepare(`SELECT id FROM classes WHERE id = ?`).get(classId);
    if (!klass) {
      res.status(404).json({ error: 'class_not_found' });
      return;
    }

    const csvText = String(req.body?.csv ?? '');
    let created = 0;
    let skipped = 0;
    const failures: Array<{ line: number; name: string; studentNo: string | null; reason: string }> = [];
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

    const rawLines = csvText.split(/\r?\n/);
    let dataLine = 0;
    for (let i = 0; i < rawLines.length; i += 1) {
      const line = rawLines[i]?.trim() ?? '';
      if (!line) continue;
      const parts = line.split(',').map((p) => p.trim());
      const name = parts[0] ?? '';
      const studentNo = parts[1] || null;
      const n = name.toLowerCase();
      if (!name || ['name', 'display_name', 'display-name', '姓名'].includes(n)) continue;
      dataLine += 1;
      const lineNo = i + 1;
      if (existsByName.get(classId, name)) {
        skipped += 1;
        failures.push({ line: lineNo, name, studentNo, reason: 'duplicate_name' });
        continue;
      }
      if (studentNo && existsByNo.get(classId, studentNo)) {
        skipped += 1;
        failures.push({ line: lineNo, name, studentNo, reason: 'duplicate_student_no' });
        continue;
      }
      insert.run(newId(), name, studentNo, classId, createdAt);
      created += 1;
    }

    if (dataLine === 0) {
      res.status(400).json({ error: 'empty_csv' });
      return;
    }

    res.status(201).json({ created, skipped, total: dataLine, failures });
  },
);
