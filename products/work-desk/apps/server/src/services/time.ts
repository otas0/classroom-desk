import { nanoid } from 'nanoid';
import {
  DEFAULT_STANDARD_MINUTES,
  type DayTimeSummary,
  type OvertimeStatus,
  type PunchKind,
} from '@work-desk/shared';
import { getDb } from '../db/connection.js';

const PRESENCE_GAP_MS = 3 * 60 * 1000;

export function workDateFor(iso: string, timeZone = 'Asia/Shanghai'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function standardMinutesForUser(userId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(d.standard_minutes, CAST(s.value AS INTEGER), ?) AS minutes
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN settings s ON s.key = 'standard_minutes'
       WHERE u.id = ?`,
    )
    .get(DEFAULT_STANDARD_MINUTES, userId) as { minutes: number } | undefined;
  return Number(row?.minutes ?? DEFAULT_STANDARD_MINUTES);
}

export function latestOpenClockIn(userId: string, workDate: string): string | null {
  const punches = getDb()
    .prepare(
      `SELECT kind, punched_at AS punchedAt
       FROM time_punches
       WHERE user_id = ? AND work_date = ?
       ORDER BY punched_at ASC`,
    )
    .all(userId, workDate) as { kind: PunchKind; punchedAt: string }[];

  let open: string | null = null;
  for (const p of punches) {
    if (p.kind === 'clock_in') open = p.punchedAt;
    else if (p.kind === 'clock_out') open = null;
  }
  return open;
}

export function punch(input: {
  userId: string;
  kind: PunchKind;
  note?: string | null;
  at?: string;
}): { id: string; workDate: string; punchedAt: string } {
  const punchedAt = input.at ?? new Date().toISOString();
  const workDate = workDateFor(punchedAt);
  const open = latestOpenClockIn(input.userId, workDate);

  if (input.kind === 'clock_in' && open) {
    throw Object.assign(new Error('already_clocked_in'), { status: 409 });
  }
  if (input.kind === 'clock_out' && !open) {
    throw Object.assign(new Error('not_clocked_in'), { status: 409 });
  }

  const id = nanoid();
  getDb()
    .prepare(
      `INSERT INTO time_punches (id, user_id, kind, punched_at, work_date, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.userId,
      input.kind,
      punchedAt,
      workDate,
      input.note?.trim() || null,
      new Date().toISOString(),
    );

  if (input.kind === 'clock_out') {
    upsertOvertimeCandidate(input.userId, workDate);
  }

  return { id, workDate, punchedAt };
}

export function recordPresence(userId: string, clientIp?: string | null): void {
  const beatAt = new Date().toISOString();
  const workDate = workDateFor(beatAt);
  getDb()
    .prepare(
      `INSERT INTO presence_heartbeats (id, user_id, work_date, beat_at, client_ip)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(nanoid(), userId, workDate, beatAt, clientIp || null);
}

function punchedMinutes(userId: string, workDate: string): {
  clockInAt: string | null;
  clockOutAt: string | null;
  isClockedIn: boolean;
  minutes: number;
} {
  const punches = getDb()
    .prepare(
      `SELECT kind, punched_at AS punchedAt
       FROM time_punches
       WHERE user_id = ? AND work_date = ?
       ORDER BY punched_at ASC`,
    )
    .all(userId, workDate) as { kind: PunchKind; punchedAt: string }[];

  let clockInAt: string | null = null;
  let clockOutAt: string | null = null;
  let open: string | null = null;
  let totalMs = 0;

  for (const p of punches) {
    if (p.kind === 'clock_in') {
      if (!clockInAt) clockInAt = p.punchedAt;
      open = p.punchedAt;
    } else if (p.kind === 'clock_out' && open) {
      clockOutAt = p.punchedAt;
      totalMs += Date.parse(p.punchedAt) - Date.parse(open);
      open = null;
    }
  }

  if (open) {
    totalMs += Date.now() - Date.parse(open);
  }

  return {
    clockInAt,
    clockOutAt,
    isClockedIn: open != null,
    minutes: Math.max(0, Math.floor(totalMs / 60_000)),
  };
}

function onlineMinutes(userId: string, workDate: string): number {
  const beats = getDb()
    .prepare(
      `SELECT beat_at AS beatAt FROM presence_heartbeats
       WHERE user_id = ? AND work_date = ?
       ORDER BY beat_at ASC`,
    )
    .all(userId, workDate) as { beatAt: string }[];

  if (beats.length < 2) return 0;
  let totalMs = 0;
  for (let i = 1; i < beats.length; i++) {
    const gap = Date.parse(beats[i].beatAt) - Date.parse(beats[i - 1].beatAt);
    if (gap > 0 && gap <= PRESENCE_GAP_MS) totalMs += gap;
  }
  return Math.floor(totalMs / 60_000);
}

function upsertOvertimeCandidate(userId: string, workDate: string): void {
  const summary = daySummary(userId, workDate);
  if (summary.overtimeMinutes <= 0) {
    getDb()
      .prepare(
        `DELETE FROM overtime_reviews
         WHERE user_id = ? AND work_date = ? AND status = 'pending'`,
      )
      .run(userId, workDate);
    return;
  }

  const existing = getDb()
    .prepare(
      `SELECT id, status FROM overtime_reviews WHERE user_id = ? AND work_date = ?`,
    )
    .get(userId, workDate) as { id: string; status: OvertimeStatus } | undefined;

  if (!existing) {
    getDb()
      .prepare(
        `INSERT INTO overtime_reviews
          (id, user_id, work_date, overtime_minutes, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?)`,
      )
      .run(nanoid(), userId, workDate, summary.overtimeMinutes, new Date().toISOString());
    return;
  }

  if (existing.status === 'pending') {
    getDb()
      .prepare(`UPDATE overtime_reviews SET overtime_minutes = ? WHERE id = ?`)
      .run(summary.overtimeMinutes, existing.id);
  }
}

export function daySummary(userId: string, workDate: string): DayTimeSummary {
  const punch = punchedMinutes(userId, workDate);
  const standard = standardMinutesForUser(userId);
  const otRaw = Math.max(0, punch.minutes - standard);
  const review = getDb()
    .prepare(
      `SELECT status, overtime_minutes AS overtimeMinutes
       FROM overtime_reviews WHERE user_id = ? AND work_date = ?`,
    )
    .get(userId, workDate) as
    | { status: OvertimeStatus; overtimeMinutes: number }
    | undefined;

  return {
    date: workDate,
    employeeId: userId,
    clockInAt: punch.clockInAt,
    clockOutAt: punch.clockOutAt,
    isClockedIn: punch.isClockedIn,
    punchedMinutes: punch.minutes,
    onlineMinutes: onlineMinutes(userId, workDate),
    standardMinutes: standard,
    overtimeMinutes: review?.status === 'confirmed' ? review.overtimeMinutes : otRaw,
    overtimeStatus: review?.status ?? (otRaw > 0 ? 'pending' : null),
  };
}

export function listDaySummaries(workDate: string, departmentId?: string | null): DayTimeSummary[] {
  let sql = `SELECT id FROM users WHERE disabled_at IS NULL AND role IN ('employee', 'manager')`;
  const params: string[] = [];
  if (departmentId) {
    sql += ` AND department_id = ?`;
    params.push(departmentId);
  }
  sql += ` ORDER BY display_name COLLATE NOCASE`;
  const users = getDb().prepare(sql).all(...params) as { id: string }[];
  return users.map((u) => daySummary(u.id, workDate));
}

export function reviewOvertime(input: {
  userId: string;
  workDate: string;
  status: 'confirmed' | 'rejected';
  reviewerId: string;
  note?: string | null;
}): void {
  const summary = daySummary(input.userId, input.workDate);
  if (summary.overtimeMinutes <= 0 && input.status === 'confirmed') {
    throw Object.assign(new Error('no_overtime'), { status: 400 });
  }

  const existing = getDb()
    .prepare(`SELECT id FROM overtime_reviews WHERE user_id = ? AND work_date = ?`)
    .get(input.userId, input.workDate) as { id: string } | undefined;

  const now = new Date().toISOString();
  if (!existing) {
    getDb()
      .prepare(
        `INSERT INTO overtime_reviews
          (id, user_id, work_date, overtime_minutes, status, reviewer_id, reviewed_at, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nanoid(),
        input.userId,
        input.workDate,
        summary.overtimeMinutes,
        input.status,
        input.reviewerId,
        now,
        input.note?.trim() || null,
        now,
      );
    return;
  }

  getDb()
    .prepare(
      `UPDATE overtime_reviews
       SET overtime_minutes = ?, status = ?, reviewer_id = ?, reviewed_at = ?, note = ?
       WHERE id = ?`,
    )
    .run(
      summary.overtimeMinutes,
      input.status,
      input.reviewerId,
      now,
      input.note?.trim() || null,
      existing.id,
    );
}
