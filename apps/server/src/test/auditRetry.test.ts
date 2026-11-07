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

async function run() {
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

  // /health exposes retryQueueSize when API is up (best-effort)
  enqueueAuditRetry({
    actorUserId: null,
    actorRole: 'teacher',
    action: 'test.audit_retry_health',
    classId: null,
    detail: '{}',
    clientIp: null,
    createdAt: new Date().toISOString(),
  });
  assert.equal(auditRetryQueueSize(), 1);
  try {
    const res = await fetch('http://127.0.0.1:8787/health');
    if (res.ok) {
      const body = (await res.json()) as { audit?: { retryQueueSize?: number } };
      assert.ok((body.audit?.retryQueueSize ?? 0) >= 1);
    }
  } catch {
    /* API not running — queue size unit check above is enough */
  }
  flushAuditRetryQueue();
  assert.equal(auditRetryQueueSize(), 0);

  console.log('auditRetry.test.ts ok');
}

void run().catch((e) => {
  console.error(e);
  process.exit(1);
});
