/** Shared constants and DTO stubs for Classroom Desk */

export const APP_NAME = 'Classroom Desk';
export const APP_NOTICE =
  '本工具由学校部署，用于作业、留言和错题统计。';
export const ATTENDANCE_NOTICE =
  '签到仅记录本工具内的登录和在线状态。';

export const STUDENT_WINDOW = {
  width: 380,
  height: 560,
  collapsedHeight: 48,
} as const;

export type UserRole = 'student' | 'teacher' | 'admin';

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'leave';
export type PointRequestStatus = 'pending' | 'confirmed' | 'rejected' | 'expired';
export type PointsSource = 'request' | 'manual' | 'auto_rule';
