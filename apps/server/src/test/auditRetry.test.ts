import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb, getDataDir, openDb } from '../db/client.js';
import { migrate } from '../db/migrate.js';
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
  const prevData = process.env.CLASSROOM_DESK_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-audit-retry-'));
  process.env.CLASSROOM_DESK_DATA_DIR = dir;
  closeDb();

  try {
    migrate();
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
      .prepare(
        `SELECT action, detail FROM teacher_audit_log WHERE action = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get('test.audit_retry') as { action: string; detail: string } | undefined;
    assert.ok(row);
    assert.match(row!.detail, new RegExp(String(stamp)));

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
        // Live API uses a different data dir; only assert shape when present.
        assert.ok(typeof (body.audit?.retryQueueSize ?? 0) === 'number');
      }
    } catch {
      /* API not running */
    }
    flushAuditRetryQueue();
    assert.equal(auditRetryQueueSize(), 0);

    console.log('auditRetry.test.ts ok');
  } finally {
    closeDb();
    if (prevData === undefined) delete process.env.CLASSROOM_DESK_DATA_DIR;
    else process.env.CLASSROOM_DESK_DATA_DIR = prevData;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

void run().catch((e) => {
  console.error(e);
  process.exit(1);
});
