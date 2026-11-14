import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'cd-tier-s-'));
process.env.CLASSROOM_DESK_DATA_DIR = dir;
delete process.env.CLASSROOM_DESK_SHIELD;
delete process.env.CLASSROOM_DESK_DNS;
delete process.env.CLASSROOM_DESK_STRICT;
delete process.env.NODE_ENV;

const { migrate } = await import('../db/migrate.js');
const { openDb } = await import('../db/client.js');
const { writeAudit, verifyAuditHashChain } = await import('../services/audit.js');
const { applyDeepLockAction } = await import('../services/deepLock.js');
const { upsertSetting } = await import('../services/exitLock.js');
const { resetShieldConnectorToOff } = await import('../services/shield/registry.js');
const {
  portalUnmappedSoftAllowForbidden,
  securityTierSEnabled,
  strictNetFailClosed,
} = await import('../services/securityTier.js');

migrate();
resetShieldConnectorToOff();
const db = openDb();

assert.equal(securityTierSEnabled(db), true);
assert.equal(strictNetFailClosed(db), true);
assert.equal(portalUnmappedSoftAllowForbidden(db), true);

writeAudit({ actorUserId: 'a', actorRole: 'admin', action: 'tier.s.1', detail: 'one' });
writeAudit({ actorUserId: 'a', actorRole: 'admin', action: 'tier.s.2', detail: 'two' });
const chain = verifyAuditHashChain(db);
assert.equal(chain.ok, true);
assert.ok(chain.checked >= 2);

// Tamper
db.prepare(`UPDATE teacher_audit_log SET detail = 'tampered' WHERE action = 'tier.s.1'`).run();
const broken = verifyAuditHashChain(db);
assert.equal(broken.ok, false);

await assert.rejects(
  () => applyDeepLockAction(db, { action: 'freeze', classId: 'x' }),
  /strict_net_fail_closed/,
);

upsertSetting(db, 'security_tier_s', '0');
assert.equal(portalUnmappedSoftAllowForbidden(db), false);

console.log('securityTierS.test.ts ok');
