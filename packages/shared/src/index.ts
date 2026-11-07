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
