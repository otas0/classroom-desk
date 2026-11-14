import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

const GENESIS = 'GENESIS';

export function auditGenesisHash(): string {
  return GENESIS;
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export function lastAuditRowHash(db: DatabaseSync): string {
  const row = db
    .prepare(
      `SELECT row_hash AS rowHash FROM teacher_audit_log
       WHERE row_hash IS NOT NULL AND row_hash != ''
       ORDER BY rowid DESC LIMIT 1`,
    )
    .get() as { rowHash?: string } | undefined;
  return String(row?.rowHash ?? '') || GENESIS;
}

export function computeAuditRowHash(parts: {
  prevHash: string;
  id: string;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  classId: string | null;
  detail: string;
  clientIp: string | null;
  createdAt: string;
}): string {
  return sha256Hex(
    [
      parts.prevHash,
      parts.id,
      parts.actorUserId ?? '',
      parts.actorRole ?? '',
      parts.action,
      parts.classId ?? '',
      parts.detail,
      parts.clientIp ?? '',
      parts.createdAt,
    ].join('|'),
  );
}

export function persistHashedAuditRow(
  db: DatabaseSync,
  row: {
    id: string;
    actorUserId: string | null;
    actorRole: string | null;
    action: string;
    classId: string | null;
    detail: string;
    clientIp: string | null;
    createdAt: string;
  },
): { prevHash: string; rowHash: string } {
  const prevHash = lastAuditRowHash(db);
  const rowHash = computeAuditRowHash({ prevHash, ...row });
  db.prepare(
    `INSERT INTO teacher_audit_log
       (id, actor_user_id, actor_role, action, class_id, detail, client_ip, created_at, prev_hash, row_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.actorUserId,
    row.actorRole,
    row.action,
    row.classId,
    row.detail,
    row.clientIp,
    row.createdAt,
    prevHash,
    rowHash,
  );
  return { prevHash, rowHash };
}
