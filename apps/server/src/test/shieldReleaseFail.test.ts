import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrate } from '../db/migrate.js';
import { openDb, closeDb } from '../db/client.js';
import { applyDeepLockAction } from '../services/deepLock.js';
import { grantGatewayAccess, listGatewayAccess } from '../services/gatewayAllowlist.js';
import { listAudit } from '../services/audit.js';
import {
  clearShieldLastError,
  getShieldLastError,
} from '../services/shield/lastError.js';
import { resetShieldConnectorToOff } from '../services/shield/registry.js';
import { startLabShieldHttp } from './helpers/labShieldHttp.js';

const dir = mkdtempSync(path.join(tmpdir(), 'cd-shield-fail-'));
process.env.CLASSROOM_DESK_DATA_DIR = dir;
closeDb();

const db = migrate();
const classId = 'class-fail';
db.prepare(`INSERT INTO classes (id, name, class_code, created_at) VALUES (?, ?, ?, ?)`).run(
  classId,
  '失败班',
  'FF',
  new Date().toISOString(),
);

grantGatewayAccess(db, {
  ip: '10.9.9.9',
  classId,
  studentId: 's1',
  clientKey: '10.9.9.9',
});
assert.equal(listGatewayAccess(db).some((x) => x.ip === '10.9.9.9'), true);

const lab = await startLabShieldHttp({ failRelease: true });
clearShieldLastError();

await applyDeepLockAction(db, { action: 'end', classId });

const err = getShieldLastError();
assert.ok(err);
assert.match(err.message, /lab_release_boom|releaseClient|http_500/);

const audits = listAudit({ action: 'shield.release_client_fail', limit: 5 });
assert.ok(audits.length >= 1);
assert.match(String(audits[0]?.detail ?? ''), /lab_release_boom|http_500/);

assert.equal(openDb(), db);

lab.stop();
resetShieldConnectorToOff();
clearShieldLastError();
closeDb();
rmSync(dir, { recursive: true, force: true });
console.log('shieldReleaseFail.test.ts ok');
