import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'cd-maxsec-'));
process.env.CLASSROOM_DESK_DATA_DIR = dir;
process.env.JWT_SECRET = 'maxsec-test-jwt-secret-32bytes!!';
process.env.AUDIT_HMAC_KEY = 'maxsec-test-audit-hmac-key-32b';
delete process.env.CLASSROOM_DESK_SHIELD;
delete process.env.CLASSROOM_DESK_DNS;
delete process.env.CLASSROOM_DESK_STRICT;
delete process.env.NODE_ENV;

const { migrate, getSetting } = await import('../db/migrate.js');
const { openDb, getDataDir } = await import('../db/client.js');
const { writeAudit, verifyAuditHashChain } = await import('../services/audit.js');
const { applyDeepLockAction } = await import('../services/deepLock.js');
const { upsertSetting } = await import('../services/exitLock.js');
const { resetShieldConnectorToOff } = await import('../services/shield/registry.js');
const {
  maxSecrecyEnabled,
  evaluateDualPathRequired,
  applyMaxSecrecyPosture,
  setMaxSecrecyMode,
  tickMaxSecrecyWatchdog,
} = await import('../services/maxSecrecy.js');
const { hmacSealBody, auditSealPath } = await import('../services/auditPersist.js');

migrate();
resetShieldConnectorToOff();
const db = openDb();

assert.equal(maxSecrecyEnabled(db), true);
assert.equal(evaluateDualPathRequired(db).ok, false);

writeAudit({ actorUserId: 'a', actorRole: 'admin', action: 'maxsec.1', detail: 'one' });
writeAudit({ actorUserId: 'a', actorRole: 'admin', action: 'maxsec.2', detail: 'two' });
const chain = verifyAuditHashChain(db);
assert.equal(chain.ok, true);
assert.equal(chain.keyed, true);
assert.ok(chain.tip.includes('hmac'));

const seal = auditSealPath();
assert.ok(existsSync(seal), 'audit seal mirror');
const sealText = readFileSync(seal, 'utf8');
assert.ok(sealText.includes('maxsec.1'));
assert.ok(sealText.includes('hmac1:'));

await assert.rejects(
  () => applyDeepLockAction(db, { action: 'freeze', classId: 'x' }),
  /max_secrecy_dual_path/,
);

// S-tier OR-path when max secrecy off
setMaxSecrecyMode(db, false);
assert.equal(maxSecrecyEnabled(db), false);
await assert.rejects(
  () => applyDeepLockAction(db, { action: 'freeze', classId: 'x' }),
  /strict_net_fail_closed/,
);

setMaxSecrecyMode(db, true);
const forced = applyMaxSecrecyPosture(db);
assert.equal(forced.student_easy_join, '0');
assert.equal(getSetting(db, 'portal_ssid_require_sig'), '1');
assert.equal(getSetting(db, 'private_device_portal_only'), '1');

// Watchdog: tight lock + no heartbeat → lockdown
upsertSetting(
  db,
  'deep_lock_store',
  JSON.stringify({
    global: {
      frozen: true,
      netMode: 'deny',
      allowlistHosts: [],
      examUrl: '',
      killForeignBrowsers: true,
      killDistractions: true,
      focusFreeze: true,
      updatedAt: new Date().toISOString(),
    },
    byClass: {},
  }),
);
const wd = tickMaxSecrecyWatchdog(db);
assert.equal(wd.lockdown, true);
assert.ok(wd.reason);

const body = '{"a":1}';
const mac = hmacSealBody(body);
assert.equal(mac.length, 64);
assert.ok(getDataDir().includes('cd-maxsec-'));

console.log('maxSecrecy.test.ts ok');
