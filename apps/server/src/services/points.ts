import type { DatabaseSync } from 'node:sqlite';
import { newId, nowIso } from '../utils/id.js';

export type PointsSource = 'request' | 'manual' | 'auto_rule';
export type PointsMode = 'auto' | 'manual';

export function addPoints(
  db: DatabaseSync,
  input: {
    studentId: string;
    classId: string;
    points: number;
    reasonSummary: string;
    source: PointsSource;
    mode?: PointsMode;
    requestId?: string | null;
    createdBy?: string | null;
    idempotencyKey: string;
  },
): { ok: true; id: string } | { ok: false; reason: 'duplicate' } {
  const existing = db
    .prepare(`SELECT id FROM points_log WHERE idempotency_key = ?`)
    .get(input.idempotencyKey) as { id: string } | undefined;
  if (existing) return { ok: false, reason: 'duplicate' };

  const id = newId();
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO points_log
      (id, student_id, class_id, points, reason_summary, source, request_id, mode, created_by, created_at, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.studentId,
    input.classId,
    input.points,
    input.reasonSummary,
    input.source,
    input.requestId ?? null,
    input.mode ?? 'manual',
    input.createdBy ?? null,
    createdAt,
    input.idempotencyKey,
  );

  db.prepare(`UPDATE users SET total_points = total_points + ? WHERE id = ?`).run(
    input.points,
    input.studentId,
  );

  return { ok: true, id };
}
