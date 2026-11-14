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

/**
 * Two-person rule: actor password + a *different* privilege holder.
 * - If actor is teacher/assistant → second must be admin password
 * - If actor is admin → second must be a teacher password (not the same string as first)
 */
export async function verifyTwoPersonRule(
  db: DatabaseSync,
  opts: {
    userId?: string | null;
    role?: string | null;
    confirmPassword?: string | null;
    secondPassword?: string | null;
  },
): Promise<{ ok: boolean; detail: string }> {
  const first = String(opts.confirmPassword ?? '').trim();
  const second = String(opts.secondPassword ?? '').trim();
  if (!first || !second) {
    return { ok: false, detail: 'need_confirm_and_second' };
  }
  if (first === second) {
    return { ok: false, detail: 'passwords_must_differ' };
  }
  const actorOk = await verifyActorReauth(db, {
    userId: opts.userId,
    role: opts.role,
    password: first,
  });
  if (!actorOk) return { ok: false, detail: 'confirm_failed' };

  const role = String(opts.role ?? '');
  if (role === 'admin') {
    const teachers = db
      .prepare(
        `SELECT password_hash AS h FROM users
         WHERE role = 'teacher' AND password_hash IS NOT NULL AND password_hash != ''
           AND (disabled_at IS NULL OR disabled_at = '')
         LIMIT 20`,
      )
      .all() as Array<{ h: string }>;
    for (const t of teachers) {
      if (await verifyPassword(second, t.h)) {
        return { ok: true, detail: 'admin_plus_teacher' };
      }
    }
    return { ok: false, detail: 'second_teacher_failed' };
  }

  if (!(await verifyAdminPassword(db, second))) {
    return { ok: false, detail: 'second_admin_failed' };
  }
  return { ok: true, detail: 'teacher_plus_admin' };
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

export function twoPersonRequiredResponse(detail?: string): {
  error: string;
  message: string;
  detail?: string;
} {
  return {
    error: 'two_person_required',
    message:
      '最高保密档双人规则：须 confirmPassword（操作者）+ secondPassword（另一特权账号：教师操作须管理员口令；管理员操作须教师口令）',
    detail,
  };
}
