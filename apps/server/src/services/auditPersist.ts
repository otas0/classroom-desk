import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { getDataDir } from '../db/client.js';

const GENESIS = 'GENESIS';
const HMAC_PREFIX = 'hmac1:';

export function auditGenesisHash(): string {
  return GENESIS;
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function hmac1Hex(payload: string): string {
  return (
    HMAC_PREFIX +
    createHmac('sha256', config.auditHmacKey).update(payload, 'utf8').digest('hex')
  );
}

function chainPayload(parts: {
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
  return [
    parts.prevHash,
    parts.id,
    parts.actorUserId ?? '',
    parts.actorRole ?? '',
    parts.action,
    parts.classId ?? '',
    parts.detail,
    parts.clientIp ?? '',
    parts.createdAt,
  ].join('|');
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

/** HMAC-SHA256 keyed chain (max-secrecy). Legacy callers may still verify plain SHA-256. */
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
  return hmac1Hex(chainPayload(parts));
}

/** Verify a stored row_hash against payload (supports hmac1: and legacy sha256). */
export function expectAuditRowHash(
  parts: {
    prevHash: string;
    id: string;
    actorUserId: string | null;
    actorRole: string | null;
    action: string;
    classId: string | null;
    detail: string;
    clientIp: string | null;
    createdAt: string;
  },
  stored: string,
): boolean {
  const payload = chainPayload(parts);
  if (stored.startsWith(HMAC_PREFIX)) {
    return stored === hmac1Hex(payload);
  }
  // Legacy unkeyed SHA-256 rows
  return stored === sha256Hex(payload);
}

function sealDir(): string {
  return path.join(getDataDir(), 'audit-seal');
}

/** Append-only JSONL mirror outside SQLite (purge does not delete). */
export function appendAuditSealMirror(row: {
  id: string;
  action: string;
  createdAt: string;
  prevHash: string;
  rowHash: string;
  classId: string | null;
  actorUserId: string | null;
}): void {
  try {
    const dir = sealDir();
    fs.mkdirSync(dir, { recursive: true });
    const line =
      JSON.stringify({
        ...row,
        sealedAt: new Date().toISOString(),
      }) + '\n';
    fs.appendFileSync(path.join(dir, 'audit.jsonl'), line, { encoding: 'utf8' });
  } catch (e) {
    console.error('[audit-seal] append failed', e instanceof Error ? e.message : e);
  }
}

export function auditSealPath(): string {
  return path.join(sealDir(), 'audit.jsonl');
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
  appendAuditSealMirror({
    id: row.id,
    action: row.action,
    createdAt: row.createdAt,
    prevHash,
    rowHash,
    classId: row.classId,
    actorUserId: row.actorUserId,
  });
  return { prevHash, rowHash };
}

/** HMAC over arbitrary UTF-8 body (compliance pack seal). */
export function hmacSealBody(bodyText: string): string {
  return createHmac('sha256', config.auditHmacKey).update(bodyText, 'utf8').digest('hex');
}
