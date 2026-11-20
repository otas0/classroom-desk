export const APP_NAME = 'Work Desk';

export const APP_NOTICE =
  '本工具由企业部署，用于员工身份、权限与工时记录。打卡为考勤边界；在线时长仅作辅助。';

export type Role = 'admin' | 'manager' | 'employee';

export type PunchKind = 'clock_in' | 'clock_out';

export type OvertimeStatus = 'pending' | 'confirmed' | 'rejected';

/** Default standard workday length in minutes (8h). */
export const DEFAULT_STANDARD_MINUTES = 8 * 60;

export interface PublicUser {
  id: string;
  role: Role;
  displayName: string;
  username: string;
  employeeNo: string | null;
  departmentId: string | null;
  departmentName?: string | null;
}

export interface DayTimeSummary {
  date: string;
  employeeId: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  /** True when there is an open clock-in without matching clock-out. */
  isClockedIn: boolean;
  /** Completed punch intervals only; open shift not counted until clock-out. */
  punchedMinutes: number;
  /** Auxiliary online minutes from presence heartbeats. */
  onlineMinutes: number;
  standardMinutes: number;
  overtimeMinutes: number;
  overtimeStatus: OvertimeStatus | null;
}
