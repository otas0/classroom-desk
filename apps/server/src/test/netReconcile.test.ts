import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'cd-net-reconcile-'));
process.env.CLASSROOM_DESK_DATA_DIR = dir;
delete process.env.CLASSROOM_DESK_SHIELD;
delete process.env.CLASSROOM_DESK_DNS;

const { migrate } = await import('../db/migrate.js');
const { openDb } = await import('../db/client.js');
const { applyDeepLockAction } = await import('../services/deepLock.js');
const { buildNetReconcileReport } = await import('../services/netReconcile.js');
const {
  purgeExpiredAuditLog,
  resolveAuditRetentionDays,
  writeAudit,
  AUDIT_RETENTION_DAYS_DEFAULT,
} = await import('../services/audit.js');
const { upsertSetting } = await import('../services/exitLock.js');
const { resetShieldConnectorToOff } = await import('../services/shield/registry.js');

migrate();
resetShieldConnectorToOff();
const db = openDb();
upsertSetting(db, 'max_secrecy_mode', '0');

assert.equal(resolveAuditRetentionDays(db), AUDIT_RETENTION_DAYS_DEFAULT);

const idle = buildNetReconcileReport(db, null);
assert.equal(idle.paths.campus.shieldConfigured, false);
assert.equal(idle.failClosedOk, true);

// S-tier strict: refuse freeze when both paths unarmed
await assert.rejects(
  () =>
    applyDeepLockAction(db, { action: 'freeze', classId: 'class-a' }, {
      actorRole: 'teacher',
    }),
  /strict_net_fail_closed/,
);

// Allow findings path: relax strict for reconcile-banner coverage
upsertSetting(db, 'strict_net_fail_closed', '0');
await applyDeepLockAction(db, { action: 'freeze', classId: 'class-a' }, {
  actorRole: 'teacher',
});
const frozen = buildNetReconcileReport(db, 'class-a');
assert.equal(frozen.deepLock.frozen, true);
assert.equal(frozen.failClosedOk, false);
assert.ok(frozen.findings.some((f) => f.code === 'shield_off_while_deeplock'));

upsertSetting(db, 'deskdns_profile', 'exam');
const withDns = buildNetReconcileReport(db, 'class-a');
assert.ok(withDns.findings.some((f) => f.code === 'deskdns_exam_not_running'));

writeAudit({
  actorUserId: 't1',
  actorRole: 'teacher',
  action: 'test.old',
  detail: 'x',
});
// Force old timestamp
db.prepare(`UPDATE teacher_audit_log SET created_at = ?`).run(
  new Date(Date.now() - 200 * 86_400_000).toISOString(),
);
const purged = purgeExpiredAuditLog(db, 180);
assert.ok(purged.deleted >= 1);

console.log('netReconcile.test.ts ok');
