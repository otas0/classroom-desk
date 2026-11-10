import assert from 'node:assert/strict';
import http from 'node:http';
import {
  signPortalSsid,
  verifyPortalSsid,
  portalSsidQuery,
  portalSsidRequireSig,
} from '../services/portalSsidSign.js';
import { OpnsenseShieldConnector } from '../services/shield/opnsenseConnector.js';
import { UnifiShieldConnector } from '../services/shield/unifiConnector.js';
import {
  bumpPortalSessionEpoch,
  getPortalSessionEpoch,
  clearPortalSessionsOnLessonEnd,
} from '../services/portalSessionRevoke.js';
import {
  grantGatewayAccess,
  revokeGatewayAccessForClass,
  listGatewayAccess,
} from '../services/gatewayAllowlist.js';
import { migrate } from '../db/migrate.js';
import { DatabaseSync } from 'node:sqlite';

const ts = Math.floor(Date.now() / 1000);
const sig = signPortalSsid('Faculty', ts);
assert.equal(verifyPortalSsid({ ssid: 'Faculty', ts, sig }).ok, true);
assert.equal(verifyPortalSsid({ ssid: 'Faculty', ts, sig: 'deadbeef' }).ok, false);
assert.ok(portalSsidQuery('Student').includes('ssid_sig='));

// Force mode rejects unsigned
const prev = process.env.CLASSROOM_DESK_PORTAL_SSID_REQUIRE_SIG;
process.env.CLASSROOM_DESK_PORTAL_SSID_REQUIRE_SIG = '1';
assert.equal(portalSsidRequireSig(), true);
assert.equal(verifyPortalSsid({ ssid: 'Faculty' }).ok, false);
assert.equal(verifyPortalSsid({ ssid: 'Faculty' }).reason, 'ssid_unsigned_rejected');
assert.equal(verifyPortalSsid({ ssid: 'Faculty', ts, sig }).ok, true);
if (prev == null) delete process.env.CLASSROOM_DESK_PORTAL_SSID_REQUIRE_SIG;
else process.env.CLASSROOM_DESK_PORTAL_SSID_REQUIRE_SIG = prev;

const op = new OpnsenseShieldConnector({ baseUrl: '' });
const r = await op.authorizeClient({ clientKey: '10.1.2.3', mode: 'deny' });
assert.equal(r.ok, true);
assert.equal(op.isBlocked('10.1.2.3'), true);
const a = await op.authorizeClient({ clientKey: '10.1.2.3', mode: 'allowlist' });
assert.equal(a.ok, true);
assert.equal(op.isAllowed('10.1.2.3'), true);
assert.equal(op.isBlocked('10.1.2.3'), false);

// UniFi OS login path preference
{
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(String(req.url));
    if (req.url === '/api/auth/login') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Set-Cookie', ['TOKEN=csrf-test; Path=/', 'unifises=sess; Path=/']);
      res.writeHead(200);
      res.end('{}');
      return;
    }
    res.writeHead(404);
    res.end('no');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  const uni = new UnifiShieldConnector({
    baseUrl: `http://127.0.0.1:${port}`,
    user: 'u',
    pass: 'p',
  });
  const h = await uni.health();
  assert.equal(h.ok, true);
  assert.equal(uni.getLoginPathUsed(), '/api/auth/login');
  assert.ok(hits.includes('/api/auth/login'));
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

// Per-class portal epoch
{
  const db = new DatabaseSync(':memory:');
  migrate(db);
  const g0 = getPortalSessionEpoch(db);
  clearPortalSessionsOnLessonEnd(db, 'class-a');
  const aEpoch = getPortalSessionEpoch(db, 'class-a');
  const bEpoch = getPortalSessionEpoch(db, 'class-b');
  assert.ok(aEpoch > g0);
  assert.equal(bEpoch, g0, 'other class keeps global-only epoch');
  bumpPortalSessionEpoch(db); // global
  assert.ok(getPortalSessionEpoch(db, 'class-b') > g0);
}

// Per-class gateway allowlist revoke
{
  const db = new DatabaseSync(':memory:');
  migrate(db);
  grantGatewayAccess(db, { clientKey: 'a', classId: 'class-a', ip: '10.0.0.1' });
  grantGatewayAccess(db, { clientKey: 'b', classId: 'class-b', ip: '10.0.0.2' });
  assert.equal(listGatewayAccess(db).length, 2);
  const removed = revokeGatewayAccessForClass(db, 'class-a');
  assert.equal(removed.length, 1);
  assert.equal(removed[0]?.ip, '10.0.0.1');
  const left = listGatewayAccess(db);
  assert.equal(left.length, 1);
  assert.equal(left[0]?.classId, 'class-b');
}

console.log('portalSsidSign.test.ts ok');
