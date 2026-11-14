import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import { newId, nowIso } from '../utils/id.js';
import { recyclePurgeCutoffIso, RECYCLE_RETENTION_DAYS } from '../utils/recycleRetention.js';
import { clearAuditWriteFailure, recordAuditWriteFailure } from './auditFail.js';
import { enqueueAuditRetry } from './auditRetry.js';
import {
  auditGenesisHash,
  computeAuditRowHash,
  persistHashedAuditRow,
} from './auditPersist.js';

export { RECYCLE_RETENTION_DAYS, computeAuditRowHash };

/** Verify append-only hash chain (S-tier tamper evidence). Legacy empty hashes are skipped. */
export function verifyAuditHashChain(
  db: DatabaseSync = openDb(),
  limit = 5_000,
): { ok: boolean; checked: number; brokenAt: string | null; tip: string } {
  const GENESIS = auditGenesisHash();
  const rows = db
    .prepare(
      `SELECT id, actor_user_id AS actorUserId, actor_role AS actorRole, action,
              class_id AS classId, detail, client_ip AS clientIp, created_at AS createdAt,
              prev_hash AS prevHash, row_hash AS rowHash
       FROM teacher_audit_log
       ORDER BY rowid ASC
       LIMIT ?`,
    )
    .all(Math.min(Math.max(limit, 1), 50_000)) as Array<{
    id: string;
    actorUserId: string | null;
    actorRole: string | null;
    action: string;
    classId: string | null;
    detail: string;
    clientIp: string | null;
    createdAt: string;
    prevHash: string | null;
    rowHash: string | null;
  }>;
  let prev = GENESIS;
  let checked = 0;
  for (const r of rows) {
    const rowHash = String(r.rowHash ?? '');
    if (!rowHash) {
      prev = GENESIS;
      continue;
    }
    const claimedPrev = String(r.prevHash ?? '') || GENESIS;
    const expect = computeAuditRowHash({
      prevHash: claimedPrev,
      id: r.id,
      actorUserId: r.actorUserId,
      actorRole: r.actorRole,
      action: r.action,
      classId: r.classId,
      detail: String(r.detail ?? ''),
      clientIp: r.clientIp,
      createdAt: r.createdAt,
    });
    if (claimedPrev !== prev && prev !== GENESIS) {
      return {
        ok: false,
        checked,
        brokenAt: r.id,
        tip: 'prev_hash discontinuity — possible insert/reorder',
      };
    }
    if (expect !== rowHash) {
      return {
        ok: false,
        checked,
        brokenAt: r.id,
        tip: 'row_hash mismatch — possible tamper',
      };
    }
    prev = rowHash;
    checked += 1;
  }
  return {
    ok: true,
    checked,
    brokenAt: null,
    tip: checked ? 'chain_ok' : 'no_hashed_rows_yet',
  };
}

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
  | 'questions.bulk_delete'
  | 'questions.bulk_purge'
  | 'questions.bulk_restore'
  | 'questions.bulk_close'
  | 'questions.bulk_reopen'
  | 'questions.bulk_archive'
  | 'questions.bulk_unarchive'
  | 'questions.bulk_set_closes_at'
  | 'questions.soft_delete'
  | 'questions.restore'
  | 'questions.purge'
  | 'questions.recycle_restore_all'
  | 'questions.recycle_purge_all'
  | 'ops.settings_migrate'
  | 'ops.export_tmp_cleanup'
  | 'auth.create_assistant'
  | 'auth.disable_assistant'
  | 'auth.enable_assistant'
  | 'auth.reset_assistant_password'
  | 'setup.scan_assign_cta'
  | 'setup.classroom_ready'
  | 'session.reset'
  | 'ops.audit_retry_flush'
  | 'ops.audit_retry_enqueue'
  | 'notify.restore_confirm_fail';

