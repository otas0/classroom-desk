import { Router } from 'express';
import { openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import {
  findUserById,
  findUserByUsername,
  hashPassword,
  mapUser,
  signToken,
  verifyAdminPassword,
  verifyPassword,
} from '../services/auth.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { config } from '../config.js';

export const authRouter = Router();

authRouter.post('/api/v1/auth/login', async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!username || !password) {
    res.status(400).json({ error: 'username_password_required' });
    return;
  }

  const db = openDb();
  const user = findUserByUsername(db, username);
  if (!user || !user.password_hash || (user.role !== 'teacher' && user.role !== 'admin')) {
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }

  const authUser = mapUser(user);
  const token = await signToken(authUser);
  const weakPasswords = new Set([
    'ChangeMe123',
    'TeacherPass123',
    'Classroom2026!',
    'Desk@179#2026',
    'AdminPass123',
    'password',
    '123456',
  ]);
  const passwordMarkedOk = getSetting(db, 'teacher_password_ok') === '1';
  const mustChangePassword = !passwordMarkedOk || weakPasswords.has(password);
  res.json({ token, user: authUser, mustChangePassword });
});

/**
 * Student identity: pick a roster row for the class assigned to this machine (classId in config).
 * Does not create users — roster must be imported by teacher first.
 */
authRouter.post('/api/v1/auth/student-select', async (req, res) => {
  const classId = String(req.body?.classId ?? '').trim();
  const studentId = String(req.body?.studentId ?? '').trim();
  if (!classId || !studentId) {
    res.status(400).json({ error: 'class_id_and_student_id_required' });
    return;
  }

  const db = openDb();
  const klass = db.prepare(`SELECT id, name, class_code FROM classes WHERE id = ?`).get(classId) as
    | { id: string; name: string; class_code: string }
    | undefined;
  if (!klass) {
    res.status(404).json({ error: 'class_not_found' });
    return;
  }

  const user = db
    .prepare(
      `SELECT * FROM users WHERE id = ? AND role = 'student' AND class_id = ?`,
    )
    .get(studentId, classId) as
    | {
        id: string;
        role: 'student';
        display_name: string;
        username: string | null;
        password_hash: string | null;
        class_id: string;
        total_points: number;
        created_at: string;
      }
    | undefined;

  if (!user) {
    res.status(404).json({ error: 'student_not_in_class' });
    return;
  }

  const authUser = mapUser(user);
  const token = await signToken(authUser);
  res.json({
    token,
    user: authUser,
    class: { id: klass.id, name: klass.name, classCode: klass.class_code },
  });
});

authRouter.post('/api/v1/auth/admin-unlock', async (req, res) => {
  const password = String(req.body?.password ?? '');
  if (!password) {
    res.status(400).json({ error: 'password_required' });
    return;
  }
  const ok = await verifyAdminPassword(openDb(), password);
  if (!ok) {
    res.status(401).json({ error: 'invalid_admin_password' });
    return;
  }
  res.json({ ok: true });
});

/** Local student-desktop exit: dedicated 解除码 or admin password (rate-limited). */
authRouter.post('/api/v1/auth/exit-unlock', async (req, res) => {
  const code = String(req.body?.code ?? req.body?.password ?? '');
  const { attemptExitUnlock } = await import('../services/exitLock.js');
  const clientIp = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
  const result = await attemptExitUnlock(openDb(), code, { clientIp });
  if (!result.ok) {
    if (result.retryAfterSec) res.setHeader('Retry-After', String(result.retryAfterSec));
    res.status(result.status).json({
      error: result.error,
      message: result.message,
      retryAfterSec: result.retryAfterSec,
    });
    return;
  }
  res.json({ ok: true, allowExit: true });
});

authRouter.get('/api/v1/auth/me', requireAuth, (req: AuthedRequest, res) => {
  const db = openDb();
  let classInfo = null;
  if (req.user?.classId) {
    const klass = db.prepare(`SELECT id, name, class_code FROM classes WHERE id = ?`).get(req.user.classId) as
      | { id: string; name: string; class_code: string }
      | undefined;
    if (klass) {
      classInfo = { id: klass.id, name: klass.name, classCode: klass.class_code };
    }
  }
  res.json({ user: req.user, class: classInfo });
});

authRouter.post('/api/v1/auth/change-admin-password', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role !== 'teacher' && req.user?.role !== 'admin') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const currentPassword = String(req.body?.currentPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');
  if (!currentPassword || newPassword.length < 6) {
    res.status(400).json({ error: 'invalid_password' });
    return;
  }
  const db = openDb();
  const ok = await verifyAdminPassword(db, currentPassword);
  if (!ok) {
    res.status(401).json({ error: 'invalid_admin_password' });
    return;
  }
  const hash = await hashPassword(newPassword);
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('admin_password_hash', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(hash);
  res.json({ ok: true });
});

/** Teacher login password (users.password_hash). Teachers change this in /admin 设置. */
authRouter.post('/api/v1/auth/change-password', requireAuth, async (req: AuthedRequest, res) => {
  if (req.user?.role !== 'teacher' && req.user?.role !== 'admin') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const currentPassword = String(req.body?.currentPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');
  const weakPasswords = new Set([
    'ChangeMe123',
    'TeacherPass123',
    'Classroom2026!',
    'Desk@179#2026',
    'AdminPass123',
    'password',
    '123456',
  ]);
  if (!currentPassword || newPassword.length < 8) {
    res.status(400).json({ error: 'invalid_password', message: '新密码至少 8 位' });
    return;
  }
  if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    res.status(400).json({
      error: 'weak_password',
      message: '新密码需同时包含字母与数字',
    });
    return;
  }
  if (weakPasswords.has(newPassword)) {
    res.status(400).json({ error: 'weak_password', message: '请勿使用联调/示例口令' });
    return;
  }
  const db = openDb();
  const user = findUserByUsername(db, String(req.user.username ?? '')) ?? findUserById(db, req.user.id);
  if (!user?.password_hash) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  const ok = await verifyPassword(currentPassword, user.password_hash);
  if (!ok) {
    res.status(401).json({ error: 'invalid_credentials', message: '当前密码不正确' });
    return;
  }
  const hash = await hashPassword(newPassword);
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, user.id);
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('teacher_password_ok', '1')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run();
  res.json({ ok: true, message: '登录密码已更新，请下次用新密码登录' });
});

authRouter.get('/api/v1/auth/bootstrap-info', (_req, res) => {
  const db = openDb();
  const hasAdmin = Boolean(getSetting(db, 'admin_password_hash'));
  const classCount = (db.prepare(`SELECT COUNT(*) AS c FROM classes`).get() as { c: number }).c;
  res.json({
    hasAdminPassword: hasAdmin,
    classCount,
    jwtConfigured: Boolean(process.env.JWT_SECRET),
    pointRequestTtlMinutes: Number(
      getSetting(db, 'point_request_ttl_minutes') ?? config.defaultPointRequestTtlMinutes,
    ),
  });
});
