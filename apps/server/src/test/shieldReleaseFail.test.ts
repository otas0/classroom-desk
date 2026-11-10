import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrate } from '../db/migrate.js';
import { openDb, closeDb } from '../db/client.js';
import { applyDeepLockAction } from '../services/deepLock.js';
import { grantGatewayAccess, listGatewayAccess } from '../services/gatewayAllowlist.js';
import { listAudit } from '../services/audit.js';
import { MockShieldConnector } from '../services/shield/mockConnector.js';
import {
  clearShieldLastError,
  getShieldLastError,
} from '../services/shield/lastError.js';
import { resetShieldConnectorToMock, setShieldConnector } from '../services/shield/registry.js';

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

const mock = new MockShieldConnector();
mock.failRelease = true;
mock.failReleaseDetail = 'alias_delete_denied';
setShieldConnector(mock);
clearShieldLastError();

await applyDeepLockAction(db, { action: 'end', classId });

const err = getShieldLastError();
assert.ok(err);
assert.match(err.message, /alias_delete_denied|releaseClient/);

const audits = listAudit({ action: 'shield.release_client_fail', limit: 5 });
assert.ok(audits.length >= 1);
assert.match(String(audits[0]?.detail ?? ''), /alias_delete_denied/);

// Health payload should surface lastError
assert.equal(getShieldLastError()?.message.includes('alias_delete_denied'), true);
assert.equal(openDb(), db);

resetShieldConnectorToMock();
clearShieldLastError();
closeDb();
rmSync(dir, { recursive: true, force: true });
console.log('shieldReleaseFail.test.ts ok');
