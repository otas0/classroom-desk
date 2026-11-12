import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { createApp } from '../app.js';
import { openDb } from '../db/client.js';
import { getSetting, migrate } from '../db/migrate.js';
import { ensureBootstrap } from '../services/auth.js';
import { listAudit } from '../services/audit.js';
import {
  KEY_PORTAL_SSID_REQUIRE_SIG,
  portalSsidRequireSig,
} from '../services/portalSsidSign.js';
import { upsertSetting } from '../services/exitLock.js';

const dir = mkdtempSync(path.join(tmpdir(), 'cd-campus-'));
process.env.CLASSROOM_DESK_DATA_DIR = dir;
process.env.CLASSROOM_DESK_E2E = '1';
process.env.JWT_SECRET = 'campus-preset-test-secret';
process.env.TEACHER_PASSWORD = 'CampusPresetPass9';
process.env.ADMIN_PASSWORD = 'AdminPass123';
process.env.TEACHER_USERNAME = 'teacher';

const db = migrate();
await ensureBootstrap(db);

upsertSetting(db, 'private_device_portal_only', '0');
upsertSetting(db, KEY_PORTAL_SSID_REQUIRE_SIG, '0');
assert.equal(getSetting(db, 'private_device_portal_only'), '0');
assert.equal(portalSsidRequireSig(db), false);

const app = createApp();
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}`;

const login = await fetch(`${base}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'teacher', password: 'CampusPresetPass9' }),
});
const loginText = await login.text();
assert.equal(login.status, 200, loginText);
const { token } = JSON.parse(loginText) as { token: string };
assert.ok(token);

const apply = await fetch(`${base}/api/v1/settings/campus-preset`, {
  method: 'PUT',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: '{}',
});
const applyText = await apply.text();
assert.equal(apply.status, 200, applyText);
const body = JSON.parse(applyText) as {
  privateDevicePortalOnly?: boolean;
  portalSsidRequireSig?: boolean;
};
assert.equal(body.privateDevicePortalOnly, true);
assert.equal(body.portalSsidRequireSig, true);

const liveDb = openDb();
assert.equal(getSetting(liveDb, 'private_device_portal_only'), '1');
assert.equal(portalSsidRequireSig(liveDb), true);

const audits = listAudit({ action: 'settings.campus_preset', limit: 5 });
assert.ok(audits.length >= 1);
assert.equal(audits[0]?.action, 'settings.campus_preset');
assert.match(String(audits[0]?.detail ?? ''), /portal_ssid_require_sig=1/);

// Round-trip off via private-device-mode + portal settings
const offDevice = await fetch(`${base}/api/v1/settings/private-device-mode`, {
  method: 'PUT',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ privateDevicePortalOnly: false }),
});
assert.equal(offDevice.status, 200);
const offSig = await fetch(`${base}/api/v1/portal/settings`, {
  method: 'PUT',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ portalSsidRequireSig: false }),
});
assert.equal(offSig.status, 200);
assert.equal(getSetting(openDb(), 'private_device_portal_only'), '0');
assert.equal(portalSsidRequireSig(openDb()), false);

await new Promise<void>((r) => server.close(() => r()));
rmSync(dir, { recursive: true, force: true });
console.log('campusPreset.test.ts ok');
