/** Shared constants and DTO stubs for Classroom Desk */

export const APP_NAME = 'Classroom Desk';
export const APP_NOTICE =
  '本工具由学校部署，用于作业、留言和错题统计。';
export const ATTENDANCE_NOTICE =
  '签到仅记录本工具内的登录和在线状态。';

/** Bootstrap / lab passwords rejected for teacher accounts (single source for server + admin UI). */
export const WEAK_TEACHER_PASSWORDS = [
  'ChangeMe123',
  'TeacherPass123',
  'Classroom2026!',
  'Desk@179#2026',
  'AdminPass123',
  'password',
  '123456',
  'Password1',
  'password123',
] as const;

export function isWeakTeacherPassword(password: string, extra: readonly string[] = []): boolean {
  if ((WEAK_TEACHER_PASSWORDS as readonly string[]).includes(password)) return true;
  return extra.includes(password);
}

export const GITHUB_RELEASES_BASE = 'https://github.com/otas0/classroom-desk/releases';


export const STUDENT_WINDOW = {
  width: 380,
  height: 560,
  collapsedHeight: 48,
} as const;

export type UserRole = 'student' | 'teacher' | 'admin' | 'assistant';

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'leave';
export type PointRequestStatus = 'pending' | 'confirmed' | 'rejected' | 'expired';
export type PointsSource = 'request' | 'manual' | 'auto_rule';

/** Default soft-delete recycle retention (days). Overridable via settings.recycle_retention_days. */
export const RECYCLE_RETENTION_DAYS = 7;

export const RECYCLE_DAYS_LEFT_TESTID = 'recycle-days-left';

const MS_PER_DAY = 86_400_000;

export function recycleDaysLeft(
  deletedAt: unknown,
  retentionDays = RECYCLE_RETENTION_DAYS,
  nowMs = Date.now(),
): number | null {
  const deletedMs = Date.parse(String(deletedAt ?? ''));
  if (!Number.isFinite(deletedMs)) return null;
  const expiresAtMs = deletedMs + retentionDays * MS_PER_DAY;
  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / MS_PER_DAY));
}

/** Unified copy for student & question recycle rows. Pass `t` from @classroom-desk/i18n when localizing. */
export function formatRecycleDaysLeft(
  daysLeft: number | null | undefined,
  t: (msgid: string, vars?: Record<string, string | number>) => string = (s, vars) => {
    if (!vars) return s;
    return s.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) => String(vars[k] ?? ''));
  },
): string | null {
  if (daysLeft == null || !Number.isFinite(Number(daysLeft))) return null;
  const n = Math.max(0, Math.floor(Number(daysLeft)));
  return n === 0 ? t('剩余不足 1 天') : t('剩余 {v0} 天', { v0: n });
}

/** Default days-left threshold for “即将 purge” highlight (inclusive). */
export const RECYCLE_URGENT_DAYS = 1;

/** True when UI should warn that purge is imminent. */
export function isRecycleUrgent(
  daysLeft: number | null | undefined,
  urgentWithinDays: number = RECYCLE_URGENT_DAYS,
): boolean {
  if (daysLeft == null || !Number.isFinite(Number(daysLeft))) return false;
  const thr = Math.max(0, Math.floor(Number(urgentWithinDays) || RECYCLE_URGENT_DAYS));
  return Math.max(0, Math.floor(Number(daysLeft))) <= thr;
}
