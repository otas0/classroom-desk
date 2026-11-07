import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../db/client.js';
import { newId, nowIso } from '../utils/id.js';
import { recyclePurgeCutoffIso, RECYCLE_RETENTION_DAYS } from '../utils/recycleRetention.js';
import { clearAuditWriteFailure, recordAuditWriteFailure } from './auditFail.js';
import { enqueueAuditRetry } from './auditRetry.js';

export { RECYCLE_RETENTION_DAYS };

export type AuditAction =
  | 'students.bulk_soft_delete'
  | 'students.bulk_restore'
  | 'students.bulk_purge'
  | 'students.bulk_student_no'
  | 'students.soft_delete'
  | 'students.purge'
  | 'students.recycle_restore_all'
  | 'students.recycle_purge_all'
  | 'questions.bulk'
  | 'questions.soft_delete'
  | 'questions.restore'
  | 'questions.purge'
  | 'questions.recycle_restore_all'
  | 'questions.recycle_purge_all'
  | 'auth.create_assistant'
  | 'auth.disable_assistant'
  | 'auth.enable_assistant'
  | 'auth.reset_assistant_password';

export function writeAudit(
  opts: {
    actorUserId: string | null | undefined;
    actorRole: string | null | undefined;
    action: AuditAction | string;
    classId?: string | null;
    detail?: Record<string, unknown> | string;
    clientIp?: string | null;
  },
  db: DatabaseSync = openDb(),
): void {
  const detail =
    typeof opts.detail === 'string' ? opts.detail : JSON.stringify(opts.detail ?? {});
  const createdAt = nowIso();
  const row = {
    actorUserId: opts.actorUserId ?? null,
    actorRole: opts.actorRole ?? null,
    action: opts.action,
    classId: opts.classId ?? null,
    detail,
    clientIp: opts.clientIp ?? null,
    createdAt,
  };
  try {
    db.prepare(
      `INSERT INTO teacher_audit_log
         (id, actor_user_id, actor_role, action, class_id, detail, client_ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId(),
      row.actorUserId,
      row.actorRole,
      row.action,
      row.classId,
      row.detail,
      row.clientIp,
      row.createdAt,
    );
    clearAuditWriteFailure();
  } catch (e) {
    recordAuditWriteFailure(e);
    enqueueAuditRetry(row);
  }
}

export function listAudit(opts?: {
  limit?: number;
  classId?: string;
  action?: string;
}): Array<Record<string, unknown>> {
  const db = openDb();
  const lim = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
  const classId = opts?.classId?.trim() || '';
  const action = opts?.action?.trim() || '';
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (classId) {
    clauses.push(`class_id = ?`);
    params.push(classId);
  }
  if (action) {
    clauses.push(`action = ?`);
    params.push(action);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT id, actor_user_id AS actorUserId, actor_role AS actorRole, action,
              class_id AS classId, detail, client_ip AS clientIp, created_at AS createdAt
       FROM teacher_audit_log
       ${where}
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(...params, lim) as Array<Record<string, unknown>>;
}

export function listAuditActions(): string[] {
  const db = openDb();
  const rows = db
    .prepare(`SELECT DISTINCT action FROM teacher_audit_log ORDER BY action`)
    .all() as Array<{ action: string }>;
  return rows.map((r) => r.action);
}

export function purgeExpiredSoftDeletes(db: DatabaseSync = openDb()): {
  students: number;
  questions: number;
} {
  const cutoff = recyclePurgeCutoffIso();
  const s = db
    .prepare(
      `DELETE FROM users
       WHERE role = 'student'
         AND deleted_at IS NOT NULL AND deleted_at != ''
         AND deleted_at < ?`,
    )
    .run(cutoff);
  const q = db
    .prepare(
      `DELETE FROM questions
       WHERE deleted_at IS NOT NULL AND deleted_at != ''
         AND deleted_at < ?`,
    )
    .run(cutoff);
  return { students: Number(s.changes ?? 0), questions: Number(q.changes ?? 0) };
}
