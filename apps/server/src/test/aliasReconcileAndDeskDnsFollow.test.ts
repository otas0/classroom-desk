import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(path.join(tmpdir(), 'cd-alias-recon-'));
process.env.CLASSROOM_DESK_DATA_DIR = dir;
delete process.env.CLASSROOM_DESK_SHIELD;
delete process.env.CLASSROOM_DESK_DNS;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const lab = spawn(process.execPath, [path.join(root, 'deploy/lab-opnsense-api/server.mjs')], {
  env: {
    ...process.env,
    LAB_OPNSENSE_PORT: '18792',
    LAB_OPNSENSE_STATE: path.join(dir, 'lab-opn.json'),
  },
  stdio: 'ignore',
});
await sleep(400);

process.env.CLASSROOM_DESK_SHIELD = 'opnsense';
process.env.OPNSENSE_URL = 'http://127.0.0.1:18792';
process.env.OPNSENSE_API_KEY = 'lab';
process.env.OPNSENSE_API_SECRET = 'lab';

const { migrate } = await import('../db/migrate.js');
const { openDb } = await import('../db/client.js');
const { reloadShieldConnectorFromEnv } = await import('../services/shield/registry.js');
const { grantGatewayAccess } = await import('../services/gatewayAllowlist.js');
const { reconcileGatewayAliases } = await import('../services/gatewayAliasReconcile.js');
const { applyDeepLockAction } = await import('../services/deepLock.js');
const { getSetting } = await import('../db/migrate.js');
const { getShieldConnector } = await import('../services/shield/registry.js');

migrate();
reloadShieldConnectorFromEnv();
const db = openDb();

const connector = getShieldConnector();
assert.equal(connector.id, 'opnsense');

grantGatewayAccess(db, {
  clientKey: '10.1.2.3',
  ip: '10.1.2.3',
  classId: 'c1',
  ttlSec: 3600,
});

// Push allow onto lab alias so remote matches local.
await connector.authorizeClient!({
  clientKey: '10.1.2.3',
  mode: 'allow',
});

const matched = await reconcileGatewayAliases(db, 'c1');
assert.equal(matched.remoteReadable, true);
assert.ok(matched.remoteAllow.includes('10.1.2.3'));
assert.equal(matched.missingOnGateway.length, 0);
assert.equal(matched.ok, true);

// Drift: local has IP not on gateway
grantGatewayAccess(db, {
  clientKey: '10.9.9.9',
  ip: '10.9.9.9',
  classId: 'c1',
  ttlSec: 3600,
});
const drift = await reconcileGatewayAliases(db, 'c1');
assert.ok(drift.missingOnGateway.includes('10.9.9.9'));
assert.equal(drift.ok, false);

// DeskDNS follow deep-lock
assert.equal(getSetting(db, 'deskdns_profile') || 'normal', 'normal');
await applyDeepLockAction(db, { action: 'freeze', classId: 'c1' });
assert.equal(getSetting(db, 'deskdns_profile'), 'exam');
await applyDeepLockAction(db, { action: 'end', classId: 'c1' });
assert.equal(getSetting(db, 'deskdns_profile'), 'normal');

lab.kill('SIGTERM');
console.log('aliasReconcileAndDeskDnsFollow.test.ts ok');
