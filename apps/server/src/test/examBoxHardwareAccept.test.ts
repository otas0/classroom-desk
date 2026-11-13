import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeDb, openDb } from '../db/client.js';
import { getSetting, migrate } from '../db/migrate.js';
import { productCapabilities } from '../services/portalAuth.js';
import { upsertSetting } from '../services/exitLock.js';

const dir = mkdtempSync(path.join(tmpdir(), 'cd-exam-hw-'));
process.env.CLASSROOM_DESK_DATA_DIR = dir;
delete process.env.CLASSROOM_DESK_EXAM_BOX_HARDWARE;
closeDb();

const db = openDb();
migrate(db);

assert.equal(productCapabilities().salesPhase, 'pilot');
assert.equal(productCapabilities().gaReady, false);
assert.equal(productCapabilities().examBoxHardware, false);

upsertSetting(db, 'exam_box_hardware_accepted', '1');
assert.equal(productCapabilities().examBoxHardware, false, 'accept without serial/tag stays false');
assert.equal(productCapabilities().gaReady, false, 'hardware accept does not flip GA');

upsertSetting(db, 'exam_box_serial', 'EB-TEST-001');
upsertSetting(db, 'exam_box_image_tag', 'sha-deadbeef');
assert.equal(productCapabilities().examBoxHardware, true);
assert.equal(productCapabilities().salesPhase, 'pilot');
assert.equal(productCapabilities().gaReady, false);
assert.equal(getSetting(db, 'exam_box_serial'), 'EB-TEST-001');

upsertSetting(db, 'exam_box_hardware_accepted', '0');
assert.equal(productCapabilities().examBoxHardware, false);

process.env.CLASSROOM_DESK_EXAM_BOX_HARDWARE = '1';
assert.equal(productCapabilities().examBoxHardware, true);
assert.equal(productCapabilities().gaReady, false, 'env hardware unlock still Pilot');
delete process.env.CLASSROOM_DESK_EXAM_BOX_HARDWARE;

closeDb();
rmSync(dir, { recursive: true, force: true });
console.log('examBoxHardwareAccept.test.ts: ok');
