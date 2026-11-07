import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getDataDir, openDb } from '../db/client.js';
import {
  auditRetryQueueSize,
  enqueueAuditRetry,
  flushAuditRetryQueue,
} from '../services/auditRetry.js';
import { clearAuditWriteFailure, recordAuditWriteFailure } from '../services/auditFail.js';

function queuePath() {
  return path.join(getDataDir(), 'audit-retry-queue.jsonl');
}

function run() {
  // Isolate queue file for this process
  if (fs.existsSync(queuePath())) fs.unlinkSync(queuePath());
  clearAuditWriteFailure();

  assert.equal(auditRetryQueueSize(), 0);

  const stamp = Date.now();
  enqueueAuditRetry({
    actorUserId: null,
    actorRole: 'teacher',
    action: 'test.audit_retry',
    classId: null,
    detail: JSON.stringify({ stamp, ids: Array.from({ length: 40 }, (_, i) => `id-${i}`) }),
    clientIp: null,
    createdAt: new Date().toISOString(),
  });
  recordAuditWriteFailure(new Error('simulated audit write failure'));
  assert.equal(auditRetryQueueSize(), 1);

  const flushed = flushAuditRetryQueue();
  assert.equal(flushed.flushed, 1);
  assert.equal(flushed.remaining, 0);
  assert.equal(auditRetryQueueSize(), 0);

  const db = openDb();
  const row = db
    .prepare(`SELECT action, detail FROM teacher_audit_log WHERE action = ? ORDER BY created_at DESC LIMIT 1`)
    .get('test.audit_retry') as { action: string; detail: string } | undefined;
  assert.ok(row);
  assert.match(row!.detail, new RegExp(String(stamp)));

  // Second: enqueue then flush when insert would fail is hard without mocking sqlite;
  // verify queue file written then drained.
  enqueueAuditRetry({
    actorUserId: null,
    actorRole: 'teacher',
    action: 'test.audit_retry_2',
    classId: null,
    detail: '{}',
    clientIp: null,
    createdAt: new Date().toISOString(),
  });
  assert.ok(fs.existsSync(queuePath()));
  const again = flushAuditRetryQueue();
  assert.equal(again.flushed, 1);
  assert.equal(auditRetryQueueSize(), 0);
  assert.ok(!fs.existsSync(queuePath()));

  console.log('auditRetry.test.ts ok');
}

run();
