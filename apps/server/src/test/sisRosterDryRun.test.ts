import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/client.js';
import { migrate } from '../db/migrate.js';
import { newId, nowIso } from '../utils/id.js';
import { readSisRosterLastApplySnapshot, syncSisRosterOnce, undoSisRosterLastApply } from '../services/sisRosterSync.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'cd-sis-dry-'));
process.env.CLASSROOM_DESK_DATA_DIR = dir;
const db = migrate(openDb());

const classId = newId();
const at = nowIso();
db.prepare(`INSERT INTO classes (id, name, class_code, created_at) VALUES (?, ?, ?, ?)`).run(
  classId,
  'DryRunClass',
  'DRY',
  at,
);
const sid = newId();
db.prepare(
  `INSERT INTO users (id, display_name, student_no, role, class_id, total_points, created_at)
   VALUES (?, 'Existing', '9001', 'student', ?, 0, ?)`,
).run(sid, classId, at);

db.prepare(
  `INSERT INTO settings (key, value) VALUES ('sis_roster_class_id', ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
).run(classId);

const csv = '姓名,学号\nExisting,9001\nNewbie,9002\n';
const fakeUrl = 'http://127.0.0.1/sis-roster-dry-run-test.csv';
db.prepare(
  `INSERT INTO settings (key, value) VALUES ('sis_roster_url', ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
).run(fakeUrl);

const origFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL) => {
  const url = String(input);
  if (url === fakeUrl) {
    return new Response(csv, { status: 200 });
  }
  return origFetch(input);
}) as typeof fetch;

const dry = await syncSisRosterOnce(db, { dryRun: true });
assert.equal(dry.ok, true);
assert.equal(dry.dryRun, true);
assert.equal(dry.diff?.wouldAdd.length, 1);
assert.equal(dry.diff?.wouldAdd[0]?.name, 'Newbie');
assert.equal(dry.diff?.wouldUpdate.length, 0);
assert.equal(dry.diff?.wouldRemove.length, 0);

const stillThere = db
  .prepare(`SELECT id FROM users WHERE id = ? AND (deleted_at IS NULL OR deleted_at = '')`)
  .get(sid);
assert.ok(stillThere, 'dry run must not write');

const apply = await syncSisRosterOnce(db, { dryRun: false });
assert.equal(apply.ok, true);
assert.ok(readSisRosterLastApplySnapshot(db));
const newbie = db
  .prepare(
    `SELECT id FROM users WHERE class_id = ? AND student_no = '9002' AND (deleted_at IS NULL OR deleted_at = '')`,
  )
  .get(classId) as { id?: string } | undefined;
assert.ok(newbie?.id, 'apply must insert Newbie');

const undo = undoSisRosterLastApply(db, { actorRole: 'teacher' });
assert.equal(undo.ok, true);
assert.equal(undo.removedInserts, 1);
assert.equal(readSisRosterLastApplySnapshot(db), null);
const newbieGone = db
  .prepare(
    `SELECT id FROM users WHERE class_id = ? AND student_no = '9002' AND (deleted_at IS NULL OR deleted_at = '')`,
  )
  .get(classId);
assert.equal(newbieGone, undefined);

globalThis.fetch = origFetch;
console.log('sisRosterDryRun.test.ts ok');
