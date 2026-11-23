import { Router } from 'express';
import { nanoid } from 'nanoid';
import { DEFAULT_STANDARD_MINUTES } from '@work-desk/shared';
import { getDb } from '../db/connection.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { writeAudit } from '../services/auth.js';

export const departmentsRouter = Router();

departmentsRouter.use(requireAuth);

departmentsRouter.get('/', requireRoles('admin', 'manager'), (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT d.id, d.name, d.standard_minutes AS standardMinutes, d.created_at AS createdAt,
              (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.disabled_at IS NULL) AS memberCount
       FROM departments d
       ORDER BY d.name COLLATE NOCASE`,
    )
    .all();
  res.json({ departments: rows });
});

departmentsRouter.post('/', requireRoles('admin'), (req: AuthedRequest, res) => {
  const { name, standardMinutes } = req.body ?? {};
  if (!name?.trim()) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const minutes =
    Number.isFinite(Number(standardMinutes)) && Number(standardMinutes) > 0
      ? Math.floor(Number(standardMinutes))
      : DEFAULT_STANDARD_MINUTES;
  const id = nanoid();
  try {
    getDb()
      .prepare(
        `INSERT INTO departments (id, name, standard_minutes, created_at) VALUES (?, ?, ?, ?)`,
      )
      .run(id, name.trim(), minutes, new Date().toISOString());
  } catch {
    res.status(409).json({ error: 'name_taken' });
    return;
  }
  writeAudit('department.create', { id, name: name.trim(), minutes }, req.user);
  res.status(201).json({
    department: { id, name: name.trim(), standardMinutes: minutes },
  });
});

departmentsRouter.patch('/:id', requireRoles('admin'), (req: AuthedRequest, res) => {
  const { name, standardMinutes } = req.body ?? {};
  const existing = getDb()
    .prepare(`SELECT id FROM departments WHERE id = ?`)
    .get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (name?.trim()) {
    try {
      getDb()
        .prepare(`UPDATE departments SET name = ? WHERE id = ?`)
        .run(name.trim(), req.params.id);
    } catch {
      res.status(409).json({ error: 'name_taken' });
      return;
    }
  }
  if (Number.isFinite(Number(standardMinutes)) && Number(standardMinutes) > 0) {
    getDb()
      .prepare(`UPDATE departments SET standard_minutes = ? WHERE id = ?`)
      .run(Math.floor(Number(standardMinutes)), req.params.id);
  }
  writeAudit('department.update', { id: req.params.id, body: req.body }, req.user);
  const row = getDb()
    .prepare(
      `SELECT id, name, standard_minutes AS standardMinutes, created_at AS createdAt
       FROM departments WHERE id = ?`,
    )
    .get(req.params.id);
  res.json({ department: row });
});