export function writeAudit(
  opts: {
    actorUserId: string | null | undefined;
    actorRole: string | null | undefined;
    action: AuditAction | string;
    classId?: string | null;
    detail?: Record<string, unknown> | string;
    clientIp?: string | null;
    /** Retry queue may preserve id/createdAt. */
    id?: string;
    createdAt?: string;
  },
  db: DatabaseSync = openDb(),
): void {
  const detail =
    typeof opts.detail === 'string' ? opts.detail : JSON.stringify(opts.detail ?? {});
  const createdAt = opts.createdAt ?? nowIso();
  const id = opts.id ?? newId();
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
    persistHashedAuditRow(db, {
      id,
      actorUserId: row.actorUserId,
      actorRole: row.actorRole,
      action: String(row.action),
      classId: row.classId,
      detail: row.detail,
      clientIp: row.clientIp,
      createdAt: row.createdAt,
    });
    clearAuditWriteFailure();
  } catch (e) {
    recordAuditWriteFailure(e);
    enqueueAuditRetry({ ...row, action: String(row.action) });
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
              class_id AS classId, detail, client_ip AS clientIp, created_at AS createdAt,
              prev_hash AS prevHash, row_hash AS rowHash
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

/** Default audit retention for compliance packs (days). */
export const AUDIT_RETENTION_DAYS_DEFAULT = 180;

export function resolveAuditRetentionDays(db: DatabaseSync, override?: number): number {
  let days = override;
  if (days == null || !Number.isFinite(days)) {
    days = Number(getSetting(db, 'audit_retention_days') ?? AUDIT_RETENTION_DAYS_DEFAULT);
  }
  return Math.max(30, Math.min(730, Math.trunc(Number(days) || AUDIT_RETENTION_DAYS_DEFAULT)));
}

/** Hard-delete audit rows older than retention (compliance rolling window). */
export function purgeExpiredAuditLog(
  db: DatabaseSync = openDb(),
  retentionDays?: number,
): { deleted: number; retentionDays: number; cutoff: string } {
  const days = resolveAuditRetentionDays(db, retentionDays);
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const result = db
    .prepare(`DELETE FROM teacher_audit_log WHERE created_at < ?`)
    .run(cutoff);
  return {
    deleted: Number(result.changes ?? 0),
    retentionDays: days,
    cutoff,
  };
}

export function countAuditLog(db: DatabaseSync = openDb()): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM teacher_audit_log`).get() as { n?: number };
  return Number(row?.n ?? 0);
}

function resolveRetentionDays(db: DatabaseSync, retentionDays?: number): number {
  let days = retentionDays;
  if (days == null || !Number.isFinite(days)) {
    days = Number(getSetting(db, 'recycle_retention_days') ?? RECYCLE_RETENTION_DAYS);
  }
  return Math.max(1, Math.min(365, Math.trunc(Number(days) || RECYCLE_RETENTION_DAYS)));
}

/** Preview how many soft-deleted rows would be hard-purged. */
export function previewPurgeExpiredSoftDeletes(
  db: DatabaseSync = openDb(),
  retentionDays?: number,
): {
  students: number;
  questions: number;
  count: number;
  retentionDays: number;
  cutoff: string;
  dryRun: true;
  /** Class with the most expired soft-deletes (for audit deep-link). */
  classId: string | null;
  byClass: Array<{ classId: string; name: string; students: number; questions: number; count: number }>;
} {
  const days = resolveRetentionDays(db, retentionDays);
  const cutoff = recyclePurgeCutoffIso(Date.now(), days);
  const students = Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM users
           WHERE role = 'student'
             AND deleted_at IS NOT NULL AND deleted_at != ''
             AND deleted_at < ?`,
        )
        .get(cutoff) as { n: number }
    ).n,
  );
  const questions = Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM questions
           WHERE deleted_at IS NOT NULL AND deleted_at != ''
             AND deleted_at < ?`,
        )
        .get(cutoff) as { n: number }
    ).n,
  );
  const classRows = db
    .prepare(`SELECT id, name FROM classes ORDER BY created_at DESC`)
    .all() as Array<{ id: string; name: string }>;
  const byClass: Array<{
    classId: string;
    name: string;
    students: number;
    questions: number;
    count: number;
  }> = [];
  for (const c of classRows) {
    const s = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM users
             WHERE role = 'student' AND class_id = ?
               AND deleted_at IS NOT NULL AND deleted_at != ''
               AND deleted_at < ?`,
          )
          .get(c.id, cutoff) as { n: number }
      ).n,
    );
    const q = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM questions
             WHERE class_id = ?
               AND deleted_at IS NOT NULL AND deleted_at != ''
               AND deleted_at < ?`,
          )
          .get(c.id, cutoff) as { n: number }
      ).n,
    );
    if (s + q > 0) {
      byClass.push({ classId: c.id, name: c.name, students: s, questions: q, count: s + q });
    }
  }
  byClass.sort((a, b) => b.count - a.count);
  return {
    students,
    questions,
    count: students + questions,
    retentionDays: days,
    cutoff,
    dryRun: true,
    classId: byClass[0]?.classId ?? null,
    byClass,
  };
}

export function purgeExpiredSoftDeletes(
  db: DatabaseSync = openDb(),
  retentionDays?: number,
): {
  students: number;
  questions: number;
  retentionDays: number;
} {
  const days = resolveRetentionDays(db, retentionDays);
  const cutoff = recyclePurgeCutoffIso(Date.now(), days);
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
  return {
    students: Number(s.changes ?? 0),
    questions: Number(q.changes ?? 0),
    retentionDays: days,
  };
}
