import { Router } from 'express';
import { openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import {
  findUserByUsername,
  hashPassword,
  mapUser,
  signToken,
  verifyAdminPassword,
  verifyPassword,
} from '../services/auth.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { newId, nowIso } from '../utils/id.js';
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
  res.json({ token, user: authUser });
});

authRouter.post('/api/v1/auth/student-join', async (req, res) => {
  const classCode = String(req.body?.classCode ?? '')
    .trim()
    .toUpperCase();
  const displayName = String(req.body?.displayName ?? '').trim();
  if (!classCode || !displayName) {
    res.status(400).json({ error: 'class_code_and_name_required' });
    return;
  }

  const db = openDb();
  const klass = db.prepare(`SELECT * FROM classes WHERE class_code = ?`).get(classCode) as
    | { id: string; name: string; class_code: string }
    | undefined;
  if (!klass) {
    res.status(404).json({ error: 'class_not_found' });
    return;
  }

  const existing = db
    .prepare(
      `SELECT * FROM users WHERE role = 'student' AND class_id = ? AND display_name = ? COLLATE NOCASE`,
    )
    .get(klass.id, displayName) as
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

  let user = existing;
  if (!user) {
    const id = newId();
    const createdAt = nowIso();
    db.prepare(
      `INSERT INTO users (id, role, display_name, username, password_hash, class_id, total_points, created_at)
       VALUES (?, 'student', ?, NULL, NULL, ?, 0, ?)`,
    ).run(id, displayName, klass.id, createdAt);
    user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as typeof user;
  }

  if (!user) {
    res.status(500).json({ error: 'join_failed' });
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
