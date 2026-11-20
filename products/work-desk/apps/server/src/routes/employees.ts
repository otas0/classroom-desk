import { Router } from 'express';
import type { Role } from '@work-desk/shared';
import { getDb } from '../db/connection.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { createUser, writeAudit } from '../services/auth.js';

export const employeesRouter = Router();

employeesRouter.use(requireAuth);

employeesRouter.get('/', requireRoles('admin', 'manager'), (req: AuthedRequest, res) => {
  const departmentId =
    typeof req.query.departmentId === 'string' ? req.query.departmentId : null;
  let sql = `
    SELECT u.id, u.role, u.display_name AS displayName, u.username,
           u.employee_no AS employeeNo, u.department_id AS departmentId,
           d.name AS departmentName, u.disabled_at AS disabledAt, u.created_at AS createdAt
    FROM users u
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.role IN ('admin', 'manager', 'employee')`;
  const params: string[] = [];
  if (departmentId) {
    sql += ` AND u.department_id = ?`;
    params.push(departmentId);
  }
  if (req.user?.role === 'manager' && req.user.departmentId) {
    sql += ` AND u.department_id = ?`;
    params.push(req.user.departmentId);
  }
  sql += ` ORDER BY u.role, u.display_name COLLATE NOCASE`;
  res.json({ employees: getDb().prepare(sql).all(...params) });
});

employeesRouter.post('/', requireRoles('admin'), async (req: AuthedRequest, res) => {
  const { displayName, username, password, role, employeeNo, departmentId } = req.body ?? {};
  const allowed: Role[] = ['admin', 'manager', 'employee'];
  if (
    !displayName?.trim() ||
    !username?.trim() ||
    typeof password !== 'string' ||
    password.length < 8 ||
    !allowed.includes(role)
  ) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  if (departmentId) {
    const dep = getDb().prepare(`SELECT id FROM departments WHERE id = ?`).get(departmentId);
    if (!dep) {
      res.status(400).json({ error: 'invalid_department' });
      return;
    }
  }
  try {
    const user = await createUser({
      role,
      displayName,
      username,
      password,
      employeeNo,
      departmentId: departmentId || null,
    });
    writeAudit('employee.create', { userId: user.id, role }, req.user);
    res.status(201).json({ employee: user });
  } catch {
    res.status(409).json({ error: 'username_taken' });
  }
});

employeesRouter.post('/:id/disable', requireRoles('admin'), (req: AuthedRequest, res) => {
  if (req.params.id === req.user?.id) {
    res.status(400).json({ error: 'cannot_disable_self' });
    return;
  }
  const info = getDb()
    .prepare(`UPDATE users SET disabled_at = ? WHERE id = ? AND disabled_at IS NULL`)
    .run(new Date().toISOString(), req.params.id);
  if (info.changes === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  writeAudit('employee.disable', { userId: req.params.id }, req.user);
  res.json({ ok: true });
});

employeesRouter.post('/:id/enable', requireRoles('admin'), (req: AuthedRequest, res) => {
  const info = getDb()
    .prepare(`UPDATE users SET disabled_at = NULL WHERE id = ?`)
    .run(req.params.id);
  if (info.changes === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  writeAudit('employee.enable', { userId: req.params.id }, req.user);
  res.json({ ok: true });
});
