import type { DatabaseSync } from 'node:sqlite';
import { findUserById, verifyAdminPassword, verifyPassword } from './auth.js';

/**
 * Step-up auth for max-secrecy sensitive ops (deep-lock / compliance).
 * Accepts current user password; admin role also accepts admin_password_hash.
 */
export async function verifyActorReauth(
  db: DatabaseSync,
  opts: { userId?: string | null; role?: string | null; password?: string | null },
): Promise<boolean> {
  const password = String(opts.password ?? '').trim();
  if (!password) return false;

  if (opts.role === 'admin') {
    if (await verifyAdminPassword(db, password)) return true;
  }

  const id = String(opts.userId ?? '').trim();
  if (!id) return false;
  const user = findUserById(db, id);
  if (!user?.password_hash) return false;
  return verifyPassword(password, user.password_hash);
}

export function reauthRequiredResponse(): {
  error: string;
  message: string;
} {
  return {
    error: 'reauth_required',
    message: '最高保密档：此操作须再次输入当前账号密码（confirmPassword）',
  };
}
