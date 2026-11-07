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
import { writeAudit } from '../services/audit.js';
import { allWeakPasswords, isWeakTeacherPassword } from '../services/weakPasswords.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { config } from '../config.js';
import { newId, nowIso } from '../utils/id.js';

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
  if (
    !user ||
    !user.password_hash ||
    (user.role !== 'teacher' && user.role !== 'admin' && user.role !== 'assistant')
  ) {
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }
  if (user.disabled_at != null && String(user.disabled_at).trim() !== '') {
    res.status(401).json({ error: 'account_disabled', message: '账号已停用，请联系教师' });
    return;
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }

  const authUser = mapUser(user);
  const token = await signToken(authUser);
  const passwordMarkedOk = getSetting(db, 'teacher_password_ok') === '1';
  const mustChangePassword = !passwordMarkedOk || isWeakTeacherPassword(password);
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
      `SELECT * FROM users
       WHERE id = ? AND role = 'student' AND class_id = ?
         AND (deleted_at IS NULL OR deleted_at = '')`,
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
  if (
    req.user?.role !== 'teacher' &&
    req.user?.role !== 'admin' &&
    req.user?.role !== 'assistant'
  ) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const currentPassword = String(req.body?.currentPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');
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
  if (isWeakTeacherPassword(newPassword)) {
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

/** Public password policy (built-in + server-configured extras). */
authRouter.get('/api/v1/auth/password-policy', (_req, res) => {
  const db = openDb();
  res.json({
    minLength: 8,
    requireLetterAndDigit: true,
    weakPasswords: allWeakPasswords(db),
  });
});

/** Create an assistant account (username + initial password). Teacher/admin only. */
authRouter.post(
  '/api/v1/auth/assistants',
  requireAuth,
  requireRoles('teacher', 'admin'),
  async (req: AuthedRequest, res) => {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    const displayName = String(req.body?.displayName ?? '').trim() || '助教';
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
      res.status(400).json({
        error: 'invalid_username',
        message: '用户名须为 3–32 位字母数字._-',
      });
      return;
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      res.status(400).json({
        error: 'weak_password',
        message: '初始口令至少 8 位且含字母与数字',
      });
      return;
    }
    if (isWeakTeacherPassword(password)) {
      res.status(400).json({ error: 'weak_password', message: '请勿使用联调/示例口令' });
      return;
    }
    if (!/^[\u4e00-\u9fffA-Za-z0-9·•\s._-]{1,40}$/.test(displayName)) {
      res.status(400).json({ error: 'invalid_name', message: '显示名含非法字符或过长' });
      return;
    }
    const db = openDb();
    if (findUserByUsername(db, username)) {
      res.status(409).json({ error: 'username_taken', message: '用户名已存在' });
      return;
    }
    const id = newId();
    const hash = await hashPassword(password);
    const createdAt = nowIso();
    db.prepare(
      `INSERT INTO users (id, role, display_name, username, password_hash, class_id, total_points, created_at)
       VALUES (?, 'assistant', ?, ?, ?, NULL, 0, ?)`,
    ).run(id, displayName, username, hash, createdAt);
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'auth.create_assistant',
      detail: { id, username, displayName },
      clientIp: req.ip,
    });
    res.status(201).json({
      ok: true,
      id,
      username,
      displayName,
      role: 'assistant',
      message: `已创建助教「${username}」，请告知其用此口令登录后尽快改密`,
    });
  },
);

authRouter.get(
  '/api/v1/auth/assistants',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (_req, res) => {
    const items = openDb()
      .prepare(
        `SELECT id, username, display_name AS displayName, created_at AS createdAt,
                disabled_at AS disabledAt
         FROM users WHERE role = 'assistant'
         ORDER BY created_at DESC`,
      )
      .all();
    res.json({ items });
  },
);

authRouter.post(
  '/api/v1/auth/assistants/:id/disable',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const id = String(req.params.id ?? '').trim();
    const db = openDb();
    const at = nowIso();
    const info = db
      .prepare(
        `UPDATE users SET disabled_at = ?
         WHERE id = ? AND role = 'assistant'
           AND (disabled_at IS NULL OR disabled_at = '')`,
      )
      .run(at, id);
    if (!info.changes) {
      res.status(404).json({ error: 'not_found', message: '助教不存在或已停用' });
      return;
    }
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'auth.disable_assistant',
      detail: { id },
      clientIp: req.ip,
    });
    res.json({ ok: true, id, disabledAt: at, message: '已停用助教' });
  },
);

authRouter.post(
  '/api/v1/auth/assistants/:id/enable',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const id = String(req.params.id ?? '').trim();
    const db = openDb();
    const info = db
      .prepare(
        `UPDATE users SET disabled_at = NULL
         WHERE id = ? AND role = 'assistant'
           AND disabled_at IS NOT NULL AND disabled_at != ''`,
      )
      .run(id);
    if (!info.changes) {
      res.status(404).json({ error: 'not_found', message: '助教不存在或未停用' });
      return;
    }
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'auth.enable_assistant',
      detail: { id },
      clientIp: req.ip,
    });
    res.json({ ok: true, id, message: '已启用助教' });
  },
);

authRouter.post(
  '/api/v1/auth/assistants/:id/reset-password',
  requireAuth,
  requireRoles('teacher', 'admin'),
  async (req: AuthedRequest, res) => {
    const id = String(req.params.id ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      res.status(400).json({
        error: 'weak_password',
        message: '新口令至少 8 位且含字母与数字',
      });
      return;
    }
    const db = openDb();
    const row = db
      .prepare(`SELECT id, username FROM users WHERE id = ? AND role = 'assistant'`)
      .get(id) as { id: string; username: string } | undefined;
    if (!row) {
      res.status(404).json({ error: 'not_found', message: '助教不存在' });
      return;
    }
    const hash = await hashPassword(password);
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, id);
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'auth.reset_assistant_password',
      detail: { id, username: row.username },
      clientIp: req.ip,
    });
    res.json({ ok: true, id, message: `已重置「${row.username}」口令` });
  },
);
