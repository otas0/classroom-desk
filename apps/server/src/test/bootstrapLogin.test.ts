import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate, getSetting } from '../db/migrate.js';
import {
  ensureBootstrap,
  isLoopbackAddress,
  tryBootstrapLogin,
} from '../services/auth.js';

const dir = mkdtempSync(path.join(tmpdir(), 'cd-bootlogin-'));
process.env.CLASSROOM_DESK_DATA_DIR = dir;
process.env.JWT_SECRET = 'bootstrap-login-test-secret-32chars!!';
process.env.TEACHER_USERNAME = 'teacher';
process.env.TEACHER_PASSWORD = 'BootstrapTeacherPass9';
process.env.ADMIN_PASSWORD = 'BootstrapAdminPass9';
process.env.BOOTSTRAP_LOGIN_TOKEN = 'setup-token-abcdefghijklmnopqrstuvwxyz';

const db = new DatabaseSync(path.join(dir, 'test.sqlite'));
migrate(db);
await ensureBootstrap(db);

assert.equal(getSetting(db, 'bootstrap_login_token'), process.env.BOOTSTRAP_LOGIN_TOKEN);
assert.equal(getSetting(db, 'bootstrap_login_used'), '0');
assert.equal(isLoopbackAddress('127.0.0.1'), true);
assert.equal(isLoopbackAddress('::1'), true);
assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
assert.equal(isLoopbackAddress('192.168.1.5'), false);

const denied = await tryBootstrapLogin(db, process.env.BOOTSTRAP_LOGIN_TOKEN!, '192.168.1.5');
assert.equal(denied.ok, false);
if (!denied.ok) assert.equal(denied.error, 'loopback_only');

const bad = await tryBootstrapLogin(db, 'wrong-token-xxxxxxxxxxxxxxxx', '127.0.0.1');
assert.equal(bad.ok, false);

const ok = await tryBootstrapLogin(db, process.env.BOOTSTRAP_LOGIN_TOKEN!, '127.0.0.1');
assert.equal(ok.ok, true);
if (ok.ok) {
  assert.ok(ok.jwt.length > 20);
  assert.equal(ok.user.role, 'teacher');
}
assert.equal(getSetting(db, 'bootstrap_login_used'), '1');
assert.equal(getSetting(db, 'teacher_password_ok'), '1');

const reused = await tryBootstrapLogin(db, process.env.BOOTSTRAP_LOGIN_TOKEN!, '127.0.0.1');
assert.equal(reused.ok, false);
if (!reused.ok) assert.equal(reused.error, 'token_used');

console.log('bootstrapLogin.test.ts: ok');
