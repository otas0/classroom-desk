import fs from 'node:fs';
import path from 'node:path';
import { getDataDir, openDb } from '../db/client.js';
import { newId, nowIso } from '../utils/id.js';
import { clearAuditWriteFailure, recordAuditWriteFailure } from './auditFail.js';

type QueuedAudit = {
  id: string;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  classId: string | null;
  detail: string;
  clientIp: string | null;
  createdAt: string;
  enqueuedAt: string;
  attempts: number;
};

const QUEUE_FILE = () => path.join(getDataDir(), 'audit-retry-queue.jsonl');
const MAX_ATTEMPTS = 8;

function readQueue(): QueuedAudit[] {
  try {
    if (!fs.existsSync(QUEUE_FILE())) return [];
    const lines = fs.readFileSync(QUEUE_FILE(), 'utf8').split('\n').filter(Boolean);
    return lines.map((line) => JSON.parse(line) as QueuedAudit);
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedAudit[]): void {
  fs.mkdirSync(path.dirname(QUEUE_FILE()), { recursive: true });
  if (items.length === 0) {
    if (fs.existsSync(QUEUE_FILE())) fs.unlinkSync(QUEUE_FILE());
    return;
  }
  fs.writeFileSync(QUEUE_FILE(), items.map((i) => JSON.stringify(i)).join('\n') + '\n', 'utf8');
}

export function enqueueAuditRetry(row: Omit<QueuedAudit, 'id' | 'enqueuedAt' | 'attempts'>): void {
  const items = readQueue();
  items.push({
    ...row,
    id: newId(),
    enqueuedAt: nowIso(),
    attempts: 0,
  });
  writeQueue(items);
}

/** Drain retry queue; returns flushed count. */
export function flushAuditRetryQueue(): { flushed: number; remaining: number; failed: number } {
  const items = readQueue();
  if (items.length === 0) return { flushed: 0, remaining: 0, failed: 0 };
  const db = openDb();
  const kept: QueuedAudit[] = [];
  let flushed = 0;
  let failed = 0;
  const insert = db.prepare(
    `INSERT INTO teacher_audit_log
       (id, actor_user_id, actor_role, action, class_id, detail, client_ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const item of items) {
    try {
      insert.run(
        item.id,
        item.actorUserId,
        item.actorRole,
        item.action,
        item.classId,
        item.detail,
        item.clientIp,
        item.createdAt,
      );
      flushed += 1;
    } catch {
      const next = { ...item, attempts: item.attempts + 1 };
      if (next.attempts >= MAX_ATTEMPTS) {
        failed += 1;
        recordAuditWriteFailure(
          new Error(`audit retry exhausted for ${item.action} after ${MAX_ATTEMPTS} attempts`),
        );
      } else {
        kept.push(next);
      }
    }
  }
  writeQueue(kept);
  if (kept.length === 0 && failed === 0) clearAuditWriteFailure();
  return { flushed, remaining: kept.length, failed };
}

export function auditRetryQueueSize(): number {
  return readQueue().length;
}
