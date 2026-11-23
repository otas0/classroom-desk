import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { nanoid } from 'nanoid';
import type { Role, PublicUser } from '@brand-family/shared';
import { getDb } from '../db/connection.js';

const SALT_ROUNDS = 10;

function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET || 'dev-only-change-me';
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function signToken(user: { id: string; role: Role }): Promise<string> {
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(secretKey());
}

export async function verifyToken(
  token: string,
): Promise<{ sub: string; role: Role } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub || typeof payload.role !== 'string') return null;
    return { sub: payload.sub, role: payload.role as Role };
  } catch {
    return null;
  }
}

type UserRow = {
  id: string;
  role: Role;
  display_name: string;
  username: string;
  password_hash: string;
  disabled_at: string | null;
};

export function findUserByUsername(username: string): UserRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, role, display_name, username, password_hash, disabled_at
       FROM users WHERE username = ? COLLATE NOCASE`,
    )
    .get(username) as UserRow | undefined;
}

export function findUserById(id: string): UserRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, role, display_name, username, password_hash, disabled_at
       FROM users WHERE id = ?`,
    )
    .get(id) as UserRow | undefined;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    role: row.role,
    displayName: row.display_name,
    username: row.username,
  };
}

export function countParents(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'parent' AND disabled_at IS NULL`)
    .get() as { c: number };
  return row.c;
}

export async function createUser(input: {
  role: Role;
  displayName: string;
  username: string;
  password: string;
}): Promise<PublicUser> {
  const id = nanoid();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(input.password);
  getDb()
    .prepare(
      `INSERT INTO users (id, role, display_name, username, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.role, input.displayName.trim(), input.username.trim(), passwordHash, now);
  const row = findUserById(id);
  if (!row) throw new Error('user_create_failed');
  return toPublicUser(row);
}

export function writeAudit(
  action: string,
  detail: unknown,
  actor?: { id: string; role: Role } | null,
): void {
  getDb()
    .prepare(
      `INSERT INTO audit_log (id, actor_user_id, actor_role, action, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      nanoid(),
      actor?.id ?? null,
      actor?.role ?? null,
      action,
      detail == null ? null : JSON.stringify(detail),
      new Date().toISOString(),
    );
}
