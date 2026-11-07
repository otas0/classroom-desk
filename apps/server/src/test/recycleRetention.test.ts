import assert from 'node:assert/strict';
import {
  RECYCLE_RETENTION_DAYS,
  recyclePurgeCutoffIso,
  recycleTiming,
} from '../utils/recycleRetention.js';

const DAY = 86_400_000;

function run() {
  const now = Date.parse('2026-11-07T12:00:00.000Z');

  // Fresh delete → 7 days left
  {
    const deletedAt = new Date(now).toISOString();
    const t = recycleTiming(deletedAt, now);
    assert.equal(t.daysLeft, RECYCLE_RETENTION_DAYS);
    assert.equal(t.expired, false);
  }

  // Exactly at retention boundary: deleted_at == cutoff → not yet purged (strict <)
  {
    const deletedAt = new Date(now - RECYCLE_RETENTION_DAYS * DAY).toISOString();
    const cutoff = recyclePurgeCutoffIso(now);
    assert.equal(deletedAt, cutoff);
    const t = recycleTiming(deletedAt, now);
    assert.equal(t.daysLeft, 0);
    assert.equal(t.expired, false, 'boundary row must survive purge (deleted_at < cutoff)');
  }

  // 1ms past boundary → expired + 0 days
  {
    const deletedAt = new Date(now - RECYCLE_RETENTION_DAYS * DAY - 1).toISOString();
    const t = recycleTiming(deletedAt, now);
    assert.equal(t.daysLeft, 0);
    assert.equal(t.expired, true);
  }

  // Almost gone: 12h left → ceil → 1 day
  {
    const deletedAt = new Date(now - RECYCLE_RETENTION_DAYS * DAY + 12 * 3600_000).toISOString();
    const t = recycleTiming(deletedAt, now);
    assert.equal(t.daysLeft, 1);
    assert.equal(t.expired, false);
  }

  // Invalid
  {
    const t = recycleTiming('not-a-date', now);
    assert.equal(t.daysLeft, null);
    assert.equal(t.expiresAt, null);
  }

  console.log('recycleRetention.test.ts ok');
}

run();
