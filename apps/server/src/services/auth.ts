import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import type { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import type { AuthUser, DbUser, Role } from '../types.js';
import { newClassCode, newId, nowIso } from '../utils/id.js';
import { getSetting } from '../db/migrate.js';

const encoder = new TextEncoder();

export function mapUser(row: DbUser): AuthUser {
  return {
    id: row.id,
    role: row.role,
    displayName: row.display_name,
    username: row.username,
    classId: row.class_id,
    totalPoints: row.total_points,
  };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export type SignTokenOpts = {
  expiresIn?: string | number;
  bindIp?: string | null;
};

export type VerifiedToken = AuthUser & { bindIp?: string | null };

export async function signToken(user: AuthUser, opts?: SignTokenOpts): Promise<string> {
  const claims: Record<string, unknown> = {
    role: user.role,
    displayName: user.displayName,
    classId: user.classId,
  };
  if (opts?.bindIp) claims.bindIp = opts.bindIp;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(opts?.expiresIn ?? config.jwtExpiresIn)
    .sign(encoder.encode(config.jwtSecret));
}

export async function verifyToken(token: string): Promise<VerifiedToken | null> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(config.jwtSecret));
    if (!payload.sub || typeof payload.role !== 'string') return null;
    return {
      id: payload.sub,
      role: payload.role as Role,
      displayName: String(payload.displayName ?? ''),
      username: null,
      classId: (payload.classId as string | null | undefined) ?? null,
      totalPoints: 0,
      bindIp: payload.bindIp != null ? String(payload.bindIp) : null,
    };
  } catch {
    return null;
  }
}

export function findUserById(db: DatabaseSync, id: string): DbUser | undefined {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as DbUser | undefined;
}

export function findUserByUsername(db: DatabaseSync, username: string): DbUser | undefined {
  return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) as DbUser | undefined;
}

export async function ensureBootstrap(db: DatabaseSync): Promise<void> {
  const adminHash = getSetting(db, 'admin_password_hash');
  if (!adminHash) {
    const password = process.env.ADMIN_PASSWORD?.trim() || randomTempPassword();
    const hash = await hashPassword(password);
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('admin_password_hash', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(hash);
    if (!process.env.ADMIN_PASSWORD?.trim()) {
      console.warn(`[bootstrap] ADMIN_PASSWORD generated for first run (not stored in plaintext): ${password}`);
    } else {
      console.log('[bootstrap] admin password hash written from ADMIN_PASSWORD env');
    }
  }

  const teacherCount = (
    db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role IN ('teacher', 'admin')`).get() as { c: number }
  ).c;

  const username = process.env.TEACHER_USERNAME?.trim() || 'teacher';
  const envTeacherPassword = process.env.TEACHER_PASSWORD?.trim() || '';
  const existingNamed = findUserByUsername(db, username);

  if (!existingNamed) {
    const password = envTeacherPassword || randomTempPassword();
    const hash = await hashPassword(password);
    const teacherId = newId();
    const createdAt = nowIso();
    if (teacherCount === 0) {
      const classId = newId();
      const classCode = process.env.DEFAULT_CLASS_CODE?.trim().toUpperCase() || newClassCode();
      db.prepare(
        `INSERT INTO classes (id, name, class_code, created_at) VALUES (?, ?, ?, ?)`,
      ).run(classId, '本教室', classCode, createdAt);
    }
    db.prepare(
      `INSERT INTO users (id, role, display_name, username, password_hash, class_id, total_points, created_at)
       VALUES (?, 'teacher', ?, ?, ?, NULL, 0, ?)`,
    ).run(teacherId, '默认教师', username, hash, createdAt);
    console.warn(
      `[bootstrap] created teacher "${username}". Teacher password (env TEACHER_PASSWORD or generated): ${password}`,
    );
  } else if (envTeacherPassword) {
    // CI / lab: force-align named teacher password when TEACHER_PASSWORD is set.
    const hash = await hashPassword(envTeacherPassword);
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, existingNamed.id);
    console.log(`[bootstrap] teacher "${username}" password hash aligned from TEACHER_PASSWORD env`);
  }
}

function randomTempPassword(): string {
  return `Tmp-${newId().replaceAll('-', '').slice(0, 10)}`;
}

export async function verifyAdminPassword(db: DatabaseSync, password: string): Promise<boolean> {
  const hash = getSetting(db, 'admin_password_hash');
  if (!hash) return false;
  return verifyPassword(password, hash);
}
