import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'cd-maxsec-x-'));
process.env.CLASSROOM_DESK_DATA_DIR = dir;
process.env.JWT_SECRET = 'maxsec-extreme-jwt-secret-32b!!';
process.env.AUDIT_HMAC_KEY = 'maxsec-extreme-audit-hmac-32b';
delete process.env.CLASSROOM_DESK_SHIELD;
delete process.env.CLASSROOM_DESK_DNS;
delete process.env.NODE_ENV;

const { migrate, getSetting } = await import('../db/migrate.js');
const { openDb } = await import('../db/client.js');
const { upsertSetting } = await import('../services/exitLock.js');
const { hashPassword } = await import('../services/auth.js');
const {
  encryptSecretPlain,
  decryptSecretStored,
  setSecretSetting,
  getSecretSetting,
} = await import('../services/secretAtRest.js');
const { verifyTwoPersonRule } = await import('../services/reauth.js');
const {
  maxSecrecyAirgap,
  maxSecrecyBindIp,
  applyMaxSecrecyPosture,
  tickMaxSecrecyWatchdog,
} = await import('../services/maxSecrecy.js');

migrate();
const db = openDb();

assert.equal(maxSecrecyAirgap(db), true);
assert.equal(maxSecrecyBindIp(db), true);

const plain = 'super-shield-token-xyz';
const enc = encryptSecretPlain(plain);
assert.ok(enc.startsWith('enc1:'));
assert.equal(decryptSecretStored(enc), plain);
assert.equal(decryptSecretStored(plain), plain); // legacy passthrough

setSecretSetting(db, 'shield_http_token', plain);
const raw = String(getSetting(db, 'shield_http_token') ?? '');
assert.ok(raw.startsWith('enc1:'));
assert.equal(getSecretSetting(db, 'shield_http_token'), plain);

const forced = applyMaxSecrecyPosture(db);
assert.equal(forced.max_secrecy_airgap, '1');
assert.equal(getSetting(db, 'federation_hub_url'), '');

// Two-person: admin + teacher
const adminHash = await hashPassword('AdminPass1!');
upsertSetting(db, 'admin_password_hash', adminHash);
const teacherHash = await hashPassword('TeacherPass1!');
db.prepare(
  `INSERT INTO users (id, role, display_name, username, password_hash, class_id, total_points, created_at)
   VALUES ('t1', 'teacher', 'T', 'teacher1', ?, NULL, 0, ?)`,
).run(teacherHash, new Date().toISOString());

const bad = await verifyTwoPersonRule(db, {
  userId: 't1',
  role: 'teacher',
  confirmPassword: 'TeacherPass1!',
  secondPassword: 'TeacherPass1!',
});
assert.equal(bad.ok, false);

const good = await verifyTwoPersonRule(db, {
  userId: 't1',
  role: 'teacher',
  confirmPassword: 'TeacherPass1!',
  secondPassword: 'AdminPass1!',
});
assert.equal(good.ok, true);

const adminTwo = await verifyTwoPersonRule(db, {
  userId: 'admin',
  role: 'admin',
  confirmPassword: 'AdminPass1!',
  secondPassword: 'TeacherPass1!',
});
assert.equal(adminTwo.ok, true);

// Watchdog autokick
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
db.prepare(
  `INSERT INTO classes (id, name, class_code, created_at) VALUES ('c1', '一班', 'C1', ?)`,
).run(new Date().toISOString());
db.prepare(
  `INSERT INTO users (id, role, display_name, username, password_hash, class_id, total_points, created_at)
   VALUES ('s1', 'student', 'S', NULL, NULL, 'c1', 0, ?)`,
).run(new Date().toISOString());
db.prepare(
  `INSERT INTO presence_heartbeats (student_id, class_id, last_seen_at, client_id)
   VALUES ('s1', 'c1', ?, 'cli')`,
).run(new Date().toISOString());

const wd = tickMaxSecrecyWatchdog(db);
assert.equal(wd.lockdown, true);
assert.ok((wd.kicked ?? 0) >= 1);
const kick = db.prepare(`SELECT student_id FROM session_kicks WHERE student_id = 's1'`).get();
assert.ok(kick);

console.log('maxSecrecyExtreme.test.ts ok');
